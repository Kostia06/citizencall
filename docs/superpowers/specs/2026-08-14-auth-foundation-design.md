# Auth Foundation — Design Spec

**Date:** 2026-08-14
**Status:** Approved for implementation planning
**Sub-project:** #1 of the Understudy user-system decomposition (auth + identity → per-user store → web UI → Expo client)

## 1. Purpose

Give Understudy a real, production-grade user identity so that a person's
Composio connections, enabled tools/MCPs, and preferences persist and follow
them across platforms (web now, Expo search bar later). Everything downstream
keys off an authenticated `user_id`. This foundation replaces the demo-only
`demo_kos` / `demo_teammate` string toggle with authenticated accounts.

Credential model: **email + password** (chosen over passwordless). Stack:
**Cloudflare Workers (Hono) + D1**, no third-party auth service. One external
dependency: an email provider (Resend) for verification and password-reset
mail — unavoidable for any credential model.

## 2. Goals / Non-goals

**Goals**
- Email + password signup, login, logout.
- Email verification and password reset.
- Short-lived access tokens + rotating refresh tokens with revocation.
- Multi-device session listing and revocation ("log out everywhere").
- Works for both web (cookie + in-memory access token) and a future Expo
  native client (bearer tokens in secure storage) from the same issuer.
- Production security posture: throttling, no user enumeration, safe hashing,
  auth-event logging.

**Non-goals (for this sub-project)**
- Social OAuth / SSO (may be added later; out of scope now).
- Passkeys / WebAuthn (deliberately deferred).
- The per-user data store (connections/tools/MCPs/prefs) — that is sub-project
  #2; this spec only establishes the `user_id` it will key on.
- Any UI beyond the API contract the signup/login screens will consume — the
  screens themselves are sub-project #3.
- Building the Expo client (owner handles native). The API is designed to
  serve it; we do not implement it here.

## 3. Credential model

