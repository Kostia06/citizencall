// Stage 1 — decompose. Turns normalized text into a Plan of SubTasks with a real
// routed model call, checking the L3 plan cache first (SPEC.md §8: global,
// plan-only — never stores tool or model output). L3 is two-tier: exact match
// on the normalized key (fast path, unchanged), then on exact miss a bounded
// semantic near-match over recent plan-cache rows (cache/planSemantic.ts) —
// the SPEC.md §8 "semantic L3" future work, done lexically since this stack
// has no embedding provider.
//
// The planner runs on the frontier baseline: planning is a single small-output
// call where correctness matters most, and it's amortized by the L3 cache — a
// repeated request never reaches the model. The plan call is intentionally NOT
// counted as a hop (same as the normalize stage), so it doesn't distort the
// per-sub-task routing economics the benchmark reports.
//
// If no key is set (stub), the model output isn't valid JSON, or the policy has
// no frontier model, we fall back to the heuristic single-sub-task splitter so
// the worker still produces a usable plan deterministically.
import { z } from 'zod';
import type { Env } from '../env';
import { normalizePlanKey } from '../cache/plan';
import { getPlanCacheEntry } from '../db';
import { findNearPlan, putPlanIndexed } from '../cache/planSemantic';
import { callFeatherless } from '../providers/featherless';
import { getToolkitTools } from '../providers/composio-tools';
import type { Plan, Policy, SubTask, TaskKind } from '../types';

const MAX_SUBTASKS = 4;
// The planner runs on the frontier baseline, which is a reasoning model
// (GLM-5.2): it emits a `reasoning` block before `content`, and a tight cap
// yields finish_reason=length with EMPTY content — measured live 2026-08-15
// (256 → empty; ~1000 reasoning tokens observed on a short prompt). A cut-off
// planner falls back to the heuristic, but the headroom makes the real
// planner actually run. max_tokens is a cap; cost follows actual usage.
const MAX_TOKENS = 2048;

const TOOL_HINTS: ReadonlyArray<{ pattern: RegExp; toolkit: string; tool: string }> = [
  // Plurals matter: "check any prs" failed to match \bpr\b and the run
  // answered "I don't have access to GitHub" with GitHub connected.
  { pattern: /\b(pull requests?|prs?)\b/i, toolkit: 'github', tool: 'search_pull_requests' },
  { pattern: /\b(commits?|repos?|repositor(?:y|ies)|issues?|branch(?:es)?)\b/i, toolkit: 'github', tool: 'list_commits' },
  // Personal-mail contexts only — the bare word once hinted gmail into
  // "write a professional email…" and "regex to validate an email address"
  // (found live: writing/coding prompts got a forced gmail tool call, which
  // pauses anonymous runs on a connect card instead of answering).
  {
    pattern:
      /\b(gmail|inbox)\b|\bmy (emails?|mails?)\b|\b(unread|new|latest|recent) (emails?|mails?)\b|\bsend (an?|the|this) (email|mail)\b|\bcheck (my )?(emails?|mails?)\b|\b(emails?|mails?) (from|about)\b/i,
    toolkit: 'gmail',
    tool: 'fetch_emails',
  },
];

// Default read tool per toolkit when the model flags a tool need but the
// instruction text doesn't match a more specific hint.
const DEFAULT_TOOL: Record<string, { toolkit: string; tool: string }> = {
  github: { toolkit: 'github', tool: 'list_commits' },
  gmail: { toolkit: 'gmail', tool: 'fetch_emails' },
};

