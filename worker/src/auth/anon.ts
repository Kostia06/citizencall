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
export async function resolveActor<E extends { Bindings: Env }>(c: ActorContext<E>): Promise<Actor> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const secret = authSecret(c.env);
  const claims = token ? await verifyAccessToken(secret, token) : null;
  if (claims) return { userId: claims.sub, anon: false };

  const existing = await readAnonCookie(c, secret);
  if (existing) return { userId: existing, anon: true };

  return { userId: await mintAnonCookie(c, secret), anon: true };
}

// Reads the current anon id without minting a new one. Used by the
// claim-on-login flow, which only needs to know "is there an anon session to
// re-key" — creating one there would be pointless since it's discarded
// immediately after.
export async function peekAnonId<E extends { Bindings: Env }>(c: ActorContext<E>): Promise<string | null> {
  return readAnonCookie(c, authSecret(c.env));
}

export function clearAnonCookie<E extends { Bindings: Env }>(c: ActorContext<E>): void {
  deleteCookie(c, ANON_COOKIE_NAME, { path: '/', secure: true, prefix: 'host' });
}