- **Password hashing:** `scrypt` via `@noble/hashes` (pure-JS, audited,
  memory-hard, runs on workerd without a WASM bundle). Parameters:
  `N = 2^16, r = 8, p = 1, dkLen = 32` (tunable; revisit against Worker CPU
  limits during implementation). Each user gets a 16-byte random salt from
  `crypto.getRandomValues`. The stored value encodes algorithm + params + salt
  + derived key (e.g. `scrypt$N=65536,r=8,p=1$<saltb64>$<hashb64>`) so params
  can evolve without a migration. Verification uses a constant-time comparison.
  - *Alternative considered:* Argon2id via `hash-wasm` (OWASP's first choice)
    — rejected for now only to avoid a WASM blob in the Worker bundle; the
    stored-params format above lets us switch later per-user on next login.
- **Password policy (NIST 800-63B aligned):** minimum length 12, no maximum
  below 64, no forced composition rules, screened against a bundled list of
  the most common breached passwords. Reject on signup and reset.

## 4. Token & session architecture

This is what delivers multi-device support and revocation.

- **Access token** — JSON Web Token, HS256, signed with `AUTH_JWT_SECRET`.
  Lifetime 15 minutes. Claims: `sub` (user_id), `sid` (session_id), `iat`,
  `exp`, `email_verified`. Never stored server-side; validated by signature +
  expiry on each request. Signed/verified with Web Crypto (`SubtleCrypto`).
- **Refresh token** — 32 bytes of `crypto.getRandomValues`, base64url. The
  server stores only its SHA-256 hash in `sessions.refresh_hash`. Lifetime 30
  days, rolling.
- **Refresh rotation + reuse detection** — every `/auth/refresh` issues a new
  refresh token and invalidates the presented one. If an already-rotated
  (used) refresh token is presented again, treat it as theft: revoke the
  entire session **family** (`family_id`) and force re-login. A login starts a
  new family; each rotation keeps the same `family_id`.
- **Transport**
  - **Web:** refresh token set as `Set-Cookie: __Host-refresh=...;
    HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=...`. The `__Host-`
    prefix mandates `Secure`, `Path=/`, and no `Domain` — the strongest cookie
    guarantee; we rely on `SameSite=Strict` (not path-scoping) for CSRF, since
    the only cookie-authed endpoints are `/auth/refresh` and `/auth/logout`.
    Access token returned in the JSON body, held in memory by the SPA.
  - **Native (Expo):** both tokens returned in the JSON body; the client keeps
    the refresh token in Expo SecureStore and sends the access token as a
    `Authorization: Bearer` header. No cookies. Clients signal transport with
    an `X-Client: native` request header (default is web/cookie).

## 5. D1 schema (new tables)

```sql
CREATE TABLE users(
  id TEXT PRIMARY KEY,               -- uuid
  email TEXT NOT NULL UNIQUE,        -- stored lowercased
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,       -- encoded alg$params$salt$key
  status TEXT NOT NULL DEFAULT 'active', -- active | disabled
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,               -- uuid = JWT sid
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,           -- rotation lineage
  refresh_hash TEXT NOT NULL,        -- sha256(refresh token)
  user_agent TEXT, ip TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE email_tokens(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                -- verify | reset
  token_hash TEXT NOT NULL,          -- sha256(token)
  expires_at INTEGER NOT NULL,
  used_at INTEGER);

CREATE TABLE auth_attempts(          -- windowed throttle counters
  bucket TEXT PRIMARY KEY,           -- e.g. "login:ip:1.2.3.4" or "login:email:..."
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0);

CREATE INDEX idx_sessions_user ON sessions(user_id, revoked);
CREATE INDEX idx_sessions_family ON sessions(family_id);
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, type);
```

`runs.user_id` (existing) transitions from a demo string to a real `users.id`.
No destructive migration needed — demo rows can be left or cleared.

## 6. Endpoints (Hono, `/auth/*`)

All responses JSON. Emails are lowercased and trimmed before lookup. Error
bodies are generic where enumeration matters.

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| POST | `/auth/signup` | `{email, password}` | 201 `{userId}` | Creates unverified user, sends verify email. Generic 201 even if email exists (no enumeration); if it exists, send a "you already have an account" mail instead of creating. |
| POST | `/auth/verify` | `{token}` | 200 | Marks `email_verified=1`; single-use token. |
| POST | `/auth/resend-verification` | `{email}` | 200 (generic) | Throttled. |
| POST | `/auth/login` | `{email, password}` | 200 `{accessToken, user}` (+refresh cookie/body) | Generic error on bad email OR password. |
| POST | `/auth/refresh` | refresh (cookie or body) | 200 `{accessToken}` (+rotated refresh) | Rotation + reuse detection. |
| POST | `/auth/logout` | refresh | 204 | Revokes current session. |
| POST | `/auth/logout-all` | access | 204 | Revokes all sessions for the user. |
| POST | `/auth/password/forgot` | `{email}` | 200 (generic) | Always 200; sends reset mail only if the account exists. Throttled. |
| POST | `/auth/password/reset` | `{token, password}` | 200 | Sets new hash, revokes ALL sessions. |
| GET | `/auth/me` | access | 200 `{user}` | Current user. |
| GET | `/auth/sessions` | access | 200 `[{id, userAgent, ip, lastUsedAt, current}]` | Device list. |
| DELETE | `/auth/sessions/:id` | access | 204 | Revoke a specific device. |

Token payloads never include the password hash or refresh token. `user`
objects expose `{id, email, emailVerified, createdAt}` only.

## 7. Security controls

- **Throttling / lockout:** per-IP and per-email windowed counters
  (`auth_attempts`) on `login`, `signup`, `forgot`, `resend-verification`.
  Exponential backoff responses; soft throttle rather than hard permanent
  lockout (avoid lockout-as-DoS). Revisit moving counters to a Durable Object
  if D1 contention shows up under load.
- **No user enumeration:** `login` returns one generic "invalid credentials"
  for bad email or bad password; `forgot`, `signup`, and
  `resend-verification` always return generic success.
- **Verification gating:** users may sign in unverified but cannot connect
  integrations or start agent runs until `email_verified=1` (enforced by
  middleware). This keeps signup friction low while protecting sensitive
  actions.
- **Reset invalidates sessions:** a successful password reset revokes every
  session for that user.
- **Secrets:** `AUTH_JWT_SECRET`, `RESEND_API_KEY` via `wrangler secret put`;
  never in source or `wrangler.jsonc`.
- **Transport:** HTTPS only; `__Host-` prefixed, `Secure`, `HttpOnly`,
  `SameSite=Strict` refresh cookie; short access-token TTL bounds theft
  windows.
- **Timing:** constant-time hash comparison; run a dummy hash on unknown-email
  logins so timing does not reveal account existence.
- **Auditing:** append auth events (signup, login success/failure, logout,
  reset, session revoke) to a log for the security review.

## 8. Email delivery (Resend)

- Sent via `fetch` to the Resend API using `RESEND_API_KEY`.
- Two templates: **verify email** (link with single-use token, 24h expiry) and
  **password reset** (link with single-use token, 1h expiry).
- Links point at the web app, which POSTs the token to
  `/auth/verify` or `/auth/password/reset`.
- Send failures are logged and surfaced generically; tokens remain valid so the
  user can request a resend.

## 9. App integration

- **`requireAuth` middleware:** validates `Authorization: Bearer` access token
  (signature + expiry), loads a minimal user context, rejects with 401 on
  failure. A `requireVerified` variant additionally checks `email_verified`.
- **`runs.user_id`** and all per-user tables (sub-project #2, plus existing
  Composio connection ids and per-user cache tiers) key on `users.id`.
- **Dev bypass:** the `demo_kos` / `demo_teammate` toggle becomes a
  dev-only shortcut behind an env flag (`DEV_AUTH_BYPASS`), off in production.

## 10. Testing

- **Unit:** scrypt hash/verify (+ wrong-password rejection); encoded-params
  round-trip; JWT sign/verify/expiry; refresh rotation issues a new token and
  invalidates the old; reuse-detection revokes the family; password-policy
  screening.
- **Integration (Workers vitest pool + local D1):** signup → verify → login →
  refresh → logout; password forgot → reset → old sessions rejected;
  throttle triggers after N failures; login on unknown email and wrong
  password return identical generic errors (no enumeration); `logout-all`
  revokes every session; `sessions` list + single-device revoke.
- **Security assertions:** no endpoint leaks the password hash or refresh
  token; verified-only middleware blocks integration-connect when unverified.

## 11. Open items for the implementation plan

- Confirm scrypt cost params against the Worker CPU budget (Paid plan: 30s
  CPU) with a quick benchmark; fall back to lower `N` or Argon2id/hash-wasm if
  needed.
- Decide whether throttle counters stay in D1 or move to a Durable Object
  (start in D1; measure).
- Finalize Resend sender domain / from-address setup.
- Web SPA token-refresh strategy (silent refresh on 401, in-memory access
  token) — detailed in sub-project #3, but the API contract here supports it.
```
