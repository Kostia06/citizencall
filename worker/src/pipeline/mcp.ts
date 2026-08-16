// User-defined MCP servers as pipeline toolkits (roadmap #2 follow-up).
//
// Enabled rows from `user_mcps` are surfaced to the planner as extra toolkit
// names, so a plan can route a sub-task at a user's own MCP. The call
// transport is the Streamable HTTP client in providers/mcp-client.ts:
// buildMcpTransport() maps a planner toolkit token back to the user's MCP
// row, initializes a JSON-RPC session against its URL, resolves the planned
// tool name against the server's real tools/list, and executes tools/call.
// Callers that don't wire a transport still get the clean `tool_skipped`
// path in execute.ts.
import { listMcps } from '../store/mcps';
import { isBlockedMcpUrl, McpHttpClient, type McpToolDef } from '../providers/mcp-client';
import { buildToolArgs, defaultArgsModel, parseArgsJson, type ArgsModel, type ToolkitTool } from '../providers/composio-tools';
import { callFeatherless } from '../providers/featherless';
import type { Env } from '../env';

export interface McpToolkit {
  id: string;
  /** Planner-facing toolkit token derived from the MCP's display name. */
  toolkit: string;
  name: string;
  /** Server endpoint + auth headers, straight from the user_mcps row. */
  url: string;
  headers: Record<string, string>;
}

export interface McpCallResult {
  ok: boolean;
  output: unknown;
  /** Name of the MCP tool that actually ran (planned names like 'call' are
   * resolved against the server's tools/list). Absent when no call was made. */
  tool?: string;
  /** The arguments the resolved tool actually received. */
  args?: Record<string, unknown>;
}

export interface McpTransport {
  call(toolkit: string, tool: string, args: Record<string, unknown>, instruction?: string): Promise<McpCallResult>;
}

// Display names are arbitrary user strings; planner toolkit tokens must be
// single lowercase words so the plan JSON round-trips cleanly.
export function mcpToolkitToken(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function listEnabledMcpToolkits(db: D1Database, userId: string): Promise<McpToolkit[]> {
  const mcps = await listMcps(db, userId);
  return mcps
    .filter((m) => m.enabled)
    .map((m) => ({ id: m.id, toolkit: mcpToolkitToken(m.name), name: m.name, url: m.url, headers: m.headers }))
    .filter((m) => m.toolkit.length > 0);
}

// ---------------------------------------------------------------------------
// Tool-name matching. Plans routed at an MCP toolkit usually carry the
// generic tool name 'call' (the planner has no MCP tool vocabulary), so the
// planned name is resolved against the server's real tools/list — same
// keyword-overlap spirit as composio-tools' resolveTool, sized down for the
// handful of tools a typical MCP server exposes.

const MCP_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'into', 'your', 'you', 'are']);

function nameTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !MCP_STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Planned tool name -> real MCP tool. Exact (case/punctuation-insensitive)
 * match wins; else keyword overlap of planned name + instruction against each
 * tool's name/description; else the first tool (never null for a non-empty
 * list — the server's error is more informative than never calling). */
export function matchMcpTool(tools: McpToolDef[], planned: string, instruction = ''): McpToolDef | null {
  if (tools.length === 0) return null;
  const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = normalize(planned);
  const exact = tools.find((t) => normalize(t.name) === normalized);
  if (exact) return exact;

  // 'call' is the planner's generic placeholder — only the instruction text
  // carries signal there.
  const wanted = nameTokens(planned === 'call' ? instruction : `${planned} ${instruction}`);
  let best: { tool: McpToolDef; score: number } | null = null;
  for (const tool of tools) {
    // Name tokens weigh 3× description tokens: a wordy description sharing
    // generic words ('idea', 'check') must not out-score a tool whose NAME
    // states the intent (found live: novelty check resolved suggest_names).
    const name = nameTokens(tool.name);
    const description = nameTokens(tool.description);
    let score = 0;
    for (const token of wanted) {
      if (name.has(token)) score += 3;
      else if (description.has(token)) score++;
    }
    if (score > (best?.score ?? 0)) best = { tool, score };
  }
  return best?.tool ?? tools[0] ?? null;
}

