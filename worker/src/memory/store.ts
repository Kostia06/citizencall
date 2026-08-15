// CRUD over user_memories. Every function REQUIRES a non-empty userId —
// same hard scoping rule as the run cache (cache/runResult.ts): one user's
// memories must never be readable or writable by another, anon ids included.
import { ensureMemorySchema } from './schema';

export interface Memory {
  id: string;
  userId: string;
  title: string;
  contentMd: string;
  source: 'agent' | 'user';
  createdAt: number;
  updatedAt: number;
}

interface MemoryRow {
  id: string;
  user_id: string;
  title: string;
  content_md: string;
  source: 'agent' | 'user';
  created_at: number;
  updated_at: number;
}

function toMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    contentMd: r.content_md,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function assertUserId(userId: string): void {
  if (!userId) throw new Error('memory store requires a userId (per-user scoping rule)');
}

export async function listMemories(db: D1Database, userId: string): Promise<Memory[]> {
  assertUserId(userId);
  await ensureMemorySchema(db);
  const { results } = await db
    .prepare(`SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC, id`)
    .bind(userId)
    .all<MemoryRow>();
  return results.map(toMemory);
}

export async function getMemory(db: D1Database, userId: string, id: string): Promise<Memory | null> {
  assertUserId(userId);
  await ensureMemorySchema(db);
  const row = await db
    .prepare(`SELECT * FROM user_memories WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<MemoryRow>();
  return row ? toMemory(row) : null;
}

/** Case-insensitive title lookup — the `[[Title]]` link form and the
 * auto-write dedup both resolve through this. Newest wins on a tie. */
export async function getMemoryByTitle(db: D1Database, userId: string, title: string): Promise<Memory | null> {
  assertUserId(userId);
  await ensureMemorySchema(db);
  const row = await db
    .prepare(
      `SELECT * FROM user_memories WHERE user_id = ? AND title = ? COLLATE NOCASE
       ORDER BY updated_at DESC LIMIT 1`
    )
    .bind(userId, title)
    .first<MemoryRow>();
  return row ? toMemory(row) : null;
}

export async function createMemory(
  db: D1Database,
  input: { userId: string; title: string; contentMd: string; source: 'agent' | 'user'; now?: number }
): Promise<Memory> {
  assertUserId(input.userId);
  await ensureMemorySchema(db);
  const now = input.now ?? Date.now();
  const memory: Memory = {
    id: crypto.randomUUID(),
    userId: input.userId,
    title: input.title,
    contentMd: input.contentMd,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  await db
    .prepare(`INSERT INTO user_memories (id, user_id, title, content_md, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(memory.id, memory.userId, memory.title, memory.contentMd, memory.source, now, now)
    .run();
  return memory;
}

export async function updateMemory(
  db: D1Database,
  userId: string,
  id: string,
  patch: { title?: string; contentMd?: string; now?: number }
): Promise<Memory | null> {
  assertUserId(userId);
  await ensureMemorySchema(db);
  const current = await getMemory(db, userId, id);
  if (!current) return null;
  const now = patch.now ?? Date.now();
  const title = patch.title ?? current.title;
  const contentMd = patch.contentMd ?? current.contentMd;
  await db
    .prepare(`UPDATE user_memories SET title = ?, content_md = ?, updated_at = ? WHERE user_id = ? AND id = ?`)
    .bind(title, contentMd, now, userId, id)
    .run();
  return { ...current, title, contentMd, updatedAt: now };
}

export async function deleteMemory(db: D1Database, userId: string, id: string): Promise<boolean> {
  assertUserId(userId);
  await ensureMemorySchema(db);
  const res = await db.prepare(`DELETE FROM user_memories WHERE user_id = ? AND id = ?`).bind(userId, id).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Anon→user claim: re-parent everything an anonymous session wrote onto the
 * now-authenticated account. Mirrors store/connections.ts reassignConnections
 * so the claim flow can adopt user_memories with one extra call. */
export async function reassignMemories(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  assertUserId(fromUserId);
  assertUserId(toUserId);
  await ensureMemorySchema(db);
  await db.prepare(`UPDATE user_memories SET user_id = ? WHERE user_id = ?`).bind(toUserId, fromUserId).run();
}