const SubTaskDraft = z.object({
  kind: z.enum(['classify', 'extract_fields', 'summarize', 'normalize']),
  instruction: z.string().trim().min(1),
  needsTools: z.boolean().optional().default(false),
  // A free string, not an enum: the allowed set is dynamic (github/gmail plus
  // the user's enabled MCP toolkits). Unknown toolkits are dropped per
  // sub-task in resolveTool rather than nulling the whole plan — one
  // hallucinated toolkit name shouldn't discard an otherwise-good plan.
  toolkit: z.string().nullish(),
  // Real Composio tool slug (e.g. DISCORD_LIST_MY_GUILDS) when the planner
  // saw a tool listing for the toolkit. Tolerant free string: the executor's
  // resolver (providers/composio-tools.ts) maps unknown/invented names onto
  // the toolkit's nearest real tool, so a bad pick degrades, never discards.
  tool: z.string().nullish(),
  sensitive: z.boolean().optional().default(false),
});
type SubTaskDraft = z.infer<typeof SubTaskDraft>;
const PlanDraft = z.array(SubTaskDraft).min(1).max(MAX_SUBTASKS);

const BUILTIN_TOOLKITS = ['github', 'gmail'] as const;

function systemPrompt(extraToolkits: string[], toolListing = ''): string {
  const toolkits = [...BUILTIN_TOOLKITS, ...extraToolkits];
  const list = toolkits.map((t) => `"${t}"`).join('|');
  return [
    'You are a task planner for an agent. Break the user request into an ordered list',
    `of 1 to ${MAX_SUBTASKS} sub-tasks. Each sub-task kind is one of: classify, extract_fields,`,
    'summarize, normalize. Reply with ONLY a JSON array, no prose and no code fences.',
    'Each element: {"kind": <kind>, "instruction": <imperative string>, "needsTools": <bool>,',
    `"toolkit": <${list}|null>, "tool": <tool slug|null>, "sensitive": <bool>}. Set needsTools=true and toolkit`,
    'when the step must read from or act on one of those tools. Keep instructions concise and self-contained.',
    // Found live: "tell me latest message" with Discord connected planned no
    // tool and the answer claimed "I don't have access to your messages".
    'The listed toolkits are apps the user has CONNECTED — the agent does have access. When the request asks',
    'about messages, mail, code, files, or notifications that one of the listed toolkits serves, plan that',
    "toolkit's tool call instead of a plain answer.",
    // Executors receive ONLY the instruction string — a plan that says
    // "extract fields from this invoice" without the invoice sends the
    // executor nothing to extract (observed live: GLM-5.2 returned all-null
    // fields because the source text never reached it).
    'Executors see ONLY each instruction, never the original request: when a step reads data quoted in the',
    'request (an invoice, email, review, document), copy that source text verbatim into the instruction.',
    // Conversational prompts planned as extract_fields answered the user
    // with "Field: value" JSON bullets (observed live: "whats your name" →
    // "Agent's name: Jeff") — chit-chat is a reply, not a data extraction.
    'For conversational prompts (greetings, small talk, questions about the user or about you), plan a',
    'SINGLE summarize sub-task whose instruction is to reply naturally in first person — never extract_fields.',
    ...(toolListing
      ? [
          'Available tools per toolkit. When a step uses a toolkit, set "tool" to the ONE exact slug',
          'whose description best matches what the step does — never the first listed — or null if none fits:',
          toolListing,
        ]
      : []),
  ].join(' ');
}

// The planner's tool vocabulary: real Composio tool slugs for the run's
// toolkits, so plans name executable tools (GITHUB_LIST_COMMITS) instead of
// invented ones ('call'). Bounded hard — prompt size is a cost lever — and
// any discovery failure yields '' (the planner works fine without a listing;
// the executor's resolver covers the gap).
const MAX_LISTED_TOOLKITS = 4;
const MAX_LISTED_TOOLS = 8;

async function buildToolListing(env: Env, toolkits: string[]): Promise<string> {
  const unique = [...new Set(toolkits)].slice(0, MAX_LISTED_TOOLKITS);
  const sections: string[] = [];
  for (const toolkit of unique) {
    try {
      const tools = await getToolkitTools(env, toolkit);
      if (tools.length === 0) continue;
      const lines = tools.slice(0, MAX_LISTED_TOOLS).map((t) => `${t.slug}: ${t.description || t.name}`);
      sections.push(`[${toolkit}] ${lines.join(' | ')}`);
    } catch {
      // discovery down for this toolkit — list the others
    }
  }
  return sections.join(' ');
}

