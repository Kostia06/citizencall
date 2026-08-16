// Typed D1 helpers over schema.sql (SPEC.md §12). Every write the pipeline
// needs goes through here so the SQL lives in one place and the DO stays
// focused on orchestration.
import type { Hop, Plan, TaskKind } from './types';

const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL, refresh_hash TEXT NOT NULL, user_agent TEXT, ip TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS email_tokens(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS auth_attempts(bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS retired_hashes(hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, retired_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);
CREATE INDEX IF NOT EXISTS idx_retired_hashes_family ON retired_hashes(family_id);`;

export async function applyAuthSchema(db: D1Database): Promise<void> {
  for (const stmt of AUTH_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

const STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_connections(user_id TEXT NOT NULL, toolkit TEXT NOT NULL, connected_account_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', connected_at INTEGER NOT NULL, PRIMARY KEY(user_id, toolkit));
CREATE TABLE IF NOT EXISTS user_mcps(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_tools(user_id TEXT NOT NULL, toolkit TEXT NOT NULL, tool TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, toolkit, tool));
CREATE TABLE IF NOT EXISTS user_settings(user_id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_providers(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('anthropic','openai','custom')), base_url TEXT, model TEXT NOT NULL, api_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_mcps_user ON user_mcps(user_id);
CREATE INDEX IF NOT EXISTS idx_user_providers_user ON user_providers(user_id);`;

export async function applyStoreSchema(db: D1Database): Promise<void> {
  for (const stmt of STORE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

export interface RunRow {
  id: string;
  userId: string;
  requestText: string;
  source: 'text' | 'voice';
  transcriptRaw: string | null;
  createdAt: number;
}

export async function insertRun(db: D1Database, run: RunRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO runs (id, user_id, request_text, source, transcript_raw, created_at, status,
        total_cost_usd, baseline_cost_usd, total_ms, cache_hits, plan_cache_hit)
       VALUES (?, ?, ?, ?, ?, ?, 'running', 0, 0, 0, 0, 0)`
    )
    .bind(run.id, run.userId, run.requestText, run.source, run.transcriptRaw, run.createdAt)
    .run();
}

export async function finalizeRun(
  db: D1Database,
  runId: string,
  totals: { totalCostUsd: number; baselineCostUsd: number; totalMs: number; cacheHits: number; planCacheHit: boolean }
): Promise<void> {
  await db
    .prepare(
      `UPDATE runs SET status = 'done', total_cost_usd = ?, baseline_cost_usd = ?, total_ms = ?,
        cache_hits = ?, plan_cache_hit = ? WHERE id = ?`
    )
    .bind(
      totals.totalCostUsd,
      totals.baselineCostUsd,
      totals.totalMs,
      totals.cacheHits,
      totals.planCacheHit ? 1 : 0,
      runId
    )
    .run();
}

export async function markRunErrored(db: D1Database, runId: string): Promise<void> {
  await db.prepare(`UPDATE runs SET status = 'error' WHERE id = ?`).bind(runId).run();
}

// Persist the user-visible reply on the run row so a restored session shows
// the actual conversation, not just cost receipts (found in review: history
// restore looked "unsaved" because no answer text survived the run). Lazy
// idempotent ALTER — the column postdates shipped schemas.
let answerColumnReady = false;
export async function saveRunAnswer(db: D1Database, runId: string, text: string): Promise<void> {
  if (!answerColumnReady) {
    await db.exec(`ALTER TABLE runs ADD COLUMN answer_text TEXT`).catch(() => undefined); // exists already
    answerColumnReady = true;
  }
  await db.prepare(`UPDATE runs SET answer_text = ? WHERE id = ?`).bind(text, runId).run();
}

export async function insertSubTasks(db: D1Database, runId: string, plan: Plan): Promise<void> {
  if (plan.subTasks.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO sub_tasks (id, run_id, idx, kind, ctx_needed, needs_tools, sensitive, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    plan.subTasks.map((t) =>
      stmt.bind(
        t.id,
        runId,
        t.idx,
        t.kind,
        t.ctxNeeded,
        t.needsTools ? 1 : 0,
        t.sensitive ? 1 : 0,
        JSON.stringify(t)
      )
    )
  );
}

// Accumulate hops in the DO; flush once here with db.batch() — D1 is
// single-threaded per database (SPEC.md §12).
export async function flushHops(db: D1Database, runId: string, hops: Hop[]): Promise<void> {
  if (hops.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO hops (id, run_id, sub_task_id, model_id, model_class, params_b,
      prompt_tokens, completion_tokens, cost_usd, latency_ms, availability, verdict,
      escalated_from, cache_hit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    hops.map((h) =>
      stmt.bind(
        h.id,
        runId,
        h.subTaskId,
        h.modelId,
        h.modelClass,
        h.paramsB,
        h.promptTokens,
        h.completionTokens,
        h.costUsd,
        h.latencyMs,
        h.availability,
        h.verdict,
        h.escalatedFrom ?? null,
        h.cacheHit,
        Date.now()
      )
    )
  );
}

export interface ToolCallRow {
  id: string;
  runId: string;
  subTaskId: string;
  toolkit: string;
  tool: string;
  argsHash: string;
  cacheHit: boolean;
  latencyMs: number;
}

export async function flushToolCalls(db: D1Database, calls: ToolCallRow[]): Promise<void> {
  if (calls.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO tool_calls (id, run_id, sub_task_id, toolkit, tool, args_hash, cache_hit, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    calls.map((c) =>
      stmt.bind(
        c.id,
        c.runId,
        c.subTaskId,
        c.toolkit,
        c.tool,
        c.argsHash,
        c.cacheHit ? 1 : 0,
        c.latencyMs,
        Date.now()
      )
    )
  );
}

export async function getRun(db: D1Database, runId: string) {
  const run = await db.prepare(`SELECT * FROM runs WHERE id = ?`).bind(runId).first();
  if (!run) return null;
  const { results: hops } = await db.prepare(`SELECT * FROM hops WHERE run_id = ?`).bind(runId).all();
  const { results: toolCalls } = await db
    .prepare(`SELECT * FROM tool_calls WHERE run_id = ?`)
    .bind(runId)
    .all();
  return { run, hops, toolCalls };
}

export async function getRoster(db: D1Database) {
  const { results } = await db.prepare(`SELECT * FROM roster ORDER BY task_kind, model_id`).all();
  return results;
}

// ---- L1 exact / L4 verdict share cache_entries; L3 plan has its own table ----

export interface CacheEntry {
  cacheKey: string;
  tier: string;
  userId: string | null;
  valueJson: string;
  createdAt: number;
  expiresAt: number;
}

export async function getCacheEntry(db: D1Database, cacheKey: string): Promise<CacheEntry | null> {
  const row = await db
    .prepare(`SELECT * FROM cache_entries WHERE cache_key = ? AND expires_at > ?`)
    .bind(cacheKey, Date.now())
    .first<{
      cache_key: string;
      tier: string;
      user_id: string | null;
      value_json: string;
      created_at: number;
      expires_at: number;
    }>();
  if (!row) return null;
  await db.prepare(`UPDATE cache_entries SET hits = hits + 1 WHERE cache_key = ?`).bind(cacheKey).run();
  return {
    cacheKey: row.cache_key,
    tier: row.tier,
    userId: row.user_id,
    valueJson: row.value_json,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function putCacheEntry(db: D1Database, entry: CacheEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cache_entries (cache_key, tier, user_id, value_json, created_at, expires_at, hits)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(cache_key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at`
    )
    .bind(entry.cacheKey, entry.tier, entry.userId, entry.valueJson, entry.createdAt, entry.expiresAt)
    .run();
}

export async function getPlanCacheEntry(
  db: D1Database,
  normalized: string
): Promise<{ planJson: string } | null> {
  const row = await db
    .prepare(`SELECT plan_json FROM plan_cache WHERE normalized = ?`)
    .bind(normalized)
    .first<{ plan_json: string }>();
  if (!row) return null;
  await db
    .prepare(`UPDATE plan_cache SET hits = hits + 1 WHERE normalized = ?`)
    .bind(normalized)
    .run();
  return { planJson: row.plan_json };
}

export async function putPlanCacheEntry(db: D1Database, normalized: string, plan: Plan): Promise<void> {
  await db
    .prepare(
      `INSERT INTO plan_cache (normalized, plan_json, created_at, hits) VALUES (?, ?, ?, 0)
       ON CONFLICT(normalized) DO UPDATE SET plan_json = excluded.plan_json`
    )
    .bind(normalized, JSON.stringify(plan), Date.now())
    .run();
}

export async function recordVerifierAttempt(
  db: D1Database,
  modelId: string,
  kind: TaskKind,
  failed: boolean
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO verifier_stats (model_id, task_kind, attempts, failures, updated_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(model_id, task_kind) DO UPDATE SET
         attempts = attempts + 1, failures = failures + excluded.failures, updated_at = excluded.updated_at`
    )
    .bind(modelId, kind, failed ? 1 : 0, Date.now())
    .run();
}

export async function getVerifierFailureRate(
  db: D1Database,
  modelId: string,
  kind: TaskKind
): Promise<number | null> {
  const row = await db
    .prepare(`SELECT attempts, failures FROM verifier_stats WHERE model_id = ? AND task_kind = ?`)
    .bind(modelId, kind)
    .first<{ attempts: number; failures: number }>();
  if (!row || row.attempts === 0) return null;
  return row.failures / row.attempts;
}
