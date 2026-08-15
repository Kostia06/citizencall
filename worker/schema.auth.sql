CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL,
  user_agent TEXT, ip TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS email_tokens(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER);

CREATE TABLE IF NOT EXISTS auth_attempts(
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0);

-- Retired refresh-token hashes, kept ~30 days (matches refresh TTL) so a
-- replayed already-rotated token can be recognized as reuse (not just
-- "unknown") and its whole session family revoked.
CREATE TABLE IF NOT EXISTS retired_hashes(
  hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  retired_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);
CREATE INDEX IF NOT EXISTS idx_retired_hashes_family ON retired_hashes(family_id);