// ---------------------------------------------------------------------------
// Transport wiring.

export interface BuildMcpTransportOptions {
  /** Dev-only escape hatch for the SSRF guard (see providers/mcp-client.ts). */
  allowLocalhost: boolean;
  /** Injectable client factory for tests. */
  clientFactory?: (url: string, headers: Record<string, string>) => McpHttpClient;
  /** Enables required-arg filling from the tool's input schema (the planner
   * has no MCP tool vocabulary, so planned args are usually empty). Either
   * an env (prod: cheap Featherless model) or an injected model (tests). */
  env?: Env;
  argsModel?: ArgsModel;
  /** Model for tool selection + arg filling. Selection is routing-critical —
   * the cheapest (sub-1B) model picks wrong tools on synonym phrasings, so
   * run.ts passes the summarize rung-0 here. Defaults to the cheapest model. */
  selectionModelId?: string;
}

/** Real McpTransport over the user's enabled MCP rows. One client per
 * toolkit, cached for the life of the transport (i.e. one run) so the
 * initialize handshake and Mcp-Session-Id are reused across sub-tasks. */
export function buildMcpTransport(servers: readonly McpToolkit[], opts: BuildMcpTransportOptions): McpTransport {
  const makeClient = opts.clientFactory ?? ((url, headers) => new McpHttpClient(url, headers));
  const clients = new Map<string, McpHttpClient>();

  const argsModel =
    opts.argsModel ??
    (opts.env
      ? opts.selectionModelId
        ? fixedArgsModel(opts.env, opts.selectionModelId)
        : defaultArgsModel(opts.env)
      : undefined);

  return {
    async call(toolkit, tool, args, instruction = ''): Promise<McpCallResult> {
      const server = servers.find((s) => s.toolkit === toolkit);
      if (!server) return { ok: false, output: `no MCP server configured for toolkit '${toolkit}'` };
      if (!server.url) return { ok: false, output: `MCP server '${server.name}' has no URL configured` };
      const blocked = isBlockedMcpUrl(server.url, { allowLocalhost: opts.allowLocalhost });
      if (blocked) return { ok: false, output: `MCP server '${server.name}' rejected: ${blocked}` };

      let client = clients.get(toolkit);
      if (!client) {
        client = makeClient(server.url, server.headers);
        clients.set(toolkit, client);
      }

      // Resolve the planned name against the server's real tools. Discovery
      // failing is fatal for the call (the same request path tools/call would
      // use just failed) — surface the error instead of a doomed call.
      const listed = await client.listTools();
      if (!listed.ok) return { ok: false, output: listed.error };

      // Tool resolution, strongest signal first:
      //  1. exact planned-name match (the planner named a real tool);
      //  2. one cheap-model call that picks the tool AND fills args from the
      //     schema catalog — keyword overlap cannot bridge synonyms (found
      //     live: 'originality' never matched check_novelty, and 'hackathon'
      //     dragged the match to set_hackathon_context);
      //  3. keyword overlap (matchMcpTool) when the model is unavailable or
      //     answers garbage.
      const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      let resolved = listed.value.find((t) => normalize(t.name) === normalize(tool)) ?? null;
      let callArgs: Record<string, unknown> = { ...args };
      if (!resolved && argsModel && instruction) {
        const picked = await modelSelectTool(listed.value, instruction, argsModel);
        if (picked) {
          resolved = picked.tool;
          callArgs = { ...args, ...picked.args };
        }
      }
      resolved ??= matchMcpTool(listed.value, tool, `${instruction} ${argsInstruction(args)}`.trim());
      if (!resolved) return { ok: false, output: `MCP server '${server.name}' exposes no tools` };

      // Fill remaining required params (Composio-path buildToolArgs idiom).
      const missingRequired = () => resolved!.params.required.filter((r) => callArgs[r] === undefined);
      if (argsModel && instruction && missingRequired().length > 0) {
        try {
          callArgs = await buildToolArgs({} as Env, asToolkitTool(resolved), instruction, callArgs, argsModel);
        } catch {
          // best effort — the deterministic fallback below still applies
        }
      }
      // Deterministic last resort: most MCP tools take one free-text input,
      // and the cheap args model is the weakest link (sub-1B models emit
      // unparseable JSON — found live as MCP -32602 → fail_tool). A missing
      // required free-text param gets the instruction itself; enum params
      // stay empty — a guessed enum value is worse than the server's error.
      if (instruction) {
        for (const name of missingRequired()) {
          const prop = resolved.params.properties[name];
          if (!prop?.enum && (prop?.type === 'string' || prop?.type === undefined)) {
            callArgs[name] = instruction;
          }
        }
      }

      const result = await client.callTool(resolved.name, callArgs);
      if (!result.ok) return { ok: false, output: result.error, tool: resolved.name, args: callArgs };
      return { ok: !result.value.isError, output: result.value.text, tool: resolved.name, args: callArgs };
    },
  };
}

