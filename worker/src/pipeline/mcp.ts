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
}

export interface McpTransport {
  call(toolkit: string, tool: string, args: Record<string, unknown>): Promise<McpCallResult>;
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
    const haystack = nameTokens(`${tool.name} ${tool.description}`);
    let score = 0;
    for (const token of wanted) if (haystack.has(token)) score++;
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
}

/** Real McpTransport over the user's enabled MCP rows. One client per
 * toolkit, cached for the life of the transport (i.e. one run) so the
 * initialize handshake and Mcp-Session-Id are reused across sub-tasks. */
export function buildMcpTransport(servers: readonly McpToolkit[], opts: BuildMcpTransportOptions): McpTransport {
  const makeClient = opts.clientFactory ?? ((url, headers) => new McpHttpClient(url, headers));
  const clients = new Map<string, McpHttpClient>();

  return {
    async call(toolkit, tool, args): Promise<McpCallResult> {
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
      const resolved = matchMcpTool(listed.value, tool, argsInstruction(args));
      if (!resolved) return { ok: false, output: `MCP server '${server.name}' exposes no tools` };

      const result = await client.callTool(resolved.name, args);
      if (!result.ok) return { ok: false, output: result.error };
      return { ok: !result.value.isError, output: result.value.text };
    },
  };
}

/** Best extra matching signal available at the call site: the planned args
 * often carry the sub-task's intent (query/instruction fields). */
function argsInstruction(args: Record<string, unknown>): string {
  return Object.values(args)
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .slice(0, 200);
}
