import { generateToken, hashToken } from './tokens';

export type UserRow = { id: string; email: string; emailVerified: boolean; createdAt: number };
const norm = (e: string) => e.trim().toLowerCase();

export async function createUser(
  db: D1Database,
  a: { email: string; passwordHash: string; now: number }
): Promise<UserRow> {
  const id = crypto.randomUUID();
  const email = norm(a.email);
  await db
    .prepare(`INSERT INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,0,?, 'active',?,?)`)
    .bind(id, email, a.passwordHash, a.now, a.now)
    .run();
  return { id, email, emailVerified: false, createdAt: a.now };
}

export async function getUserByEmail(db: D1Database, email: string) {
  const r = await db
    .prepare(`SELECT id,email,email_verified,password_hash,created_at FROM users WHERE email=?`)
    .bind(norm(email))
    .first<{ id: string; email: string; email_verified: number; password_hash: string; created_at: number }>();
  return r ? { id: r.id, email: r.email, emailVerified: !!r.email_verified, createdAt: r.created_at, passwordHash: r.password_hash } : null;
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  const r = await db
    .prepare(`SELECT id,email,email_verified,created_at FROM users WHERE id=?`)
    .bind(id)
    .first<{ id: string; email: string; email_verified: number; created_at: number }>();
  return r ? { id: r.id, email: r.email, emailVerified: !!r.email_verified, createdAt: r.created_at } : null;
}

export async function setEmailVerified(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE users SET email_verified=1, updated_at=? WHERE id=?`).bind(Date.now(), id).run();
}
export async function updatePassword(db: D1Database, id: string, passwordHash: string, now: number): Promise<void> {
  await db.prepare(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`).bind(passwordHash, now, id).run();
}

export async function createEmailToken(
  db: D1Database,
  a: { userId: string; type: 'verify' | 'reset'; now: number; ttlMs: number }
): Promise<string> {
  const token = generateToken();
  await db
    .prepare(`INSERT INTO email_tokens(id,user_id,type,token_hash,expires_at,used_at) VALUES(?,?,?,?,?,NULL)`)
    .bind(crypto.randomUUID(), a.userId, a.type, await hashToken(token), a.now + a.ttlMs)
    .run();
  return token;
}

export async function consumeEmailToken(
  db: D1Database,
  type: 'verify' | 'reset',
  token: string,
  now: number
): Promise<string | null> {
  const hash = await hashToken(token);
  const r = await db
    .prepare(`SELECT id,user_id,expires_at,used_at FROM email_tokens WHERE token_hash=? AND type=?`)
    .bind(hash, type)
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  if (!r || r.used_at !== null || r.expires_at < now) return null;
  await db.prepare(`UPDATE email_tokens SET used_at=? WHERE id=?`).bind(now, r.id).run();
  return r.user_id;
}