/** McpToolDef → the ToolkitTool shape buildToolArgs consumes. Enum values
 * ride in the description (ToolkitToolParam has no enum field). */
function asToolkitTool(tool: McpToolDef): ToolkitTool {
  const properties: ToolkitTool['params']['properties'] = {};
  for (const [key, prop] of Object.entries(tool.params.properties)) {
    const description = [prop.description, prop.enum ? `One of: ${prop.enum.join(', ')}` : '']
      .filter(Boolean)
      .join('. ');
    properties[key] = { ...(prop.type ? { type: prop.type } : {}), ...(description ? { description } : {}) };
  }
  return {
    slug: tool.name,
    name: tool.name,
    description: tool.description,
    params: { required: tool.params.required, properties },
  };
}

/** defaultArgsModel pinned to a specific model id instead of the cheapest
 * warm one (see BuildMcpTransportOptions.selectionModelId). */
function fixedArgsModel(env: Env, modelId: string): ArgsModel {
  return async (system, user) => {
    const result = await callFeatherless(env, {
      modelId,
      maxTokens: 400,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return result.content;
  };
}

const MAX_SELECTABLE_TOOLS = 24;

/** One cheap-model call that picks the tool AND fills its args from the
 * server's schema catalog. Returns null on any model/parse failure — the
 * keyword matcher is the fallback, never a dead call. */
async function modelSelectTool(
  tools: McpToolDef[],
  instruction: string,
  argsModel: ArgsModel
): Promise<{ tool: McpToolDef; args: Record<string, unknown> } | null> {
  const catalog = tools.slice(0, MAX_SELECTABLE_TOOLS).map((t) => ({
    name: t.name,
    description: t.description.slice(0, 140),
    params: t.params,
  }));
  const system = [
    'You choose ONE tool from an MCP server for a task and fill in its arguments.',
    `Tools: ${JSON.stringify(catalog)}`,
    'Reply with ONLY a single JSON object: {"tool":"<tool name>","args":{...}}. args must satisfy the chosen tool\'s required params.',
  ].join('\n');
  try {
    const parsed = parseArgsJson(await argsModel(system, `Task: ${instruction.slice(0, 1000)}`));
    if (!parsed) return null;
    const tool = tools.find((t) => t.name === parsed.tool);
    if (!tool) return null;
    const args: Record<string, unknown> = {};
    const rawArgs = parsed.args;
    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
        if (key in tool.params.properties) args[key] = value;
      }
    }
    return { tool, args };
  } catch {
    return null;
  }
}

/** Best extra matching signal available at the call site: the planned args
 * often carry the sub-task's intent (query/instruction fields). */
function argsInstruction(args: Record<string, unknown>): string {
  return Object.values(args)
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .slice(0, 200);
}
