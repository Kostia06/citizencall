// Per-toolkit REAL tool discovery + resolution for Composio execution.
//
// The planner/executor used to invent tool names ('call', 'list_commits');
// Composio only executes real slugs (DISCORD_LIST_MY_GUILDS,
// GITHUB_LIST_COMMITS), so a planned run against a connected app died with
// "tool error" (found live: discord/'call'). This module makes the real
// vocabulary available everywhere:
//   getToolkitTools  — discovery, cached like composio-catalog.ts (L0 module
//                      memory 15 min → L1 global D1 row per toolkit, 24h TTL,
//                      stale row still beats nothing when Composio is down)
//   resolveTool      — planned name → real tool (exact → fuzzy → keyword →
//                      first read-ish), pure, unit-testable
//   buildToolArgs    — fills the tool's required params, via one cheap-model
//                      call only when the schema actually requires something
//
// Confirmed against the live API (2026-08-15): GET /api/v3/tools
// ?toolkit_slug=X returns { items: [{ slug, name, description,
// input_parameters: JSON schema, is_deprecated }] }. `important=true` returns
// the curated subset in one page (github: 36 of 823); toolkits without the
// flag (discord: 6 tools) return 0 items for it, so we fall back to the
// unfiltered first page.
import type { Env } from '../env';
import { callFeatherless } from './featherless';
import { cheapestAvailableModel } from '../pipeline/suggest';

export interface ToolkitToolParam {
  type?: string;
  description?: string;
}

export interface ToolkitTool {
  slug: string;
  name: string;
  description: string;
  params: { required: string[]; properties: Record<string, ToolkitToolParam> };
}

const COMPOSIO_API_BASE = 'https://backend.composio.dev';
const MAX_TOOLS_PER_TOOLKIT = 12;
const MAX_SCHEMA_PROPERTIES = 8;
const MAX_DESCRIPTION_CHARS = 140;
const CACHE_TTL_MS = 15 * 60 * 1000; // L0 memory
const D1_TTL_MS = 24 * 60 * 60 * 1000; // L1 global — tool lists move slowly

// L0: per-isolate, keyed by toolkit slug (same pattern as composio-catalog.ts).
const memoryCache = new Map<string, { tools: ToolkitTool[]; expiresAt: number }>();

// L1: one global D1 row per toolkit — a single live fetch serves every
// user/isolate for a day. Same lazy-provision pattern as toolkit_catalog.
let d1SchemaReady = false;
async function ensureToolsSchema(db: D1Database): Promise<void> {
  if (d1SchemaReady) return;
  await db.exec(
    'CREATE TABLE IF NOT EXISTS toolkit_tools(toolkit TEXT PRIMARY KEY, value_json TEXT NOT NULL, fetched_at INTEGER NOT NULL)'
  );
  d1SchemaReady = true;
}

async function readToolsRow(db: D1Database, toolkit: string): Promise<{ tools: ToolkitTool[]; fetchedAt: number } | null> {
  await ensureToolsSchema(db);
  const row = await db
    .prepare('SELECT value_json, fetched_at FROM toolkit_tools WHERE toolkit = ?1')
    .bind(toolkit)
    .first<{ value_json: string; fetched_at: number }>();
  if (!row) return null;
  try {
    return { tools: JSON.parse(row.value_json) as ToolkitTool[], fetchedAt: row.fetched_at };
  } catch {
    return null; // corrupt row — next live fetch overwrites it
  }
}

async function writeToolsRow(db: D1Database, toolkit: string, tools: ToolkitTool[], now: number): Promise<void> {
  await ensureToolsSchema(db);
  await db
    .prepare(
      'INSERT INTO toolkit_tools (toolkit, value_json, fetched_at) VALUES (?1, ?2, ?3) ON CONFLICT(toolkit) DO UPDATE SET value_json = ?2, fetched_at = ?3'
    )
    .bind(toolkit, JSON.stringify(tools), now)
    .run();
}

interface ComposioToolItem {
  slug: string;
  name?: string;
  description?: string;
  is_deprecated?: boolean;
  input_parameters?: { required?: string[]; properties?: Record<string, { type?: string; description?: string }> };
}

