// Developer API keys — programmatic access to the pipeline (routes: /v1/*).
//
// Key format: `cc_live_<48 hex chars>`. Only the SHA-256 hash is stored; the
// full key is returned exactly once, at creation. Usage (request count +
// accumulated run cost) lives on the key row itself — one table, no join,
// good enough for a per-key usage readout.
//
// Lazily provisioned like the cache tables (WeakSet ensure), so production
// needs no migration step; the DDL should also join worker/schema.sql for
// `pnpm db:reset`.
import { sha256Hex } from '../hash';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, last4 TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER,
  requests INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`;

/** Idempotent DDL — tests call this per-test (isolated storage resets D1
 * between tests while module state persists, so the WeakSet guard below
 * must not be the only path to a CREATE). */
export async function applyApiKeysSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

const ensured = new WeakSet<D1Database>();
async function ensureSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  await applyApiKeysSchema(db);
  ensured.add(db);
}

export interface ApiKeyRow {
  id: string;
  name: string;
  /** Masked display form, e.g. `cc_live_…a1b2`. The full key is never stored. */
  masked: string;
  createdAt: number;
  lastUsedAt: number | null;
  requests: number;
  costUsd: number;
}

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createApiKey(
  db: D1Database,
  p: { userId: string; name: string; now: number }
): Promise<{ id: string; name: string; key: string; masked: string; createdAt: number }> {
  await ensureSchema(db);
  const id = crypto.randomUUID();
  const key = `cc_live_${randomHex(24)}`;
  const last4 = key.slice(-4);
  await db
    .prepare('INSERT INTO api_keys(id, user_id, name, key_hash, last4, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, p.userId, p.name, await sha256Hex(key), last4, p.now)
    .run();
  return { id, name: p.name, key, masked: `cc_live_…${last4}`, createdAt: p.now };
}

export async function listApiKeys(db: D1Database, userId: string): Promise<ApiKeyRow[]> {
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, name, last4, created_at, last_used_at, requests, cost_usd
       FROM api_keys WHERE user_id=? ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<{ id: string; name: string; last4: string; created_at: number; last_used_at: number | null; requests: number; cost_usd: number }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    masked: `cc_live_…${r.last4}`,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    requests: r.requests,
    costUsd: r.cost_usd,
  }));
}

export async function deleteApiKey(db: D1Database, userId: string, id: string): Promise<boolean> {
  await ensureSchema(db);
  const res = await db.prepare('DELETE FROM api_keys WHERE id=? AND user_id=?').bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Bearer key → owning user. Bumps last_used_at + request count as a side
 * effect (the request is being served either way). Null on unknown key. */
export async function resolveApiKey(
  db: D1Database,
  key: string,
  now: number
): Promise<{ userId: string; keyId: string } | null> {
  if (!key.startsWith('cc_live_')) return null;
  await ensureSchema(db);
  const row = await db
    .prepare('SELECT id, user_id FROM api_keys WHERE key_hash=?')
    .bind(await sha256Hex(key))
    .first<{ id: string; user_id: string }>();
  if (!row) return null;
  await db
    .prepare('UPDATE api_keys SET last_used_at=?, requests=requests+1 WHERE id=?')
    .bind(now, row.id)
    .run();
  return { userId: row.user_id, keyId: row.id };
}

export async function recordApiKeyCost(db: D1Database, keyId: string, costUsd: number): Promise<void> {
  if (!(costUsd > 0)) return;
  await db.prepare('UPDATE api_keys SET cost_usd=cost_usd+? WHERE id=?').bind(costUsd, keyId).run();
}
