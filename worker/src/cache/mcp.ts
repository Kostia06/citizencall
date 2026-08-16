// MCP caches — two layers that remove the two per-run MCP costs:
//
//  1. Tool lists (`mcp_tools_cache`): tools/list against a user's MCP server
//     ran on EVERY tool call (~1-2s of network per sub-task). One global row
//     per server URL serves every user of that server for an hour.
//  2. Tool selection (`mcp_select_cache`): the cheap-model pick of tool+args
//     for an instruction is deterministic in spirit — the same instruction
//     against the same server should not pay a model call twice. 24h TTL.
//
// Same L0 (per-isolate memory) + L1 (D1, lazily provisioned) pattern as
// composio-tools' toolkit_tools cache; every read/write degrades to a miss
// on D1 errors, never a crash.
import { sha256Hex } from '../hash';
import type { McpToolDef } from '../providers/mcp-client';

const TOOLS_TTL_MS = 60 * 60 * 1000; // 1h — user MCP servers change during dev
const SELECT_TTL_MS = 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mcp_tools_cache(url_hash TEXT PRIMARY KEY, tools_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_select_cache(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, created_at INTEGER NOT NULL);`;

const ensured = new WeakSet<D1Database>();
async function ensureSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  ensured.add(db);
}

const toolsMemory = new Map<string, { tools: McpToolDef[]; expiresAt: number }>();

export async function getCachedMcpTools(db: D1Database, url: string): Promise<McpToolDef[] | null> {
  const hash = await sha256Hex(url);
  const l0 = toolsMemory.get(hash);
  if (l0 && l0.expiresAt > Date.now()) return l0.tools;
  try {
    await ensureSchema(db);
    const row = await db
      .prepare('SELECT tools_json, created_at FROM mcp_tools_cache WHERE url_hash=?')
      .bind(hash)
      .first<{ tools_json: string; created_at: number }>();
    if (!row || row.created_at + TOOLS_TTL_MS < Date.now()) return null;
    const tools = JSON.parse(row.tools_json) as McpToolDef[];
    toolsMemory.set(hash, { tools, expiresAt: row.created_at + TOOLS_TTL_MS });
    return tools;
  } catch {
    return null;
  }
}

export async function putCachedMcpTools(db: D1Database, url: string, tools: McpToolDef[]): Promise<void> {
  const hash = await sha256Hex(url);
  toolsMemory.set(hash, { tools, expiresAt: Date.now() + TOOLS_TTL_MS });
  try {
    await ensureSchema(db);
    await db
      .prepare('INSERT OR REPLACE INTO mcp_tools_cache(url_hash, tools_json, created_at) VALUES (?,?,?)')
      .bind(hash, JSON.stringify(tools), Date.now())
      .run();
  } catch {
    // cache write failure is never a run failure
  }
}

export interface CachedMcpSelection {
  tool: string;
  args: Record<string, unknown>;
}

async function selectKey(url: string, instruction: string): Promise<string> {
  return sha256Hex(`${url}∣${instruction.trim().toLowerCase()}`);
}

export async function getCachedMcpSelection(
  db: D1Database,
  url: string,
  instruction: string
): Promise<CachedMcpSelection | null> {
  try {
    await ensureSchema(db);
    const row = await db
      .prepare('SELECT value_json, created_at FROM mcp_select_cache WHERE key=?')
      .bind(await selectKey(url, instruction))
      .first<{ value_json: string; created_at: number }>();
    if (!row || row.created_at + SELECT_TTL_MS < Date.now()) return null;
    return JSON.parse(row.value_json) as CachedMcpSelection;
  } catch {
    return null;
  }
}

export async function putCachedMcpSelection(
  db: D1Database,
  url: string,
  instruction: string,
  value: CachedMcpSelection
): Promise<void> {
  try {
    await ensureSchema(db);
    await db
      .prepare('INSERT OR REPLACE INTO mcp_select_cache(key, value_json, created_at) VALUES (?,?,?)')
      .bind(await selectKey(url, instruction), JSON.stringify(value), Date.now())
      .run();
  } catch {
    // best effort
  }
}