function trimTool(item: ComposioToolItem): ToolkitTool {
  const properties: Record<string, ToolkitToolParam> = {};
  const source = item.input_parameters?.properties ?? {};
  const required = (item.input_parameters?.required ?? []).filter((r) => typeof r === 'string');
  // Required params always survive the trim; optional ones fill the rest.
  const keys = [...required.filter((r) => r in source), ...Object.keys(source).filter((k) => !required.includes(k))];
  for (const key of keys.slice(0, MAX_SCHEMA_PROPERTIES)) {
    const p = source[key];
    if (!p) continue;
    properties[key] = {
      ...(p.type ? { type: p.type } : {}),
      ...(p.description ? { description: p.description.slice(0, MAX_DESCRIPTION_CHARS) } : {}),
    };
  }
  return {
    slug: item.slug,
    name: item.name ?? item.slug,
    description: (item.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
    params: { required, properties },
  };
}

// Read/list basics first: a resolver falling back blind should land on a
// harmless read, and the planner's 8-tool window should show the tools a
// personal agent actually uses.
const READ_VERB = /^(LIST|GET|SEARCH|FETCH|FIND|READ|RETRIEVE)/;
const ACT_VERB = /^(SEND|CREATE|POST|REPLY|MESSAGE|ADD|STAR)/;

function verbScore(tool: ToolkitTool, toolkit: string): number {
  const bare = stripToolkitPrefix(tool.slug, toolkit);
  if (READ_VERB.test(bare)) return 2;
  if (ACT_VERB.test(bare)) return 1;
  return 0;
}

function rankTools(items: ComposioToolItem[], toolkit: string): ToolkitTool[] {
  const tools = items.filter((i) => i.slug && !i.is_deprecated).map(trimTool);
  // Reads before writes, and parameter-light tools before id-hungry ones —
  // this order is both the planner's listing and the resolver's blind
  // fallback, and the live discord run showed a fast planner grabbing
  // whatever came first (GET_INVITE, which needs an invite code nobody has).
  // Stable (idx) within equal buckets — the API's own order is meaningful.
  return tools
    .map((t, idx) => ({ t, idx, score: verbScore(t, toolkit) }))
    .sort((a, b) => b.score - a.score || a.t.params.required.length - b.t.params.required.length || a.idx - b.idx)
    .slice(0, MAX_TOOLS_PER_TOOLKIT)
    .map((x) => x.t);
}

async function fetchLiveTools(apiKey: string, toolkit: string): Promise<ToolkitTool[]> {
  const get = async (extra: string): Promise<{ items: ComposioToolItem[]; hasMore: boolean }> => {
    const url = `${COMPOSIO_API_BASE}/api/v3/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=100${extra}`;
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) throw new Error(`Composio tools ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { items?: ComposioToolItem[]; next_cursor?: string | null };
    return { items: body.items ?? [], hasMore: Boolean(body.next_cursor) };
  };
  // A complete unfiltered page IS the toolkit's whole vocabulary (discord: 6
  // tools) — use it. Only when the toolkit overflows one page (github: 823)
  // is the curated `important=true` subset (36) a better single page than an
  // alphabetical prefix full of ACCEPT_A_REPOSITORY_INVITATION-grade noise.
  // Found live: important-first shrank discord to its ONE flagged tool
  // (GET_INVITE), and every discord request resolved onto it.
  const all = await get('');
  if (!all.hasMore) return rankTools(all.items, toolkit);
  const important = await get('&important=true');
  return rankTools(important.items.length > 0 ? important.items : all.items, toolkit);
}

/** Top ~12 real tools of a Composio toolkit, trimmed for prompts. Empty array
 * means "no vocabulary known" (no key + no cached row, or unknown toolkit) —
 * callers must then leave the planned tool name untouched. */
export async function getToolkitTools(env: Env, toolkit: string): Promise<ToolkitTool[]> {
  const now = Date.now();
  const hit = memoryCache.get(toolkit);
  if (hit && hit.expiresAt > now) return hit.tools;

  const remember = (tools: ToolkitTool[]): ToolkitTool[] => {
    memoryCache.set(toolkit, { tools, expiresAt: now + CACHE_TTL_MS });
    return tools;
  };

  let staleRow: { tools: ToolkitTool[]; fetchedAt: number } | null = null;
  try {
    const row = await readToolsRow(env.DB, toolkit);
    if (row) {
      if (now - row.fetchedAt < D1_TTL_MS) return remember(row.tools);
      staleRow = row;
    }
  } catch {
    // D1 hiccup — discovery must never take down an execution.
  }

  if (env.COMPOSIO_API_KEY) {
    try {
      const tools = await fetchLiveTools(env.COMPOSIO_API_KEY, toolkit);
      try {
        await writeToolsRow(env.DB, toolkit, tools, now);
      } catch {
        /* non-fatal — this request already has its answer */
      }
      return remember(tools);
    } catch {
      // Composio outage or unknown toolkit — a stale row is still the real
      // tool list.
      if (staleRow) return remember(staleRow.tools);
    }
  } else if (staleRow) {
    return remember(staleRow.tools);
  }

  return remember([]);
}

/** Test-only: vitest shares module state across files in a worker isolate. */
export function resetToolkitToolsCacheForTests(): void {
  memoryCache.clear();
  d1SchemaReady = false;
}

// ---------------------------------------------------------------------------
// Resolution: planned tool name -> real tool.

function stripToolkitPrefix(slug: string, toolkit: string): string {
  const upper = slug.toUpperCase();
  const prefix = `${toolkit.toUpperCase()}_`;
  return upper.startsWith(prefix) ? upper.slice(prefix.length) : upper;
}

function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Words that carry no signal for matching an instruction to a tool.
const STOPWORDS = new Set([
  'THE', 'A', 'AN', 'AND', 'OR', 'OF', 'TO', 'FOR', 'IN', 'ON', 'AT', 'MY',
  'ME', 'IS', 'ARE', 'BE', 'IT', 'THIS', 'THAT', 'WITH', 'FROM', 'ANY',
  'NEW', 'CALL', 'TOOL', 'USE', 'PLEASE', 'CHECK', 'ALL',
]);

// Instruction words -> tool-vocabulary synonyms, so "check for new messages"
// can reach DISCORD_LIST_MESSAGES without sharing a literal token.
const SYNONYMS: Record<string, string[]> = {
  MESSAGES: ['MESSAGE', 'CHANNEL'],
  MESSAGE: ['MESSAGES', 'SEND'],
  EMAILS: ['EMAIL', 'MAIL', 'THREADS'],
  EMAIL: ['EMAILS', 'MAIL', 'SEND'],
  COMMITS: ['COMMIT'],
  COMMIT: ['COMMITS'],
  POST: ['SEND', 'CREATE', 'MESSAGE'],
  SERVERS: ['GUILDS', 'GUILD'],
  SERVER: ['GUILDS', 'GUILD'],
  REPO: ['REPOSITORY', 'REPOSITORIES'],
  REPOS: ['REPOSITORY', 'REPOSITORIES'],
};

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    tokens.add(raw);
    for (const syn of SYNONYMS[raw] ?? []) tokens.add(syn);
  }
  return tokens;
}

/** Planned tool name -> the toolkit's real tool. Resolution ladder:
 *  1. exact slug (case/punctuation-insensitive, toolkit prefix optional)
 *  2. keyword overlap between the sub-task instruction + planned name and
 *     each tool's slug/name/description (read-ish tools win ties)
 *  3. first read-ish tool, else the first tool
 *  Returns null only when `tools` is empty — the caller then executes the
 *  planned name as-is (stub mode / discovery unavailable). */
export function resolveTool(tools: ToolkitTool[], toolkit: string, planned: string, instruction: string): ToolkitTool | null {
  if (tools.length === 0) return null;

  const normalized = normalizeName(planned);
  const exact = tools.find(
    (t) => normalizeName(t.slug) === normalized || stripToolkitPrefix(t.slug, toolkit) === normalized
  );
  if (exact) return exact;

  const wanted = tokenize(`${planned} ${instruction}`);
  let best: { tool: ToolkitTool; score: number } | null = null;
  for (const tool of tools) {
    const haystack = tokenize(`${tool.slug} ${tool.name} ${tool.description}`);
    let score = 0;
    for (const token of wanted) if (haystack.has(token)) score++;
    // Prefer reads on ties — a fuzzy match should never fall onto a write.
    score = score * 2 + (verbScore(tool, toolkit) === 2 ? 1 : 0);
    if (score > (best?.score ?? 0)) best = { tool, score };
  }
  // score>=3: at least one real keyword overlap (2) — the read-ish tiebreak
  // alone (1) is not a match.
  if (best && best.score >= 3) return best.tool;

  // Blind fallback: a harmless read the executor can actually complete —
  // prefer reads whose schema needs nothing over reads that would force the
  // args model to invent identifiers.
  const reads = tools.filter((t) => verbScore(t, toolkit) === 2);
  return reads.find((t) => t.params.required.length === 0) ?? reads[0] ?? tools[0] ?? null;
}

// ---------------------------------------------------------------------------
// Arguments: fill the resolved tool's required params.

const ARGS_MAX_TOKENS = 400; // reasoning-family think-block headroom (see suggest.ts)

// "Obvious defaults" — required params we can fill without a model call.
function obviousDefault(name: string, param: ToolkitToolParam): unknown {
  if (/^(limit|per_page|page_size|max_results|count)$/i.test(name)) return 10;
  if (/^page$/i.test(name)) return 1;
  if (param.type === 'boolean') return false;
  return undefined;
}

type ArgsModel = (system: string, user: string) => Promise<string>;

function defaultArgsModel(env: Env): ArgsModel {
  return async (system, user) => {
    const result = await callFeatherless(env, {
      modelId: cheapestAvailableModel(),
      maxTokens: ARGS_MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return result.content;
  };
}

/** Exported for tests: model text -> args object, or null when it isn't a
 * JSON object. Tolerates <think> blocks and code fences. */
export function parseArgsJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Arguments for a resolved tool. Planned args (usually {}) always win over
 * generated ones. Model is consulted only when required params remain after
 * planned args + obvious defaults; one retry on an invalid/incomplete reply,
 * then degrade to whatever we have — the executor's try/catch turns a bad
 * call into a failed tool, never a crashed run. */
export async function buildToolArgs(
  env: Env,
  tool: ToolkitTool,
  instruction: string,
  plannedArgs: Record<string, unknown>,
  model: ArgsModel = defaultArgsModel(env)
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = { ...plannedArgs };
  const missing = () => tool.params.required.filter((r) => args[r] === undefined);

  for (const name of missing()) {
    const value = obviousDefault(name, tool.params.properties[name] ?? {});
    if (value !== undefined) args[name] = value;
  }
  if (missing().length === 0) return args;

  const system = [
    'You fill in JSON arguments for an API tool call.',
    `Tool: ${tool.slug} — ${tool.description}`,
    `Parameter schema: ${JSON.stringify(tool.params)}`,
    `Required parameters: ${tool.params.required.join(', ')}.`,
    'Reply with ONLY a single JSON object containing the arguments, no prose.',
  ].join('\n');

  let user = `Task: ${instruction.slice(0, 1000)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let generated: Record<string, unknown> | null = null;
    try {
      generated = parseArgsJson(await model(system, user));
    } catch {
      break; // model unavailable — degrade below, retrying won't help
    }
    if (generated) {
      for (const [key, value] of Object.entries(generated)) {
        if (args[key] === undefined && key in tool.params.properties) args[key] = value;
      }
      if (missing().length === 0) return args;
    }
    user = `Task: ${instruction.slice(0, 1000)}\nYour previous reply was missing required parameters: ${missing().join(', ')}. Reply with a complete JSON object.`;
  }
  return args; // best effort — the tool call itself reports what's missing
}
