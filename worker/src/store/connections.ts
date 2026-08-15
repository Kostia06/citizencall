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

// Claim-on-login moved to ./claim.ts (claimAnonActor), which re-parents ALL
// of an anon session's store rows — not just connections — with a
// keep-the-user's-row conflict policy.
