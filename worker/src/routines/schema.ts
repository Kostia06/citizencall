// user_routines schema — same lazy-provision pattern as cache/schema.ts:
// an idempotent CREATE-IF-NOT-EXISTS block, ensured once per D1 binding per
// isolate by the store module, so the table exists in production without any
// extra wiring in index.ts.
//
// `user_id` is a plain TEXT column (no FK) on purpose: routines created under
// an anonymous `__Host-anon` session must be re-parentable onto a real user id
// by the anon->user claim flow with a single UPDATE.

const ROUTINES_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_routines(id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  name TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, last_run_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_routines_user ON user_routines(user_id);
CREATE INDEX IF NOT EXISTS idx_user_routines_due ON user_routines(enabled, schedule);`;

export async function applyRoutinesSchema(db: D1Database): Promise<void> {
  for (const stmt of ROUTINES_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

// One ensure per D1 binding per isolate (WeakSet keyed on the binding).
const ensured = new WeakSet<D1Database>();

export async function ensureRoutinesSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  await applyRoutinesSchema(db);
  ensured.add(db);
}