export interface DecomposeResult {
  plan: Plan;
  cacheHit: boolean;
  // How the hit was found. Additive: run.ts only reads plan/cacheHit, and the
  // wire `plan` event's cacheHit stays a boolean (types.ts is out of scope).
  cacheKind?: 'exact' | 'semantic';
}

// Action verbs that, combined with a MENTIONED catalog toolkit, guarantee a
// tool call even when the planner model shrugs — "post a discord update"
// must pause on the discord connection deterministically, not only when GLM
// happens to set needsTools (observed live: it often doesn't).
const ACTION_VERB = /\b(send|post|message|announce|create|reply|update|upload|schedule|share|publish|check|list|read|find|search|get|fetch|show)\b/i;

export async function decompose(
  env: Env,
  db: D1Database,
  policy: Policy,
  normalizedText: string,
  extraToolkits: string[] = [],
  mentionedToolkits: string[] = [],
  // (threading) The last user turn, one line, as a planning disambiguator.
  // Deliberately NOT part of either plan-cache key and never joined into the
  // plan text — it only rides the model call on a cache miss.
  conversationHint = ''
): Promise<DecomposeResult> {
  // The toolkit vocabulary is part of BOTH cache keys: a plan minted when
  // the planner couldn't see a toolkit must not hit the same prompt once it
  // can. Found live TWICE: first the semantic path (stale discord plan), and
  // then the exact path — it looked up the UNsuffixed key while new plans
  // are stored under the suffixed one, so a legacy tool-less plan ("check
  // any prs" from before the vocab fix) exact-hit forever and fresh plans
  // never exact-hit their own rows.
  const key = planCacheKeyFor(normalizedText, extraToolkits);

  // A cached plan carries the sub-task ids of the run that minted it —
  // sub_tasks.id is a global PK, so EVERY cache hit (exact or semantic) must
  // re-key the plan (fresh ids, dependsOn remapped) before inserting its rows.
  const cachedEntry = await getPlanCacheEntry(db, key);
  if (cachedEntry) {
    try {
      const plan = JSON.parse(cachedEntry.planJson) as Plan;
      return { plan: rekeyPlan(plan), cacheHit: true, cacheKind: 'exact' };
    } catch {
      // corrupt row — fall through to re-plan; the write below overwrites it
    }
  }
  const near = await findNearPlan(db, key);
  if (near) {
    // Promote the borrow to an exact row under the new key (provenance in
    // borrowed_from), so the next identical prompt takes the fast path.
    await putPlanIndexed(db, key, near.plan, near.matchedKey);
    return { plan: rekeyPlan(near.plan), cacheHit: true, cacheKind: 'semantic' };
  }

  // FAST PATH — a short prompt with no tool signal doesn't deserve an
  // 18-second frontier planning call ("say hi" measured 18.1s of planning
  // for a 1-sub-task plan the heuristic produces identically in ~0ms).
  // Anything tool-shaped (hint regexes, a mentioned/MCP toolkit name) still
  // gets the real planner.
  const plan = isTrivialPrompt(normalizedText, extraToolkits)
    ? heuristicPlan(normalizedText)
    : ((await modelPlan(env, policy, normalizedText, extraToolkits, conversationHint)) ?? heuristicPlan(normalizedText));
  ensureMentionedToolCall(plan, normalizedText, mentionedToolkits);
  await putPlanIndexed(db, key, plan);
  return { plan, cacheHit: false };
}

/** Deterministic floor under the planner model: an action-verb prompt that
 * names a catalog toolkit ("post a discord update…") gets a tool call on its
 * final sub-task even when the model left toolCall empty. Mentions only —
 * MCP toolkits aren't forced (their presence isn't a mention). */
function ensureMentionedToolCall(plan: Plan, text: string, mentionedToolkits: string[]): void {
  if (mentionedToolkits.length === 0) return;
  if (!ACTION_VERB.test(text)) return;
  if (plan.subTasks.some((s) => s.toolCall)) return;
  const last = plan.subTasks[plan.subTasks.length - 1];
  const toolkit = mentionedToolkits[0];
  if (!last || !toolkit) return;
  last.needsTools = true;
  last.toolCall = { toolkit, tool: 'call', args: {} };
}

