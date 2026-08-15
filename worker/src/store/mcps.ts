// user_mcps store — custom MCP servers a user registers for the run
// pipeline. Owner-scoped like everything else in the store (every statement
// keys on user_id).
//
// CONSUMPTION CONTRACT (for the run pipeline / other agents):
//   GET /api/mcps  ->  UserMcp[]   (Bearer + verified email)
//   or in-worker:  listMcps(db, userId): Promise<UserMcp[]>
// Filter on `enabled` before wiring a server into a run.

// Validated shape stored in config_json. Kept as its own type (not inlined
// into UserMcp) because create/update deal in configs while reads deal in
// full rows.
export interface McpConfig {
  url: string;
  headers: Record<string, string>;
}

export interface UserMcp {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

interface McpRow {
  id: string;
  name: string;
  config_json: string;
  enabled: number;
  created_at: number;
}

function rowToMcp(r: McpRow): UserMcp {
  // Rows predating config validation may hold arbitrary JSON — degrade to
  // empty url/headers rather than throwing on read.
  let cfg: Partial<McpConfig> = {};
  try {
    const parsed: unknown = JSON.parse(r.config_json);
    if (parsed && typeof parsed === 'object') cfg = parsed as Partial<McpConfig>;
  } catch {
    // ignore — treated as an empty config
  }
  return {
    id: r.id,
    name: r.name,
    url: typeof cfg.url === 'string' ? cfg.url : '',
    headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {},
    enabled: !!r.enabled,
    createdAt: r.created_at,
  };
}

export async function createMcp(
  db: D1Database,
  a: { userId: string; name: string; config: McpConfig; enabled?: boolean; now: number }
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO user_mcps(id,user_id,name,config_json,enabled,created_at) VALUES(?,?,?,?,?,?)`)
    .bind(id, a.userId, a.name, JSON.stringify(a.config), a.enabled === false ? 0 : 1, a.now)
    .run();
  return { id };
}

export async function listMcps(db: D1Database, userId: string): Promise<UserMcp[]> {
  const { results } = await db
    .prepare(`SELECT id,name,config_json,enabled,created_at FROM user_mcps WHERE user_id=? ORDER BY created_at`)
    .bind(userId)
    .all<McpRow>();
  return results.map(rowToMcp);
}

export async function getMcp(db: D1Database, userId: string, id: string): Promise<UserMcp | null> {
  const row = await db
    .prepare(`SELECT id,name,config_json,enabled,created_at FROM user_mcps WHERE id=? AND user_id=?`)
    .bind(id, userId)
    .first<McpRow>();
  return row ? rowToMcp(row) : null;
}

export async function updateMcp(
  db: D1Database,
  userId: string,
  id: string,
  patch: { name?: string; config?: McpConfig; enabled?: boolean }
): Promise<boolean> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name=?');
    binds.push(patch.name);
  }
  if (patch.config !== undefined) {
    sets.push('config_json=?');
    binds.push(JSON.stringify(patch.config));
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled=?');
    binds.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) return true;
  binds.push(id, userId);
  const res = await db.prepare(`UPDATE user_mcps SET ${sets.join(',')} WHERE id=? AND user_id=?`).bind(...binds).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteMcp(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM user_mcps WHERE id=? AND user_id=?`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
