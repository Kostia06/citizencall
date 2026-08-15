export async function setToolOverride(db: D1Database, a: { userId: string; toolkit: string; tool: string; enabled: boolean }): Promise<void> {
  await db.prepare(`INSERT INTO user_tools(user_id,toolkit,tool,enabled) VALUES(?,?,?,?) ON CONFLICT(user_id,toolkit,tool) DO UPDATE SET enabled=excluded.enabled`)
    .bind(a.userId, a.toolkit, a.tool, a.enabled ? 1 : 0).run();
}

export async function listToolOverrides(db: D1Database, userId: string) {
  const { results } = await db.prepare(`SELECT toolkit,tool,enabled FROM user_tools WHERE user_id=?`).bind(userId)
    .all<{ toolkit: string; tool: string; enabled: number }>();
  return results.map((r) => ({ toolkit: r.toolkit, tool: r.tool, enabled: !!r.enabled }));
}

export async function isToolEnabled(db: D1Database, userId: string, toolkit: string, tool: string): Promise<boolean> {
  const r = await db.prepare(`SELECT enabled FROM user_tools WHERE user_id=? AND toolkit=? AND tool=?`).bind(userId, toolkit, tool).first<{ enabled: number }>();
  return r ? !!r.enabled : true; // default-on
}
