import { generateToken, hashToken } from './tokens';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(
  db: D1Database,
  a: { userId: string; userAgent: string | null; ip: string | null; now: number }
): Promise<{ sessionId: string; refreshToken: string }> {
  const sessionId = crypto.randomUUID();
  const familyId = crypto.randomUUID();
  const refreshToken = generateToken();
  await db
    .prepare(
      `INSERT INTO sessions(id,user_id,family_id,refresh_hash,user_agent,ip,created_at,last_used_at,expires_at,revoked)
       VALUES(?,?,?,?,?,?,?,?,?,0)`
    )
    .bind(sessionId, a.userId, familyId, await hashToken(refreshToken), a.userAgent, a.ip, a.now, a.now, a.now + REFRESH_TTL_MS)
    .run();
  return { sessionId, refreshToken };
}

// Rotation + reuse-detection.
//
// Each session row tracks only its *current* refresh_hash; rotating a token
// overwrites it. That alone can't tell "never existed" apart from "already
// rotated away" once the old hash is gone from `sessions`, so every hash we
// retire is recorded in `retired_hashes` (hash -> family_id) for ~30 days.
// A lookup miss against `sessions` that DOES hit `retired_hashes` means the
// presented token was valid once but has already been superseded — a classic
// stolen-token replay — so the whole family gets revoked.
//
// A `revoked` row hit via its still-current hash (e.g. from revokeAllForUser
// or revokeSession, with no rotation in between) is a dead session, not a
// theft signal, so that path returns 'invalid' rather than 'reused'.
export async function rotateSession(
  db: D1Database,
  refreshToken: string,
  now: number
): Promise<{ sessionId: string; userId: string; refreshToken: string } | 'invalid' | 'reused'> {
  const hash = await hashToken(refreshToken);

  const row = await db
    .prepare(`SELECT id,user_id,family_id,expires_at,revoked FROM sessions WHERE refresh_hash=?`)
    .bind(hash)
    .first<{ id: string; user_id: string; family_id: string; expires_at: number; revoked: number }>();

  if (row) {
    if (row.revoked === 1 || row.expires_at < now) return 'invalid';

    // Optimistic rotation: the read above isn't atomic with this write, so a
    // concurrent caller presenting the SAME still-valid token (e.g. a mobile
    // client retrying a refresh) can reach this point too. `INSERT OR IGNORE`
    // means a duplicate retire from that race can never throw a PK-constraint
    // error, and the `WHERE ... AND refresh_hash=?` guard means at most one of
    // the racing UPDATEs actually advances the session.
    const next = generateToken();
    const nextHash = await hashToken(next);
    const results = await db.batch([
      db
        .prepare(`INSERT OR IGNORE INTO retired_hashes(hash,family_id,retired_at) VALUES(?,?,?)`)
        .bind(hash, row.family_id, now),
      db
        .prepare(
          `UPDATE sessions SET refresh_hash=?, last_used_at=?, expires_at=?
           WHERE id=? AND refresh_hash=? AND revoked=0`
        )
        .bind(nextHash, now, now + REFRESH_TTL_MS, row.id, hash),
    ]);
    const updateResult = results[1];
    const rowsChanged = updateResult?.meta.changes ?? 0;

    if (rowsChanged === 0) {
      // Lost the race: another rotation already advanced this session past
      // `hash` between our read and our write, so the token we were just
      // handed is already retired. That's a replay, even though it came from
      // a legitimate concurrent caller rather than an attacker.
      await db.prepare(`UPDATE sessions SET revoked=1 WHERE family_id=?`).bind(row.family_id).run();
      return 'reused';
    }
    return { sessionId: row.id, userId: row.user_id, refreshToken: next };
  }

  const retired = await db
    .prepare(`SELECT family_id FROM retired_hashes WHERE hash=?`)
    .bind(hash)
    .first<{ family_id: string }>();
  if (!retired) return 'invalid';

  await db.prepare(`UPDATE sessions SET revoked=1 WHERE family_id=?`).bind(retired.family_id).run();
  return 'reused';
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare(`UPDATE sessions SET revoked=1 WHERE id=?`).bind(sessionId).run();
}

// Scoped variant for caller-supplied session ids (e.g. DELETE /sessions/:id):
// only revokes if the session actually belongs to userId, preventing one
// user from revoking another user's session by guessing/enumerating ids.
export async function revokeSessionForUser(db: D1Database, sessionId: string, userId: string): Promise<boolean> {
  const res = await db.prepare(`UPDATE sessions SET revoked=1 WHERE id=? AND user_id=?`).bind(sessionId, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function revokeAllForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`UPDATE sessions SET revoked=1 WHERE user_id=?`).bind(userId).run();
}

export async function listSessions(
  db: D1Database,
  userId: string
): Promise<Array<{ id: string; userAgent: string | null; ip: string | null; lastUsedAt: number }>> {
  const { results } = await db
    .prepare(`SELECT id,user_agent,ip,last_used_at FROM sessions WHERE user_id=? AND revoked=0 ORDER BY last_used_at DESC`)
    .bind(userId)
    .all<{ id: string; user_agent: string | null; ip: string | null; last_used_at: number }>();
  return results.map((r) => ({ id: r.id, userAgent: r.user_agent, ip: r.ip, lastUsedAt: r.last_used_at }));
}
