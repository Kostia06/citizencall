import { DEFAULT_PREFS, mergePrefs, type UserPrefs } from './prefs';

export async function getSettings(db: D1Database, userId: string): Promise<UserPrefs> {
  const row = await db.prepare(`SELECT prefs_json FROM user_settings WHERE user_id=?`).bind(userId).first<{ prefs_json: string }>();
  if (!row) return DEFAULT_PREFS;
  try {
    return mergePrefs(DEFAULT_PREFS, JSON.parse(row.prefs_json) as Partial<UserPrefs>);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function putSettings(db: D1Database, userId: string, patch: Partial<UserPrefs>, now: number): Promise<UserPrefs> {
  const current = await getSettings(db, userId);
  const merged = mergePrefs(current, patch);
  await db
    .prepare(`INSERT INTO user_settings(user_id,prefs_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET prefs_json=excluded.prefs_json, updated_at=excluded.updated_at`)
    .bind(userId, JSON.stringify(merged), now)
    .run();
  return merged;
}
