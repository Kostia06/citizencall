// User-defined MCP servers as pipeline toolkits (roadmap #2 follow-up).
//
// Enabled rows from `user_mcps` are surfaced to the planner as extra toolkit
// names, so a plan can route a sub-task at a user's own MCP. The actual MCP
// call transport (JSON-RPC over the configured endpoint, auth, tool listing)
// is deliberately NOT implemented here — it is more than an hour of careful
// work (session negotiation, streaming, per-server auth), so the call site in
// execute.ts is stubbed behind this interface instead of half-built: a
// sub-task routed at an MCP toolkit today emits `tool_skipped` with reason
// 'mcp transport not implemented' and the run continues without tool output.
import { listMcps } from '../store/mcps';

export interface McpToolkit {
  id: string;
  /** Planner-facing toolkit token derived from the MCP's display name. */
  toolkit: string;
  name: string;
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
    .map((m) => ({ id: m.id, toolkit: mcpToolkitToken(m.name), name: m.name }))
    .filter((m) => m.toolkit.length > 0);
}
