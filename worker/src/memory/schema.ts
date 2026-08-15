// Per-user memory store schema (roadmap sub-project #3). Same lazy-provision
// pattern as cache/schema.ts: an idempotent CREATE-IF-NOT-EXISTS block,
// ensured once per isolate on first touch, so production needs no extra
// wiring and tests can apply it explicitly.
//
// user_id is a plain TEXT column with an index and no FK — anon actors
// (`anon_<uuid>`) get memories too, and the anon→user claim flow re-parents
// rows with a single `UPDATE user_memories SET user_id = ? WHERE user_id = ?`
// (see reassignMemories in store.ts).

const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_memories(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('agent','user')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, updated_at DESC);`;

export async function applyMemorySchema(db: D1Database): Promise<void> {
  for (const stmt of MEMORY_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

// One ensure per D1 binding per isolate — re-ensuring on a cold isolate is a
// tiny latency cost, never a bug (CREATE IF NOT EXISTS is idempotent).
const ensured = new WeakSet<D1Database>();

export async function ensureMemorySchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  await applyMemorySchema(db);
  ensured.add(db);
}
