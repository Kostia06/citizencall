// Claim-on-login: re-parents everything an anonymous `__Host-anon` session
// accumulated (connections, settings, MCPs, tool overrides — and run history,
// when the runs table exists) onto the real account the browser just
// authenticated as. Idempotent: a second call with the same pair finds no
// anon rows and does nothing.
//
// Owner-safety: the caller passes the anon id straight out of the SIGNED
// cookie (peekAnonId), so it can only ever be the requester's own session —
// and the `anon_` prefix guard below means this can never be pointed at a
// real user's rows even if a caller wires it up wrong.
//
// Conflict policy: the authenticated account's existing row always wins
// (INSERT OR IGNORE) — e.g. if the user already had a github connection,
// their row is kept and the anon duplicate is dropped. user_mcps rows have
// their own uuid PK, so those (and runs) re-parent with a plain UPDATE.
export async function claimAnonActor(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  if (!fromUserId.startsWith('anon_') || fromUserId === toUserId) return;

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO user_connections(user_id,toolkit,connected_account_id,status,connected_at)
         SELECT ?,toolkit,connected_account_id,status,connected_at FROM user_connections WHERE user_id=?`
      )
      .bind(toUserId, fromUserId),
    db.prepare(`DELETE FROM user_connections WHERE user_id=?`).bind(fromUserId),
    db
      .prepare(
        `INSERT OR IGNORE INTO user_settings(user_id,prefs_json,updated_at)
         SELECT ?,prefs_json,updated_at FROM user_settings WHERE user_id=?`
      )
      .bind(toUserId, fromUserId),
    db.prepare(`DELETE FROM user_settings WHERE user_id=?`).bind(fromUserId),
    db
      .prepare(
        `INSERT OR IGNORE INTO user_tools(user_id,toolkit,tool,enabled)
         SELECT ?,toolkit,tool,enabled FROM user_tools WHERE user_id=?`
      )
      .bind(toUserId, fromUserId),
    db.prepare(`DELETE FROM user_tools WHERE user_id=?`).bind(fromUserId),
    db.prepare(`UPDATE user_mcps SET user_id=? WHERE user_id=?`).bind(toUserId, fromUserId),
  ]);

  // Run history follows the identity too, so /api/sessions keeps listing the
  // sessions started before signup. `runs` lives in schema.sql (pipeline
  // schema), not the store schema — some test environments apply only the
  // auth+store schemas, so probe for the table instead of assuming it.
  // Same probe-then-update for the lazily-provisioned tables other
  // sub-systems own: routines (routines/store) and memories (memory/store) —
  // both have uuid PKs, so a plain user_id re-parent is safe and idempotent.
  for (const table of ['runs', 'user_routines', 'user_memories']) {
    const exists = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .bind(table)
      .first<{ name: string }>();
    if (exists) {
      await db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id=?`).bind(toUserId, fromUserId).run();
    }
  }
}
