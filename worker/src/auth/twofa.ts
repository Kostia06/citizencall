// Email-OTP second factor for login. Challenge codes are hashed at rest
// (same hashing family as refresh/email tokens), single-use, and consumed
// atomically with the UPDATE...RETURNING pattern from users.ts so two
// concurrent verifies can never both spend the same code.
import type { Env } from '../env';
import { generateToken, hashToken } from './tokens';

export const TWOFA_CODE_TTL_MS = 10 * 60_000;
export const TWOFA_RESEND_MIN_INTERVAL_MS = 30_000;
export const TWOFA_MAX_ATTEMPTS = 5;
export const TWOFA_MAX_SENDS = 5;

// Applied the same way as ensureRunCacheSchema (cache/schema.ts): an
// idempotent block callable from tests and ensured lazily by the auth
// routes, so production needs no extra wiring in index.ts. The equivalent
// DDL is also appended to worker/schema.sql for up-front provisioning.
const TWOFA_SCHEMA = `
CREATE TABLE IF NOT EXISTS twofa_challenges(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 1, last_sent_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_twofa_user ON twofa_challenges(user_id)`;

// One ensure per D1 binding per isolate (same memo pattern as cache/schema.ts).
const ensured = new WeakSet<D1Database>();

export async function ensureTwofaSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  for (const stmt of TWOFA_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  // Idempotent migration: SQLite has no ADD COLUMN IF NOT EXISTS, so a
  // duplicate-column error is the "already migrated" signal; anything else
  // is a real failure and must propagate.
  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 1`).run();
  } catch (e) {
    if (!String(e).toLowerCase().includes('duplicate column')) throw e;
  }
  ensured.add(db);
}

// Uniform 6-digit code via rejection sampling: 4_000_000_000 is an exact
// multiple of 1_000_000, so the modulo below introduces no bias.
export function generateOtpCode(): string {
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n !== undefined && n < 4_000_000_000) return String(n % 1_000_000).padStart(6, '0');
  }
}

// Bind the hash to the challenge id so equal codes on different challenges
// never share a stored hash (no cross-challenge rainbow lookups).
const codeHash = (challengeId: string, code: string) => hashToken(`${challengeId}:${code}`);

export async function createChallenge(
  db: D1Database,
  userId: string,
  now: number
): Promise<{ challengeId: string; code: string }> {
  const challengeId = generateToken(); // opaque, 256-bit random
  const code = generateOtpCode();
  await db
    .prepare(
      `INSERT INTO twofa_challenges(id,user_id,code_hash,expires_at,attempts,sends,last_sent_at,consumed_at)
       VALUES(?,?,?,?,0,1,?,NULL)`
    )
    .bind(challengeId, userId, await codeHash(challengeId, code), now + TWOFA_CODE_TTL_MS, now)
    .run();
  return { challengeId, code };
}

// Returns the userId on success, null on any failure (wrong code, expired,
// consumed, dead, unknown challenge) — callers answer with one generic error.
export async function verifyChallenge(
  db: D1Database,
  challengeId: string,
  code: string,
  now: number
): Promise<string | null> {
  // Spend one attempt atomically. A consumed, expired, or dead (attempts
  // exhausted) challenge matches nothing, so it costs nothing and reveals
  // nothing. The attempts<max guard runs inside the same UPDATE that
  // increments, so concurrent guesses can't exceed the cap.
  const row = await db
    .prepare(
      `UPDATE twofa_challenges SET attempts=attempts+1
       WHERE id=? AND consumed_at IS NULL AND attempts<? AND expires_at>=?
       RETURNING user_id, code_hash`
    )
    .bind(challengeId, TWOFA_MAX_ATTEMPTS, now)
    .first<{ user_id: string; code_hash: string }>();
  if (!row) return null;
  if (row.code_hash !== (await codeHash(challengeId, code))) return null;
  // Atomic single-use consumption: only one concurrent caller can match the
  // consumed_at IS NULL guard; code_hash in the WHERE pins it to the code we
  // just checked in case a resend rotated it in between.
  const consumed = await db
    .prepare(
      `UPDATE twofa_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND code_hash=? RETURNING user_id`
    )
    .bind(now, challengeId, row.code_hash)
    .first<{ user_id: string }>();
  return consumed ? consumed.user_id : null;
}

export type ResendResult = { status: 'ok'; userId: string; code: string } | { status: 'denied' };

// Rotates the code: the old code dies in the same UPDATE that installs the
// new one. Rate limits (30s spacing, 5 sends max) and liveness (not consumed,
// attempts not exhausted) are guards on that same UPDATE, so there is no
// check-then-write race. attempts are NOT reset — the 5-guess budget is per
// challenge, not per code. 'denied' covers unknown/dead/rate-limited alike;
// callers must answer generically either way.
export async function resendChallenge(
  db: D1Database,
  challengeId: string,
  now: number
): Promise<ResendResult> {
  const code = generateOtpCode();
  const row = await db
    .prepare(
      `UPDATE twofa_challenges SET code_hash=?, sends=sends+1, last_sent_at=?, expires_at=?
       WHERE id=? AND consumed_at IS NULL AND attempts<? AND sends<? AND last_sent_at<=?
       RETURNING user_id`
    )
    .bind(
      await codeHash(challengeId, code),
      now,
      now + TWOFA_CODE_TTL_MS,
      challengeId,
      TWOFA_MAX_ATTEMPTS,
      TWOFA_MAX_SENDS,
      now - TWOFA_RESEND_MIN_INTERVAL_MS
    )
    .first<{ user_id: string }>();
  return row ? { status: 'ok', userId: row.user_id, code } : { status: 'denied' };
}

export async function isTwofaEnabled(db: D1Database, userId: string): Promise<boolean> {
  const r = await db
    .prepare(`SELECT twofa_enabled FROM users WHERE id=?`)
    .bind(userId)
    .first<{ twofa_enabled: number }>();
  return !!r?.twofa_enabled;
}

// devCode may appear in responses ONLY when there is no real delivery
// channel (no RESEND_API_KEY) or the dev bypass flag is explicitly the
// string 'true'. A production deploy with a key configured and without the
// flag never leaks it — adding the key via `wrangler secret put` flips to
// real email with zero code change.
export function shouldExposeDevCode(env: Env): boolean {
  return env.DEV_AUTH_BYPASS === 'true' || !env.RESEND_API_KEY;
}
