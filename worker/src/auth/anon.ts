// Anonymous cookie-session identity, layered on top of the existing Bearer
// auth (middleware.ts/jwt.ts) rather than replacing it. This lets a caller
// start a Composio connect (and see/revoke their own connections) before
// they've signed up, while `/settings`, `/mcps`, `/tools` stay strictly
// Bearer + verified-email (unchanged — see store/routes.ts).
//
// The cookie is `__Host-anon` — a signed anon id set via `prefix: 'host'` on
// both read and write, so the `__Host-` wire name and its required
// constraints (Secure, Path=/, no Domain — enforced by hono/cookie itself)
// live in exactly one place instead of being duplicated as a literal string
// at every call site.
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Env } from '../env';
import { verifyAccessToken } from './jwt';
import { authSecret } from './secret';

const ANON_COOKIE_NAME = 'anon'; // + prefix:'host' => wire name `__Host-anon`
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

// Domain-separates the anon cookie's HMAC key from the JWT signing key.
// Both currently derive from the same AUTH_JWT_SECRET, but signing two
// different artifacts (a short-lived access token vs. a year-long anon
// cookie) with the literal same key is bad practice even when nothing
// currently exploits the overlap — a suffix is enough to make them
// unrelated keys without adding a new secret to provision. Used
// consistently by every get/set/delete of the cookie, so it still
// round-trips.
function anonCookieSecret(env: Env): string {
  return `${authSecret(env)}|anon-cookie-v1`;
}

export interface Actor {
  userId: string;
  anon: boolean;
}

// Generic over the Variables shape (rather than a fixed `Context<{Bindings:
// Env}>`) so this composes with both index.ts's app (Variables: AuthVars)
// and storeRoutes's app (its own local Vars) without a structural mismatch —
// this module only ever touches c.req/c.env/cookie headers, never
// c.get/c.set, so the caller's Variables shape is irrelevant to it.
type ActorContext<E extends { Bindings: Env }> = Context<E>;

async function readAnonCookie<E extends { Bindings: Env }>(c: ActorContext<E>, secret: string): Promise<string | null> {
  // getSignedCookie resolves to `false` (not undefined) when the signature
  // check fails. Both "no cookie" and "tampered cookie" must fall through
  // to minting a brand-new anon id — a forged/corrupted cookie must never
  // be trusted as an existing identity, or it could be used to read or
  // revoke another anonymous session's connections.
  const value = await getSignedCookie(c, secret, ANON_COOKIE_NAME, 'host');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function mintAnonCookie<E extends { Bindings: Env }>(c: ActorContext<E>, secret: string): Promise<string> {
  const userId = `anon_${crypto.randomUUID()}`;
  await setSignedCookie(c, ANON_COOKIE_NAME, userId, secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: ANON_COOKIE_MAX_AGE,
    prefix: 'host',
  });
  return userId;
}

// Resolves who is acting on a request that must work for both a logged-in
// user (Bearer access token) and an anonymous, cookie-tracked session.
// Bearer wins whenever present and valid. Otherwise reuses — or mints — a
// signed `__Host-anon` cookie, setting it on the response itself when a
// fresh id is minted so callers never need to remember to.
//
// Connect/list/revoke of Composio connections is intentionally reachable by
// EITHER path — any valid bearer (verified or not) or an anon cookie —
// unlike `/settings`, `/mcps`, `/tools`, which stay `requireAuth +
// requireVerified` (see store/routes.ts). Email verification gates the
// account's own data; it isn't a precondition for starting a third-party
// OAuth handshake, and the OAuth provider authenticates itself on the
// callback regardless of our verification state.
export async function resolveActor<E extends { Bindings: Env }>(c: ActorContext<E>): Promise<Actor> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  // verifyAccessToken already returns null (never throws) for any
  // invalid/expired/garbage token — it wraps jwtVerify in its own
  // try/catch. This is belt-and-suspenders: a bad bearer must fall through
  // to the anon path, never bubble up as a 500 or get treated as a real
  // identity, even if that invariant ever changes underneath us.
  let claims: Awaited<ReturnType<typeof verifyAccessToken>> = null;
  if (token) {
    try {
      claims = await verifyAccessToken(authSecret(c.env), token);
    } catch {
      claims = null;
    }
  }
  if (claims) return { userId: claims.sub, anon: false };

  const cookieSecret = anonCookieSecret(c.env);
  const existing = await readAnonCookie(c, cookieSecret);
  if (existing) return { userId: existing, anon: true };

  return { userId: await mintAnonCookie(c, cookieSecret), anon: true };
}

// Reads the current anon id without minting a new one. Used by the
// claim-on-login flow, which only needs to know "is there an anon session to
// re-key" — creating one there would be pointless since it's discarded
// immediately after.
export async function peekAnonId<E extends { Bindings: Env }>(c: ActorContext<E>): Promise<string | null> {
  return readAnonCookie(c, anonCookieSecret(c.env));
}

export function clearAnonCookie<E extends { Bindings: Env }>(c: ActorContext<E>): void {
  deleteCookie(c, ANON_COOKIE_NAME, { path: '/', secure: true, prefix: 'host' });
}
