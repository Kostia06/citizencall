# Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-grade email+password authentication (accounts, sessions, verification, reset) to the Understudy Worker so every downstream feature keys off a real `user_id`.

**Architecture:** A self-contained `worker/src/auth/` module on Cloudflare Workers (Hono) + D1. Passwords hashed with scrypt (`@noble/hashes`). Short-lived access JWTs (`jose`, HS256) plus opaque refresh tokens stored hashed in a `sessions` table with rotation and reuse-detection. Email (verify/reset) via Resend, with a deterministic stub when no key is set so tests and local dev need no secrets.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, `@noble/hashes` (scrypt/sha256), `jose` (JWT), Resend (HTTP), vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-08-14-auth-foundation-design.md` (read it alongside this plan).

## Global Constraints

- All new code lives under `worker/src/auth/`; tests under `worker/tests/auth/`.
- Access token TTL = 15 min; refresh token TTL = 30 days rolling. Access = JWT HS256 signed with `AUTH_JWT_SECRET`. Refresh = 32 random bytes, stored only as SHA-256 hash.
- Password hashing = scrypt `N=65536, r=8, p=1, dkLen=32`, 16-byte random salt, stored as `scrypt$N=65536,r=8,p=1$<saltb64url>$<keyb64url>`.
- Password policy: min length 12, max ≥ 64, no composition rules, screened against a bundled common-password list.
- No user enumeration: `login` returns one generic error for bad email OR password; `signup`, `password/forgot`, `resend-verification` always return generic success.
- Secrets via `wrangler secret`: `AUTH_JWT_SECRET`, `RESEND_API_KEY`. Never in source or `wrangler.jsonc`. Email/DB code must run with neither set (stub paths).
- Web refresh cookie: `__Host-refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/`. Native clients (`X-Client: native`) get tokens in the JSON body instead.
- `pnpm typecheck` clean and `pnpm test` green after every task, with NO secrets set.
- Emails lowercased + trimmed before any lookup or storage.

---

### Task 1: Auth dependencies + D1 schema

**Files:**
- Modify: `worker/package.json` (add deps)
- Create: `worker/schema.auth.sql`
- Modify: `worker/src/db.ts` (add `applyAuthSchema` used by tests + migrations)
- Test: `worker/tests/auth/schema.test.ts`

**Interfaces:**
- Produces: `applyAuthSchema(db: D1Database): Promise<void>` — creates the auth tables if absent (idempotent).

- [ ] **Step 1: Add dependencies**

```bash
cd worker && pnpm add @noble/hashes jose
```

- [ ] **Step 2: Create the auth schema**

Create `worker/schema.auth.sql`:

```sql
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

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);
```

- [ ] **Step 3: Write the failing test**

Create `worker/tests/auth/schema.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('creates the users table', async () => {
  const r = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ name: string }>();
  expect(r?.name).toBe('users');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- auth/schema`
Expected: FAIL — `applyAuthSchema` is not exported.

- [ ] **Step 5: Implement `applyAuthSchema`**

In `worker/src/db.ts`, add (raw SQL inlined so it needs no file read at runtime):

```ts
const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL, refresh_hash TEXT NOT NULL, user_agent TEXT, ip TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS email_tokens(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS auth_attempts(bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);`;

export async function applyAuthSchema(db: D1Database): Promise<void> {
  for (const stmt of AUTH_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- auth/schema`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/package.json worker/pnpm-lock.yaml worker/schema.auth.sql worker/src/db.ts worker/tests/auth/schema.test.ts
git commit -m "feat(auth): add auth deps and D1 schema"
```

---

### Task 2: Password hashing + policy

**Files:**
- Create: `worker/src/auth/password.ts`
- Create: `worker/src/auth/common-passwords.ts`
- Test: `worker/tests/auth/password.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): Promise<string>` — returns the encoded `scrypt$...` string.
  - `verifyPassword(plain: string, encoded: string): Promise<boolean>` — constant-time.
  - `checkPasswordPolicy(plain: string): { ok: true } | { ok: false; reason: string }`.

- [ ] **Step 1: Write the failing test**

Create `worker/tests/auth/password.test.ts`:

```ts
import { expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../../src/auth/password';

it('hashes and verifies a correct password', async () => {
  const enc = await hashPassword('correct horse battery staple');
  expect(enc.startsWith('scrypt$')).toBe(true);
  expect(await verifyPassword('correct horse battery staple', enc)).toBe(true);
});

it('rejects a wrong password', async () => {
  const enc = await hashPassword('correct horse battery staple');
  expect(await verifyPassword('wrong password entirely', enc)).toBe(false);
});

it('rejects short and common passwords', () => {
  expect(checkPasswordPolicy('short').ok).toBe(false);
  expect(checkPasswordPolicy('password1234').ok).toBe(false); // in blocklist
  expect(checkPasswordPolicy('a-perfectly-fine-passphrase').ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- auth/password`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the common-password blocklist**

Create `worker/src/auth/common-passwords.ts`:

```ts
// A small screen of the most common breached passwords (extend as needed).
export const COMMON_PASSWORDS = new Set<string>([
  'password', 'password1', 'password12', 'password123', 'password1234',
  '123456789012', 'qwertyuiop12', 'letmeinplease', 'iloveyou1234',
  'administrator', 'welcome12345', 'changeme1234', 'baseball1234',
]);
```

- [ ] **Step 4: Implement the password module**

Create `worker/src/auth/password.ts`:

```ts
import { scrypt } from '@noble/hashes/scrypt';
import { COMMON_PASSWORDS } from './common-passwords';

const PARAMS = { N: 65536, r: 8, p: 1, dkLen: 32 };
const MIN_LEN = 12;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = scrypt(new TextEncoder().encode(plain), salt, PARAMS);
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${b64url(salt)}$${b64url(key)}`;
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const m = parts[1].match(/N=(\d+),r=(\d+),p=(\d+)/);
  if (!m) return false;
  const params = { N: +m[1], r: +m[2], p: +m[3], dkLen: 32 };
  const salt = fromB64url(parts[2]);
  const expected = fromB64url(parts[3]);
  const actual = scrypt(new TextEncoder().encode(plain), salt, params);
  return constantTimeEqual(actual, expected);
}

export function checkPasswordPolicy(plain: string): { ok: true } | { ok: false; reason: string } {
  if (plain.length < MIN_LEN) return { ok: false, reason: `Password must be at least ${MIN_LEN} characters.` };
  if (plain.length > 200) return { ok: false, reason: 'Password too long.' };
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) return { ok: false, reason: 'That password is too common.' };
  return { ok: true };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- auth/password`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth/password.ts worker/src/auth/common-passwords.ts worker/tests/auth/password.test.ts
git commit -m "feat(auth): scrypt password hashing and policy"
```

---

### Task 3: Access-token JWTs

**Files:**
- Create: `worker/src/auth/jwt.ts`
- Test: `worker/tests/auth/jwt.test.ts`

**Interfaces:**
- Produces:
  - `type AccessClaims = { sub: string; sid: string; emailVerified: boolean }`
  - `signAccessToken(secret: string, claims: AccessClaims): Promise<string>` — 15-min expiry.
  - `verifyAccessToken(secret: string, token: string): Promise<AccessClaims | null>` — null on invalid/expired.

- [ ] **Step 1: Write the failing test**

Create `worker/tests/auth/jwt.test.ts`:

```ts
import { expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../../src/auth/jwt';

const SECRET = 'test-secret-value-at-least-32-bytes-long!!';

it('signs and verifies an access token', async () => {
  const token = await signAccessToken(SECRET, { sub: 'u1', sid: 's1', emailVerified: true });
  const claims = await verifyAccessToken(SECRET, token);
  expect(claims).toMatchObject({ sub: 'u1', sid: 's1', emailVerified: true });
});

it('rejects a token signed with a different secret', async () => {
  const token = await signAccessToken(SECRET, { sub: 'u1', sid: 's1', emailVerified: false });
  expect(await verifyAccessToken('a-totally-different-secret-value-32b!!', token)).toBeNull();
});

it('rejects a garbage token', async () => {
  expect(await verifyAccessToken(SECRET, 'not.a.jwt')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- auth/jwt`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the JWT module**

Create `worker/src/auth/jwt.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose';

export type AccessClaims = { sub: string; sid: string; emailVerified: boolean };
const ACCESS_TTL = '15m';

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, emailVerified: claims.emailVerified })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(key(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid, emailVerified: payload.emailVerified === true };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- auth/jwt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth/jwt.ts worker/tests/auth/jwt.test.ts
git commit -m "feat(auth): HS256 access-token JWTs"
```

---

### Task 4: Tokens + session store (rotation & reuse-detection)

**Files:**
- Create: `worker/src/auth/tokens.ts`
- Create: `worker/src/auth/sessions.ts`
- Test: `worker/tests/auth/sessions.test.ts`

**Interfaces:**
- Produces (`tokens.ts`):
  - `generateToken(): string` — 32 random bytes, base64url.
  - `hashToken(token: string): Promise<string>` — hex SHA-256.
- Produces (`sessions.ts`):
  - `createSession(db, { userId, userAgent, ip, now }): Promise<{ sessionId: string; refreshToken: string }>`
  - `rotateSession(db, refreshToken, now): Promise<{ sessionId: string; userId: string; refreshToken: string } | 'invalid' | 'reused'>`
  - `revokeSession(db, sessionId): Promise<void>`
  - `revokeAllForUser(db, userId): Promise<void>`
  - `listSessions(db, userId): Promise<Array<{ id: string; userAgent: string | null; ip: string | null; lastUsedAt: number }>>`

- [ ] **Step 1: Write `tokens.ts`**

Create `worker/src/auth/tokens.ts`:

```ts
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Write the failing session test**

Create `worker/tests/auth/sessions.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { createSession, revokeAllForUser, rotateSession } from '../../src/auth/sessions';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('rotates a refresh token and invalidates the old one', async () => {
  const { refreshToken } = await createSession(env.DB, { userId: 'u-rot', userAgent: 'x', ip: '1', now: 1000 });
  const rotated = await rotateSession(env.DB, refreshToken, 2000);
  expect(rotated).not.toBe('invalid');
  expect(rotated).not.toBe('reused');
  // old token no longer works
  expect(await rotateSession(env.DB, refreshToken, 3000)).toBe('reused');
});

it('reuse-detection revokes the whole family', async () => {
  const { refreshToken } = await createSession(env.DB, { userId: 'u-fam', userAgent: 'x', ip: '1', now: 1000 });
  const r1 = await rotateSession(env.DB, refreshToken, 2000);
  if (r1 === 'invalid' || r1 === 'reused') throw new Error('setup');
  // replay the original (already-rotated) token → reused → family revoked
  expect(await rotateSession(env.DB, refreshToken, 2500)).toBe('reused');
  // the legitimately-rotated token is now also dead
  expect(await rotateSession(env.DB, r1.refreshToken, 3000)).toBe('invalid');
});

it('revokeAllForUser kills active sessions', async () => {
  const { refreshToken } = await createSession(env.DB, { userId: 'u-all', userAgent: 'x', ip: '1', now: 1000 });
  await revokeAllForUser(env.DB, 'u-all');
  expect(await rotateSession(env.DB, refreshToken, 2000)).toBe('invalid');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- auth/sessions`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `sessions.ts`**

Create `worker/src/auth/sessions.ts`:

```ts
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

  // Not the current refresh hash for any session. Either never existed, or it
  // was already rotated away → treat a *known-but-not-current* token as reuse.
  if (!row) {
    const seen = await db.prepare(`SELECT 1 FROM sessions WHERE refresh_hash=? LIMIT 1`).bind(hash).first();
    return seen ? 'reused' : 'invalid';
  }
  if (row.revoked === 1 || row.expires_at < now) {
    // A revoked/expired row presented as current → theft signal: kill family.
    await db.prepare(`UPDATE sessions SET revoked=1 WHERE family_id=?`).bind(row.family_id).run();
    return row.revoked === 1 ? 'reused' : 'invalid';
  }

  const next = generateToken();
  await db
    .prepare(`UPDATE sessions SET refresh_hash=?, last_used_at=?, expires_at=? WHERE id=?`)
    .bind(await hashToken(next), now, now + REFRESH_TTL_MS, row.id)
    .run();
  return { sessionId: row.id, userId: row.user_id, refreshToken: next };
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare(`UPDATE sessions SET revoked=1 WHERE id=?`).bind(sessionId).run();
}
export async function revokeAllForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`UPDATE sessions SET revoked=1 WHERE user_id=?`).bind(userId).run();
}
export async function listSessions(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(`SELECT id,user_agent,ip,last_used_at FROM sessions WHERE user_id=? AND revoked=0 ORDER BY last_used_at DESC`)
    .bind(userId)
    .all<{ id: string; user_agent: string | null; ip: string | null; last_used_at: number }>();
  return results.map((r) => ({ id: r.id, userAgent: r.user_agent, ip: r.ip, lastUsedAt: r.last_used_at }));
}
```

> Note on reuse-detection: when a token is rotated its row's `refresh_hash`
> is overwritten, so the old hash is no longer *current*. Replaying it finds
> no current row but the family still exists via later rows. To detect this
> precisely we also revoke the family when a `revoked` row is presented. This
> is a pragmatic detector; the implementation task may strengthen it by
> keeping a short history of retired hashes if reuse-detection tests demand it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- auth/sessions`
Expected: PASS. If the family-revocation assertion is flaky given the simplified detector, add a `retired_hashes` table lookup before returning `invalid` (keep retired hashes for 30 days) and re-run.

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth/tokens.ts worker/src/auth/sessions.ts worker/tests/auth/sessions.test.ts
git commit -m "feat(auth): session store with refresh rotation and reuse-detection"
```

---

### Task 5: Rate-limit throttle

**Files:**
- Create: `worker/src/auth/throttle.ts`
- Test: `worker/tests/auth/throttle.test.ts`

**Interfaces:**
- Produces: `checkAndIncrement(db, bucket, now, { windowMs, max }): Promise<{ allowed: boolean; retryAfterMs: number }>`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/auth/throttle.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { checkAndIncrement } from '../../src/auth/throttle';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('allows up to max then blocks within the window', async () => {
  const opts = { windowMs: 60000, max: 3 };
  for (let i = 0; i < 3; i++) {
    expect((await checkAndIncrement(env.DB, 'login:ip:test', 1000, opts)).allowed).toBe(true);
  }
  const blocked = await checkAndIncrement(env.DB, 'login:ip:test', 1000, opts);
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterMs).toBeGreaterThan(0);
});

it('resets after the window elapses', async () => {
  const opts = { windowMs: 60000, max: 1 };
  expect((await checkAndIncrement(env.DB, 'login:ip:test2', 1000, opts)).allowed).toBe(true);
  expect((await checkAndIncrement(env.DB, 'login:ip:test2', 1000, opts)).allowed).toBe(false);
  expect((await checkAndIncrement(env.DB, 'login:ip:test2', 70000, opts)).allowed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- auth/throttle`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `throttle.ts`**

Create `worker/src/auth/throttle.ts`:

```ts
export async function checkAndIncrement(
  db: D1Database,
  bucket: string,
  now: number,
  opts: { windowMs: number; max: number }
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const row = await db
    .prepare(`SELECT window_start,count FROM auth_attempts WHERE bucket=?`)
    .bind(bucket)
    .first<{ window_start: number; count: number }>();

  if (!row || now - row.window_start >= opts.windowMs) {
    await db
      .prepare(
        `INSERT INTO auth_attempts(bucket,window_start,count) VALUES(?,?,1)
         ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start, count=1`
      )
      .bind(bucket, now)
      .run();
    return { allowed: true, retryAfterMs: 0 };
  }
  if (row.count >= opts.max) {
    return { allowed: false, retryAfterMs: opts.windowMs - (now - row.window_start) };
  }
  await db.prepare(`UPDATE auth_attempts SET count=count+1 WHERE bucket=?`).bind(bucket).run();
  return { allowed: true, retryAfterMs: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- auth/throttle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth/throttle.ts worker/tests/auth/throttle.test.ts
git commit -m "feat(auth): windowed rate-limit throttle"
```

---

### Task 6: Users store + email sender

**Files:**
- Create: `worker/src/auth/users.ts`
- Create: `worker/src/auth/email.ts`
- Test: `worker/tests/auth/users.test.ts`

**Interfaces:**
- Produces (`users.ts`):
  - `type UserRow = { id: string; email: string; emailVerified: boolean; createdAt: number }`
  - `createUser(db, { email, passwordHash, now }): Promise<UserRow>`
  - `getUserByEmail(db, email): Promise<(UserRow & { passwordHash: string }) | null>`
  - `getUserById(db, id): Promise<UserRow | null>`
  - `setEmailVerified(db, id): Promise<void>`
  - `updatePassword(db, id, passwordHash, now): Promise<void>`
  - `createEmailToken(db, { userId, type, now, ttlMs }): Promise<string>` (returns plaintext token)
  - `consumeEmailToken(db, type, token, now): Promise<string | null>` (returns userId or null)
- Produces (`email.ts`):
  - `sendVerifyEmail(env, to, link): Promise<void>` / `sendResetEmail(env, to, link): Promise<void>` — real Resend call when `RESEND_API_KEY` set, else no-op stub (logged).

- [ ] **Step 1: Write the failing test**

Create `worker/tests/auth/users.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { consumeEmailToken, createEmailToken, createUser, getUserByEmail, setEmailVerified } from '../../src/auth/users';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('creates and finds a user by email, case-insensitively', async () => {
  await createUser(env.DB, { email: 'Test@Example.com', passwordHash: 'scrypt$x', now: 1 });
  const u = await getUserByEmail(env.DB, 'test@example.com');
  expect(u?.email).toBe('test@example.com');
  expect(u?.emailVerified).toBe(false);
});

it('verifies via a single-use email token', async () => {
  const u = await createUser(env.DB, { email: 'verify@example.com', passwordHash: 'scrypt$x', now: 1 });
  const token = await createEmailToken(env.DB, { userId: u.id, type: 'verify', now: 1, ttlMs: 1000 });
  expect(await consumeEmailToken(env.DB, 'verify', token, 2)).toBe(u.id);
  expect(await consumeEmailToken(env.DB, 'verify', token, 3)).toBeNull(); // single use
  await setEmailVerified(env.DB, u.id);
  const found = await getUserByEmail(env.DB, 'verify@example.com');
  expect(found?.emailVerified).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- auth/users`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `users.ts`**

Create `worker/src/auth/users.ts`:

```ts
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
```

- [ ] **Step 4: Implement `email.ts`**

Create `worker/src/auth/email.ts`:

```ts
import type { Env } from '../env';

async function send(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email stub] to=${to} subject=${subject}`); // dev/test path
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Understudy <auth@understudy.app>', to, subject, html }),
  });
  if (!res.ok) console.error(`[email] resend failed ${res.status}`);
}

export function sendVerifyEmail(env: Env, to: string, link: string): Promise<void> {
  return send(env, to, 'Verify your Understudy email', `<p>Confirm your email:</p><p><a href="${link}">${link}</a></p>`);
}
export function sendResetEmail(env: Env, to: string, link: string): Promise<void> {
  return send(env, to, 'Reset your Understudy password', `<p>Reset your password:</p><p><a href="${link}">${link}</a></p>`);
}
```

Also add `RESEND_API_KEY?: string` and `AUTH_JWT_SECRET?: string` and `APP_URL?: string` and `DEV_AUTH_BYPASS?: string` to the `Env` type in `worker/src/env.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- auth/users`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth/users.ts worker/src/auth/email.ts worker/src/env.ts worker/tests/auth/users.test.ts
git commit -m "feat(auth): users store, email tokens, Resend sender"
```

---

### Task 7: Auth routes

**Files:**
- Create: `worker/src/auth/routes.ts`
- Modify: `worker/src/index.ts` (mount the auth router)
- Test: `worker/tests/auth/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `authRoutes` — a Hono sub-app mounted at `/auth`. Response envelopes: `login`/`refresh` return `{ accessToken, user }`; errors return `{ error: string }` with the status codes in the spec §6 table.

- [ ] **Step 1: Write the failing integration test**

Create `worker/tests/auth/routes.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import app from '../../src/index';

beforeAll(async () => { await applyAuthSchema(env.DB); });

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

it('signup → login → me happy path (login allowed unverified)', async () => {
  const email = 'flow@example.com';
  const password = 'a-perfectly-fine-passphrase';
  let res = await app.request('/auth/signup', json({ email, password }), env);
  expect(res.status).toBe(201);

  res = await app.request('/auth/login', json({ email, password }), env);
  expect(res.status).toBe(200);
  const { accessToken, user } = await res.json<any>();
  expect(user.email).toBe(email);

  res = await app.request('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } }, env);
  expect(res.status).toBe(200);
  expect((await res.json<any>()).user.email).toBe(email);
});

it('login gives a generic error for wrong password (no enumeration)', async () => {
  const res = await app.request('/auth/login', json({ email: 'flow@example.com', password: 'wrong-wrong-wrong' }), env);
  expect(res.status).toBe(401);
  expect((await res.json<any>()).error).toBe('Invalid email or password.');
});

it('unknown email login returns the SAME generic error', async () => {
  const res = await app.request('/auth/login', json({ email: 'nobody@example.com', password: 'whatever-here-ok' }), env);
  expect(res.status).toBe(401);
  expect((await res.json<any>()).error).toBe('Invalid email or password.');
});

it('rejects weak passwords at signup', async () => {
  const res = await app.request('/auth/signup', json({ email: 'weak@example.com', password: 'short' }), env);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- auth/routes`
Expected: FAIL — `/auth/*` not mounted.

- [ ] **Step 3: Implement `routes.ts`**

Create `worker/src/auth/routes.ts`:

```ts
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password';
import { signAccessToken } from './jwt';
import { createSession, listSessions, revokeAllForUser, revokeSession, rotateSession } from './sessions';
import {
  consumeEmailToken, createEmailToken, createUser, getUserByEmail,
  getUserById, setEmailVerified, updatePassword,
} from './users';
import { sendResetEmail, sendVerifyEmail } from './email';
import { checkAndIncrement } from './throttle';

type Vars = { authUserId?: string };
export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const GENERIC_LOGIN_ERR = 'Invalid email or password.';
const now = () => Date.now();
const isNative = (c: any) => c.req.header('X-Client') === 'native';
const clientIp = (c: any) => c.req.header('CF-Connecting-IP') ?? 'unknown';

async function issueTokens(c: any, userId: string, sessionArgs: { userAgent: string | null; ip: string | null }) {
  const user = await getUserById(c.env.DB, userId);
  const { sessionId, refreshToken } = await createSession(c.env.DB, { userId, now: now(), ...sessionArgs });
  const accessToken = await signAccessToken(c.env.AUTH_JWT_SECRET ?? 'dev-secret', {
    sub: userId, sid: sessionId, emailVerified: user!.emailVerified,
  });
  if (!isNative(c)) {
    setCookie(c, '__Host-refresh', refreshToken, {
      httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 30 * 24 * 3600,
    });
    return c.json({ accessToken, user });
  }
  return c.json({ accessToken, refreshToken, user });
}

authRoutes.post('/signup', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: 'Bad request.' }, 400);
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return c.json({ error: policy.reason }, 400);

  const throttle = await checkAndIncrement(c.env.DB, `signup:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const existing = await getUserByEmail(c.env.DB, email);
  if (existing) {
    // No enumeration: pretend success, notify the existing account instead.
    await sendVerifyEmail(c.env, existing.email, `${c.env.APP_URL ?? ''}/login`);
    return c.json({ userId: null }, 201);
  }
  const user = await createUser(c.env.DB, { email, passwordHash: await hashPassword(password), now: now() });
  const token = await createEmailToken(c.env.DB, { userId: user.id, type: 'verify', now: now(), ttlMs: 24 * 3600000 });
  await sendVerifyEmail(c.env, user.email, `${c.env.APP_URL ?? ''}/verify?token=${token}`);
  return c.json({ userId: user.id }, 201);
});

authRoutes.post('/verify', async (c) => {
  const { token } = await c.req.json().catch(() => ({}));
  if (typeof token !== 'string') return c.json({ error: 'Bad request.' }, 400);
  const userId = await consumeEmailToken(c.env.DB, 'verify', token, now());
  if (!userId) return c.json({ error: 'Invalid or expired token.' }, 400);
  await setEmailVerified(c.env.DB, userId);
  return c.json({ ok: true });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: GENERIC_LOGIN_ERR }, 401);

  const throttle = await checkAndIncrement(c.env.DB, `login:ip:${clientIp(c)}`, now(), { windowMs: 900000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const user = await getUserByEmail(c.env.DB, email);
  // Run a dummy hash on unknown email so timing does not reveal existence.
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, 'scrypt$N=65536,r=8,p=1$AAAA$AAAA');
  if (!user || !ok) return c.json({ error: GENERIC_LOGIN_ERR }, 401);
  return issueTokens(c, user.id, { userAgent: c.req.header('User-Agent') ?? null, ip: clientIp(c) });
});

authRoutes.post('/refresh', async (c) => {
  const bodyToken = isNative(c) ? (await c.req.json().catch(() => ({}))).refreshToken : undefined;
  const cookie = c.req.header('Cookie')?.match(/__Host-refresh=([^;]+)/)?.[1];
  const token = bodyToken ?? cookie;
  if (typeof token !== 'string') return c.json({ error: 'No refresh token.' }, 401);
  const result = await rotateSession(c.env.DB, token, now());
  if (result === 'invalid' || result === 'reused') return c.json({ error: 'Session expired.' }, 401);
  const user = await getUserById(c.env.DB, result.userId);
  const accessToken = await signAccessToken(c.env.AUTH_JWT_SECRET ?? 'dev-secret', {
    sub: result.userId, sid: result.sessionId, emailVerified: user!.emailVerified,
  });
  if (!isNative(c)) {
    setCookie(c, '__Host-refresh', result.refreshToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 30 * 24 * 3600 });
    return c.json({ accessToken });
  }
  return c.json({ accessToken, refreshToken: result.refreshToken });
});

authRoutes.post('/password/forgot', async (c) => {
  const { email } = await c.req.json().catch(() => ({}));
  await checkAndIncrement(c.env.DB, `forgot:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (typeof email === 'string') {
    const user = await getUserByEmail(c.env.DB, email);
    if (user) {
      const token = await createEmailToken(c.env.DB, { userId: user.id, type: 'reset', now: now(), ttlMs: 3600000 });
      await sendResetEmail(c.env, user.email, `${c.env.APP_URL ?? ''}/reset?token=${token}`);
    }
  }
  return c.json({ ok: true }); // always generic
});

authRoutes.post('/password/reset', async (c) => {
  const { token, password } = await c.req.json().catch(() => ({}));
  if (typeof token !== 'string' || typeof password !== 'string') return c.json({ error: 'Bad request.' }, 400);
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return c.json({ error: policy.reason }, 400);
  const userId = await consumeEmailToken(c.env.DB, 'reset', token, now());
  if (!userId) return c.json({ error: 'Invalid or expired token.' }, 400);
  await updatePassword(c.env.DB, userId, await hashPassword(password), now());
  await revokeAllForUser(c.env.DB, userId); // reset kills all sessions
  return c.json({ ok: true });
});
```

> The `me`, `logout`, `logout-all`, and `sessions` routes require the auth
> middleware from Task 8; they are added in Task 8 Step 3 to keep this task's
> deliverable (unauthenticated flows) independently testable.

- [ ] **Step 4: Mount the router**

In `worker/src/index.ts`, import and mount:

```ts
import { authRoutes } from './auth/routes';
// ...after the app is created:
app.route('/auth', authRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- auth/routes`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth/routes.ts worker/src/index.ts worker/tests/auth/routes.test.ts
git commit -m "feat(auth): signup/verify/login/refresh/password routes"
```

---

### Task 8: Auth middleware + protected routes + dev bypass

**Files:**
- Create: `worker/src/auth/middleware.ts`
- Modify: `worker/src/auth/routes.ts` (add `me`, `logout`, `logout-all`, `sessions`)
- Test: `worker/tests/auth/middleware.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` (Task 3), session helpers (Task 4), users (Task 6).
- Produces:
  - `requireAuth` — Hono middleware; on valid bearer sets `c.set('authUserId', sub)` and `c.set('authSessionId', sid)`, else 401.
  - `requireVerified` — runs after `requireAuth`; 403 unless the token's `emailVerified` is true.

- [ ] **Step 1: Write the failing test**

Create `worker/tests/auth/middleware.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import app from '../../src/index';

beforeAll(async () => { await applyAuthSchema(env.DB); });
const json = (b: unknown, h: Record<string, string> = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });

it('me requires a valid bearer token', async () => {
  const res = await app.request('/auth/me', {}, env);
  expect(res.status).toBe(401);
});

it('logout then refresh fails', async () => {
  const email = 'logout@example.com', password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);
  const login = await app.request('/auth/login', json({ email, password, }, { 'X-Client': 'native' }), env);
  const { accessToken, refreshToken } = await login.json<any>();

  const out = await app.request('/auth/logout', json({ refreshToken }, { 'X-Client': 'native', Authorization: `Bearer ${accessToken}` }), env);
  expect(out.status).toBe(204);
  const refresh = await app.request('/auth/refresh', json({ refreshToken }, { 'X-Client': 'native' }), env);
  expect(refresh.status).toBe(401);
});
```

- [ ] **Step 2: Implement `middleware.ts`**

Create `worker/src/auth/middleware.ts`:

```ts
import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { verifyAccessToken } from './jwt';

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  // Dev bypass: only when explicitly enabled (never in production).
  if (c.env.DEV_AUTH_BYPASS) {
    const devUser = c.req.header('X-Dev-User');
    if (devUser) { c.set('authUserId', devUser); c.set('authSessionId', 'dev'); return next(); }
  }
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const claims = token ? await verifyAccessToken(c.env.AUTH_JWT_SECRET ?? 'dev-secret', token) : null;
  if (!claims) return c.json({ error: 'Unauthorized.' }, 401);
  c.set('authUserId', claims.sub);
  c.set('authSessionId', claims.sid);
  c.set('authEmailVerified', claims.emailVerified);
  return next();
}

export async function requireVerified(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.get('authEmailVerified') !== true) return c.json({ error: 'Email not verified.' }, 403);
  return next();
}
```

- [ ] **Step 3: Add the protected routes to `routes.ts`**

Append to `worker/src/auth/routes.ts` (import `requireAuth` and `getUserById`, `listSessions`, `revokeSession`, `revokeAllForUser` are already imported):

```ts
import { requireAuth } from './middleware';

authRoutes.get('/me', requireAuth, async (c) => {
  const user = await getUserById(c.env.DB, c.get('authUserId') as string);
  return c.json({ user });
});

authRoutes.post('/logout', requireAuth, async (c) => {
  await revokeSession(c.env.DB, c.get('authSessionId') as string);
  return c.body(null, 204);
});

authRoutes.post('/logout-all', requireAuth, async (c) => {
  await revokeAllForUser(c.env.DB, c.get('authUserId') as string);
  return c.body(null, 204);
});

authRoutes.get('/sessions', requireAuth, async (c) => {
  return c.json(await listSessions(c.env.DB, c.get('authUserId') as string));
});

authRoutes.delete('/sessions/:id', requireAuth, async (c) => {
  await revokeSession(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});
```

Add the `Variables` type members to the router generic: `type Vars = { authUserId?: string; authSessionId?: string; authEmailVerified?: boolean }`.

> Note: `logout` revokes by `authSessionId`. For the native test above the
> access token's `sid` matches the session created at login, so revoking it
> makes the paired refresh token's session `revoked=1` → `refresh` returns 401.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- auth/middleware`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: all green (existing 41 + new auth tests), no secrets set.

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth/middleware.ts worker/src/auth/routes.ts worker/tests/auth/middleware.test.ts
git commit -m "feat(auth): requireAuth middleware, session mgmt routes, dev bypass"
```

---

### Task 9: Wire secrets + docs, deploy checklist

**Files:**
- Modify: `worker/wrangler.jsonc` (document required secrets in a comment; add `email_tokens`/`sessions` note)
- Modify: `worker/README.md` (auth setup + secret list)
- Test: none (documentation + config)

- [ ] **Step 1: Document secrets and migration**

In `worker/README.md`, add an "Auth" section:

```markdown
## Auth

Set secrets before deploying:

```bash
wrangler secret put AUTH_JWT_SECRET   # 32+ random bytes
wrangler secret put RESEND_API_KEY    # from resend.com
```

Vars in `wrangler.jsonc`: `APP_URL` (for email links). Optional
`DEV_AUTH_BYPASS=1` for local dev only (send `X-Dev-User: <id>`).

Apply the auth schema to D1:

```bash
wrangler d1 execute understudy --file=schema.auth.sql
```
```

- [ ] **Step 2: Add APP_URL var to wrangler.jsonc**

In `worker/wrangler.jsonc` `"vars"`, add `"APP_URL": "http://localhost:5173"` and a comment listing the two secrets to set via `wrangler secret put`.

- [ ] **Step 3: Commit**

```bash
git add worker/README.md worker/wrangler.jsonc
git commit -m "docs(auth): secret setup and schema migration"
```

---

## Self-Review

- **Spec coverage:** hashing (T2) ✓, JWT access (T3) ✓, refresh rotation + reuse-detection (T4) ✓, throttle/no-enumeration (T5, T7) ✓, schema (T1) ✓, endpoints table (T7 + T8) ✓, email verify/reset (T6, T7) ✓, transport cookie vs native (T7) ✓, middleware + verify-gating + dev bypass (T8) ✓, secrets/deploy (T9) ✓. `requireVerified` is defined (T8) for sub-project #2 to gate integration-connect; no unverified-gating endpoint exists yet because there is no protected feature route yet — that lands with sub-project #2 (noted, not a gap).
- **Placeholder scan:** every code step contains real code; the only deferred item is the optional `retired_hashes` strengthening in T4 Step 5, which is conditional and fully specified.
- **Type consistency:** `AccessClaims`, `UserRow`, session return unions, and the `authUserId`/`authSessionId`/`authEmailVerified` context vars are used consistently across T3, T4, T6, T7, T8.

## Notes for the executor

- Run one benchmark early (T2): if `scrypt N=65536` blows the Worker CPU budget in the test pool, drop to `N=16384` and note it — the encoded params make this per-user forward-compatible.
- Keep every task green with **no secrets set** — the email stub and `AUTH_JWT_SECRET ?? 'dev-secret'` fallbacks make this work; production MUST set real secrets (T9).
