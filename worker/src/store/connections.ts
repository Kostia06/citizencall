export async function upsertConnection(db: D1Database, a: { userId: string; toolkit: string; connectedAccountId: string; now: number }): Promise<void> {
  await db
    .prepare(`INSERT INTO user_connections(user_id,toolkit,connected_account_id,status,connected_at) VALUES(?,?,?, 'active',?) ON CONFLICT(user_id,toolkit) DO UPDATE SET connected_account_id=excluded.connected_account_id, status='active', connected_at=excluded.connected_at`)
    .bind(a.userId, a.toolkit, a.connectedAccountId, a.now)
    .run();
}

export async function listConnections(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(`SELECT toolkit,status,connected_at FROM user_connections WHERE user_id=? ORDER BY toolkit`)
    .bind(userId)
    .all<{ toolkit: string; status: string; connected_at: number }>();
  return results.map((r) => ({ toolkit: r.toolkit, status: r.status, connectedAt: r.connected_at }));
}

export async function revokeConnection(db: D1Database, userId: string, toolkit: string): Promise<boolean> {
  const res = await db.prepare(`UPDATE user_connections SET status='revoked' WHERE user_id=? AND toolkit=?`).bind(userId, toolkit).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getConnectedAccountId(db: D1Database, userId: string, toolkit: string): Promise<string | null> {
  const r = await db.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=? AND toolkit=? AND status='active'`).bind(userId, toolkit).first<{ connected_account_id: string }>();
  return r?.connected_account_id ?? null;
}

// Re-keys an anon session's connections onto a real account on login/signup
// (claim-on-login). `(user_id, toolkit)` is the primary key, so a plain
// `UPDATE ... SET user_id=?` would throw a unique-constraint error if the
// target account already has a connection for the same toolkit; upserting
// each row instead (anon's connection wins — it's the one just completed)
// and then dropping the now-empty anon rows keeps this safe to call even
// when the two sets overlap.
export async function reassignConnections(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  const { results } = await db
    .prepare(`SELECT toolkit,connected_account_id,status,connected_at FROM user_connections WHERE user_id=?`)
    .bind(fromUserId)
    .all<{ toolkit: string; connected_account_id: string; status: string; connected_at: number }>();
  if (results.length === 0) return;

  const upsert = db.prepare(
    `INSERT INTO user_connections(user_id,toolkit,connected_account_id,status,connected_at) VALUES(?,?,?,?,?)
     ON CONFLICT(user_id,toolkit) DO UPDATE SET connected_account_id=excluded.connected_account_id, status=excluded.status, connected_at=excluded.connected_at`
  );
  await db.batch([
    ...results.map((r) => upsert.bind(toUserId, r.toolkit, r.connected_account_id, r.status, r.connected_at)),
    db.prepare(`DELETE FROM user_connections WHERE user_id=?`).bind(fromUserId),
  ]);
}
