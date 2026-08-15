-- Understudy — D1 schema. Mirrors SPEC.md §12.
-- D1 is single-threaded per database; accumulate hops in the DO and flush once with db.batch().

CREATE TABLE IF NOT EXISTS runs(
  id TEXT PRIMARY KEY, user_id TEXT, request_text TEXT, source TEXT,
  transcript_raw TEXT, created_at INTEGER, status TEXT,
  total_cost_usd REAL, baseline_cost_usd REAL, total_ms INTEGER,
  cache_hits INTEGER DEFAULT 0, plan_cache_hit INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS sub_tasks(
  id TEXT PRIMARY KEY, run_id TEXT, idx INTEGER, kind TEXT,
  ctx_needed INTEGER, needs_tools INTEGER, sensitive INTEGER DEFAULT 0, payload_json TEXT);

CREATE TABLE IF NOT EXISTS hops(
  id TEXT PRIMARY KEY, run_id TEXT, sub_task_id TEXT,
  model_id TEXT, model_class TEXT, params_b REAL,
  prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, latency_ms INTEGER,
  availability TEXT, verdict TEXT, escalated_from TEXT, cache_hit TEXT, created_at INTEGER);

CREATE TABLE IF NOT EXISTS tool_calls(
  id TEXT PRIMARY KEY, run_id TEXT, sub_task_id TEXT,
  toolkit TEXT, tool TEXT, args_hash TEXT, cache_hit INTEGER, latency_ms INTEGER, created_at INTEGER);

CREATE TABLE IF NOT EXISTS roster(
  task_kind TEXT, model_id TEXT, model_class TEXT, promoted_at INTEGER,
  accuracy REAL, ci_lo REAL, ci_hi REAL, cost_per_1k REAL,
  displaced_model_id TEXT, hf_downloads INTEGER, PRIMARY KEY(task_kind, model_id));

CREATE TABLE IF NOT EXISTS verifier_stats(
  model_id TEXT, task_kind TEXT, attempts INTEGER DEFAULT 0,
  failures INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY(model_id, task_kind));

CREATE TABLE IF NOT EXISTS cache_entries(
  cache_key TEXT PRIMARY KEY, tier TEXT, user_id TEXT,
  value_json TEXT, created_at INTEGER, expires_at INTEGER, hits INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS plan_cache(
  normalized TEXT PRIMARY KEY, plan_json TEXT,
  created_at INTEGER, hits INTEGER DEFAULT 0);

CREATE INDEX IF NOT EXISTS idx_hops_run ON hops(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cache_exp ON cache_entries(expires_at);

-- Per-user run-result cache (pipeline/run.ts; self-provisions lazily too)
CREATE TABLE IF NOT EXISTS run_cache(cache_key TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  policy_version TEXT NOT NULL, value_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_run_cache_user ON run_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_run_cache_exp ON run_cache(expires_at);

-- 2FA email-OTP challenges (auth/twofa.ts; self-provisions lazily too).
-- users.twofa_enabled INTEGER NOT NULL DEFAULT 1 is added by an idempotent
-- ALTER in ensureTwofaSchema — the users table lives in schema.auth.sql, not
-- here, so the column migration cannot be expressed in this file.
CREATE TABLE IF NOT EXISTS twofa_challenges(id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 1,
  last_sent_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_twofa_user ON twofa_challenges(user_id);

-- /api/sessions lists an actor's runs — unindexed user_id scans got slow.
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
