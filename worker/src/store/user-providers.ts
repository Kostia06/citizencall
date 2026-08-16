// user_providers store — a user's own model API keys (Anthropic / OpenAI /
// any OpenAI-compatible endpoint), used by the pipeline as the FINAL
// escalation rung (see pipeline/execute.ts). Owner-scoped like the rest of
// the store: every statement keys on user_id.
//
// Lazy-provisioned like routines/memory (ensure per D1 binding per isolate)
// so the table exists in production without extra wiring; the same DDL also
// lives in db.ts applyStoreSchema for test environments.
//
// SECURITY: api_key is stored plaintext in D1 — an accepted hackathon
// tradeoff. It leaves this module only toward the model provider itself
// (providers/user-models.ts); routes must mask it (maskApiKey) and never
// echo it back after creation.
import type { UserProvider, UserProviderKind } from '../providers/user-models';

const PROVIDERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_providers(id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('anthropic','openai','custom')), base_url TEXT,
  model TEXT NOT NULL, api_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_providers_user ON user_providers(user_id);`;

const ensured = new WeakSet<D1Database>();

async function ensureProvidersSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  for (const stmt of PROVIDERS_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  ensured.add(db);
}

interface ProviderRow {
  id: string;
  user_id: string;
  kind: UserProviderKind;
  base_url: string | null;
  model: string;
  api_key: string;
  enabled: number;
  created_at: number;
}

function rowToProvider(r: ProviderRow): UserProvider {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    baseUrl: r.base_url,
    model: r.model,
    apiKey: r.api_key,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  };
}

/** `…last4` — enough for the owner to recognize the key, useless to steal. */
export function maskApiKey(apiKey: string): string {
  return `…${apiKey.slice(-4)}`;
}

export async function listProviders(db: D1Database, userId: string): Promise<UserProvider[]> {
  await ensureProvidersSchema(db);
  const { results } = await db
    .prepare(`SELECT * FROM user_providers WHERE user_id=? ORDER BY created_at DESC`)
    .bind(userId)
    .all<ProviderRow>();
  return results.map(rowToProvider);
}

export async function createProvider(
  db: D1Database,
  input: {
    userId: string;
    kind: UserProviderKind;
    baseUrl?: string;
    model: string;
    apiKey: string;
    enabled?: boolean;
    now: number;
  }
): Promise<UserProvider> {
  await ensureProvidersSchema(db);
  const id = crypto.randomUUID();
  const enabled = input.enabled ?? true;
  await db
    .prepare(
      `INSERT INTO user_providers(id,user_id,kind,base_url,model,api_key,enabled,created_at)
       VALUES(?,?,?,?,?,?,?,?)`
    )
    .bind(id, input.userId, input.kind, input.baseUrl ?? null, input.model, input.apiKey, enabled ? 1 : 0, input.now)
    .run();
  return {
    id,
    userId: input.userId,
    kind: input.kind,
    baseUrl: input.baseUrl ?? null,
    model: input.model,
    apiKey: input.apiKey,
    enabled,
    createdAt: input.now,
  };
}

export async function setProviderEnabled(
  db: D1Database,
  userId: string,
  id: string,
  enabled: boolean
): Promise<boolean> {
  await ensureProvidersSchema(db);
  const res = await db
    .prepare(`UPDATE user_providers SET enabled=? WHERE id=? AND user_id=?`)
    .bind(enabled ? 1 : 0, id, userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteProvider(db: D1Database, userId: string, id: string): Promise<boolean> {
  await ensureProvidersSchema(db);
  const res = await db.prepare(`DELETE FROM user_providers WHERE id=? AND user_id=?`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** The provider the pipeline escalates to: newest enabled row wins. Loaded
 * once per run (pipeline/run.ts), like connections. */
export async function getEnabledProvider(db: D1Database, userId: string): Promise<UserProvider | null> {
  await ensureProvidersSchema(db);
  const row = await db
    .prepare(`SELECT * FROM user_providers WHERE user_id=? AND enabled=1 ORDER BY created_at DESC LIMIT 1`)
    .bind(userId)
    .first<ProviderRow>();
  return row ? rowToProvider(row) : null;
}
