CREATE TABLE IF NOT EXISTS user_connections(user_id TEXT NOT NULL, toolkit TEXT NOT NULL, connected_account_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', connected_at INTEGER NOT NULL, PRIMARY KEY(user_id, toolkit));
CREATE TABLE IF NOT EXISTS user_mcps(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_tools(user_id TEXT NOT NULL, toolkit TEXT NOT NULL, tool TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, toolkit, tool));
CREATE TABLE IF NOT EXISTS user_settings(user_id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_mcps_user ON user_mcps(user_id);