function isTrivialPrompt(text: string, extraToolkits: string[]): boolean {
  if (text.length >= 140) return false;
  if (TOOL_HINTS.some((h) => h.pattern.test(text))) return false;
  const lower = text.toLowerCase();
  return !extraToolkits.some((t) => lower.includes(t.toLowerCase()));
}

/** The exact plan-cache key decompose uses — the cache keeper (warmup.ts)
 * must mint under the SAME key a live run will look up, vocab suffix
 * included, or warmed rows never hit. */
export function planCacheKeyFor(normalizedText: string, extraToolkits: string[]): string {
  const vocab = [...extraToolkits].sort().join(',');
  return normalizePlanKey(normalizedText) + (vocab ? `|tk:${vocab}` : '');
}

/** True when this prompt+vocab would reach the model planner rather than the
 * ~0ms heuristic — the only prompts worth pre-warming. */
export function wouldUsePlannerModel(text: string, extraToolkits: string[]): boolean {
  return !isTrivialPrompt(text, extraToolkits);
}

// Planning ran on the frontier baseline (GLM), a REASONING model that spends
// 20-50s thinking before emitting a 1-4 item JSON plan — measured live: 49s
// of planning for a one-line prompt. Qwen2.5-14B (live-probed, servable,
// non-reasoning) produces the same structured plan in ~3-6s; GLM stays as
// the fallback when the fast planner fails or emits garbage.
const FAST_PLANNER_MODELS = ['Qwen/Qwen2.5-14B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'];
const FAST_PLANNER_MAX_TOKENS = 700; // non-reasoning: the JSON fits comfortably

// Returns null (not throws) on any failure so the caller falls back to the
// heuristic. A planning misfire must never take down the whole run.
async function modelPlan(env: Env, policy: Policy, text: string, extraToolkits: string[], conversationHint = ''): Promise<Plan | null> {
  // Mentioned/MCP toolkits first — they're what this prompt is actually
  // about — then the builtins, within the listing cap.
  const toolListing = await buildToolListing(env, [...extraToolkits, ...BUILTIN_TOOLKITS]);
  // (threading) Appended to the SYSTEM prompt so a follow-up like "and what
  // about yesterday?" resolves its referent; the user text stays untouched.
  const hintLine = conversationHint
    ? `\nFor disambiguation only (do not plan sub-tasks for it): the user's previous message was: "${conversationHint}"`
    : '';
  const messages = [
    { role: 'system' as const, content: systemPrompt(extraToolkits, toolListing) + hintLine },
    { role: 'user' as const, content: text },
  ];

  for (const modelId of FAST_PLANNER_MODELS) {
    try {
      const res = await callFeatherless(env, { modelId, messages, maxTokens: FAST_PLANNER_MAX_TOKENS });
      const plan = planFromContent(res.content, extraToolkits);
      if (plan) return plan;
    } catch {
      // unavailable/cold — try the next tier
    }
  }

  const modelId = policy.baselines.frontier;
  if (!modelId) return null;
  let content: string;
  try {
    const res = await callFeatherless(env, { modelId, messages, maxTokens: MAX_TOKENS });
    content = res.content;
  } catch {
    return null; // cold/backpressure/capacity — heuristic covers the demo path
  }
  return planFromContent(content, extraToolkits);
}

// Pure: model text -> validated Plan, or null on invalid/empty output. Exported
// for unit testing without a network round-trip.
export function planFromContent(content: string, extraToolkits: string[] = []): Plan | null {
  const drafts = parseDrafts(content);
  if (!drafts) return null;

  const allowedToolkits = new Set<string>([...BUILTIN_TOOLKITS, ...extraToolkits]);
  const withIds = drafts.map((d) => ({ draft: d, id: crypto.randomUUID() }));
  const subTasks: SubTask[] = withIds.map(({ draft, id }, idx) => buildSubTask(draft, idx, id, allowedToolkits));
  // Sequential dependency chain — the DO executes sub-tasks in order and later
  // steps commonly consume earlier output; express that truthfully in the plan.
  for (let i = 1; i < subTasks.length; i++) {
    const cur = subTasks[i];
    const prev = subTasks[i - 1];
    if (cur && prev) cur.dependsOn = [prev.id];
  }
  return { subTasks };
}

