export async function createMcp(db: D1Database, a: { userId: string; name: string; config: unknown; now: number }): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO user_mcps(id,user_id,name,config_json,enabled,created_at) VALUES(?,?,?,?,1,?)`)
    .bind(id, a.userId, a.name, JSON.stringify(a.config ?? {}), a.now).run();
  return { id };
}

export async function listMcps(db: D1Database, userId: string) {
  const { results } = await db.prepare(`SELECT id,name,enabled,created_at FROM user_mcps WHERE user_id=? ORDER BY created_at`).bind(userId)
    .all<{ id: string; name: string; enabled: number; created_at: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, enabled: !!r.enabled, createdAt: r.created_at }));
}

export async function updateMcp(db: D1Database, userId: string, id: string, patch: { name?: string; config?: unknown; enabled?: boolean }): Promise<boolean> {
  const sets: string[] = []; const binds: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name=?'); binds.push(patch.name); }
  if (patch.config !== undefined) { sets.push('config_json=?'); binds.push(JSON.stringify(patch.config)); }
  if (patch.enabled !== undefined) { sets.push('enabled=?'); binds.push(patch.enabled ? 1 : 0); }
  if (sets.length === 0) return true;
  binds.push(id, userId);
  const res = await db.prepare(`UPDATE user_mcps SET ${sets.join(',')} WHERE id=? AND user_id=?`).bind(...binds).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteMcp(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM user_mcps WHERE id=? AND user_id=?`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
