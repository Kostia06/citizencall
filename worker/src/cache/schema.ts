// Run-result cache schema (SPEC.md §8 scoping rule applied at run level).
// Applied the same way as applyAuthSchema/applyStoreSchema in db.ts: an
// idempotent CREATE-IF-NOT-EXISTS block callable from tests and from boot.
// The cache modules also ensure it lazily (ensureRunCacheSchema) so the
// table exists in production without any extra wiring in index.ts — the
// first run-cache read/write in an isolate pays one extra D1 round-trip.
//
// The equivalent DDL should also be appended to worker/schema.sql so
// `pnpm db:reset` provisions it up front (see the integration notes in the
// worker-b report) — but nothing breaks if it isn't.

const RUN_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_cache(cache_key TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  policy_version TEXT NOT NULL, value_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_run_cache_user ON run_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_run_cache_exp ON run_cache(expires_at);`;

export async function applyRunCacheSchema(db: D1Database): Promise<void> {
  for (const stmt of RUN_CACHE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

// One ensure per D1 binding per isolate. CREATE IF NOT EXISTS is idempotent,
// so a cold isolate re-ensuring is only a tiny latency cost, never a bug.
const ensured = new WeakSet<D1Database>();

export async function ensureRunCacheSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  await applyRunCacheSchema(db);
  ensured.add(db);
}