function buildSubTask(d: SubTaskDraft, idx: number, id: string, allowedToolkits: ReadonlySet<string>): SubTask {
  const hint = d.needsTools && d.toolkit && allowedToolkits.has(d.toolkit) ? d.toolkit : null;
  const tool = resolveTool(d.instruction, hint, d.tool ?? null);
  return {
    id,
    idx,
    kind: d.kind as TaskKind,
    instruction: d.instruction,
    ctxNeeded: Math.max(512, Math.ceil(d.instruction.length / 3)),
    needsTools: Boolean(tool),
    ...(tool ? { toolCall: { toolkit: tool.toolkit, tool: tool.tool, args: {} } } : {}),
    dependsOn: [],
    sensitive: d.sensitive ?? false,
  };
}

function resolveTool(instruction: string, toolkitHint: string | null, toolHint: string | null = null) {
  // The model's own toolkit pick wins over the text patterns — "send a
  // discord message about the repo" must stay discord, not get hijacked to
  // github because "repo" matched a hint regex. Patterns are the fallback
  // for plans where the model flagged needsTools but named no toolkit.
  // A model-picked tool slug (from the system prompt's real-tool listing)
  // wins over the static defaults; 'call' remains the generic placeholder
  // the executor's resolver (providers/composio-tools.ts) maps to a real
  // slug at run time.
  if (toolkitHint && toolHint) return { toolkit: toolkitHint, tool: toolHint };
  if (toolkitHint) return DEFAULT_TOOL[toolkitHint] ?? { toolkit: toolkitHint, tool: 'call' };
  const byText = TOOL_HINTS.find((h) => h.pattern.test(instruction));
  if (byText) return { toolkit: byText.toolkit, tool: byText.tool };
  return undefined;
}

// Tolerant of code fences and of the model wrapping the array in {subTasks|plan}.
function parseDrafts(raw: string): SubTaskDraft[] | null {
  const json = extractJson(raw);
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const arr = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.subTasks)
      ? value.subTasks
      : isRecord(value) && Array.isArray(value.plan)
        ? value.plan
        : null;
  if (!arr) return null;
  const parsed = PlanDraft.safeParse(arr);
  return parsed.success ? parsed.data : null;
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

function rekeyPlan(plan: Plan): Plan {
  const idMap = new Map(plan.subTasks.map((s) => [s.id, crypto.randomUUID()]));
  return {
    subTasks: plan.subTasks.map((s) => ({
      ...s,
      id: idMap.get(s.id)!,
      dependsOn: s.dependsOn.map((d) => idMap.get(d) ?? d),
    })),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// Heuristic fallback — the original single-sub-task splitter. Kept so the worker
// degrades gracefully with no key, on invalid model output, or on planner error.
function heuristicPlan(text: string): Plan {
  const tool = TOOL_HINTS.find((h) => h.pattern.test(text));
  const subTask: SubTask = {
    id: crypto.randomUUID(),
    idx: 0,
    kind: classifyKind(text),
    instruction: text,
    ctxNeeded: Math.max(512, Math.ceil(text.length / 3)),
    needsTools: Boolean(tool),
    ...(tool ? { toolCall: { toolkit: tool.toolkit, tool: tool.tool, args: {} } } : {}),
    dependsOn: [],
    sensitive: false,
  };
  return { subTasks: [subTask] };
}

function classifyKind(text: string): TaskKind {
  if (/\b(classify|category|categorize|label)\b/i.test(text)) return 'classify';
  if (/\b(extract|field|pull out|structured)\b/i.test(text)) return 'extract_fields';
  return 'summarize';
}
