// Anonymous cookie-session Composio connect (worker/src/auth/anon.ts). Bearer
// auth is unchanged; these exercise the __Host-anon fallback path added to
// POST /api/connect, GET/DELETE /api/connections, and POST
// /api/connections/claim.
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema, applyStoreSchema } from '../../src/db';
import { createUser, setEmailVerified } from '../../src/auth/users';
import { signAccessToken } from '../../src/auth/jwt';
import { createState } from '../../src/providers/composio';

async function verifiedToken(userId: string): Promise<string> {
  await createUser(env.DB, { email: `${userId}@example.com`, passwordHash: 'scrypt$x', now: 1 });
  await setEmailVerified(env.DB, userId).catch(() => {});
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`
  )
    .bind(userId, `${userId}+tok@example.com`)
    .run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}
const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
const jsonHeaders = { 'Content-Type': 'application/json' };

// Pulls the `name=value` pair off a raw Set-Cookie response header so it can
// be forwarded as the Cookie header on a follow-up request.
function cookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('expected a Set-Cookie header');
  return setCookieHeader.split(';')[0]!;
}

function anonIdFromUrl(url: string): string {
  const match = url.match(/user=(anon_[^&]+)/);
  if (!match) throw new Error(`expected an anon_ user id in ${url}`);
  return match[1]!;
}

async function connectAnon(cookie?: string): Promise<{ res: Response; url: string; setCookie: string | null }> {
  const res = await app.request(
    '/api/connect',
    { method: 'POST', headers: { ...jsonHeaders, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ toolkit: 'github' }) },
    env
  );
  const { url } = await res.json<{ url: string }>();
  return { res, url, setCookie: res.headers.get('Set-Cookie') };
}

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await applyStoreSchema(env.DB);
});

it('(a) POST /api/connect with no bearer sets __Host-anon and returns a link', async () => {
  const { res, url, setCookie } = await connectAnon();
  expect(res.status).toBe(200);
  expect(setCookie).toMatch(/^__Host-anon=/);
  expect(url).toMatch(/user=anon_/);
});

it('(b) a second /api/connect with that cookie reuses the same anon id', async () => {
  const first = await connectAnon();
  const cookie = cookiePair(first.setCookie);
  const firstAnonId = anonIdFromUrl(first.url);

  const second = await connectAnon(cookie);
  expect(second.res.status).toBe(200);
  // A still-valid anon cookie must not cause a new one to be minted.
  expect(second.setCookie).toBeNull();
  expect(anonIdFromUrl(second.url)).toBe(firstAnonId);
});

it('(c) GET /connections with the anon cookie lists only that anon session\'s connections', async () => {
  const a = await connectAnon();
  const cookieA = cookiePair(a.setCookie);
  const anonA = anonIdFromUrl(a.url);

  const b = await connectAnon();
  const cookieB = cookiePair(b.setCookie);
  const anonB = anonIdFromUrl(b.url);
  expect(anonA).not.toBe(anonB);

  const state = await createState(env, { userId: anonA, toolkit: 'github' });
  const done = await app.request(
    `/oauth/done?state=${encodeURIComponent(state)}&status=success&connected_account_id=ca_anon_a`,
    {},
    env
  );
  expect(done.status).toBe(302); // callback now redirects the browser into /settings

  const listA = await app.request('/api/connections', { headers: { Cookie: cookieA } }, env);
  expect(listA.status).toBe(200);
  expect(await listA.json<Array<{ toolkit: string; status: string }>>()).toContainEqual(
    expect.objectContaining({ toolkit: 'github', status: 'active' })
  );

  const listB = await app.request('/api/connections', { headers: { Cookie: cookieB } }, env);
  expect(listB.status).toBe(200);
  expect(await listB.json()).toEqual([]); // B never sees A's connection
});

it('(d) a tampered anon cookie is treated as absent, never as another identity', async () => {
  const good = await connectAnon();
  const goodCookie = cookiePair(good.setCookie);
  const goodAnonId = anonIdFromUrl(good.url);

  const eqIdx = goodCookie.indexOf('=');
  const name = goodCookie.slice(0, eqIdx);
  const value = goodCookie.slice(eqIdx + 1);
  // Flip the last character of the signed value (the signature lives at the
  // end) so the cookie is syntactically well-formed but fails verification.
  const tamperedValue = value.slice(0, -1) + (value.endsWith('a') ? 'b' : 'a');
  const tamperedCookie = `${name}=${tamperedValue}`;

  const tampered = await connectAnon(tamperedCookie);
  expect(tampered.res.status).toBe(200);
  // A fresh cookie must be minted for the tampered request...
  expect(tampered.setCookie).toMatch(/^__Host-anon=/);
  // ...and it must never resolve back to the original, legitimate anon id.
  expect(anonIdFromUrl(tampered.url)).not.toBe(goodAnonId);
});

// Hardening follow-up: resolveActor wraps verifyAccessToken in a try/catch
// (belt-and-suspenders — verifyAccessToken already returns null rather than
// throwing on garbage input). A malformed bearer must fall through to the
// anon path — 200 with a fresh __Host-anon cookie — never a 500 and never
// an adopted identity.
it('a garbage bearer token falls through to a fresh anon session, not a 500', async () => {
  const res = await app.request(
    '/api/connections',
    { headers: { Authorization: 'Bearer not.a.jwt' } },
    env
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-anon=/);
  expect(await res.json()).toEqual([]);
});

it('(e) GET /api/settings still 401s with only an anon cookie', async () => {
  const a = await connectAnon();
  const cookie = cookiePair(a.setCookie);
  const res = await app.request('/api/settings', { headers: { Cookie: cookie } }, env);
  expect(res.status).toBe(401);
});

it('(f) claim re-keys the anon session\'s connections to the authed user and clears the cookie', async () => {
  const a = await connectAnon();
  const cookie = cookiePair(a.setCookie);
  const anonId = anonIdFromUrl(a.url);

  const state = await createState(env, { userId: anonId, toolkit: 'github' });
  await app.request(`/oauth/done?state=${encodeURIComponent(state)}&status=success&connected_account_id=ca_claim`, {}, env);

  const t = await verifiedToken('u-claim-1');
  const claim = await app.request(
    '/api/connections/claim',
    { method: 'POST', headers: { Authorization: `Bearer ${t}`, Cookie: cookie } },
    env
  );
  expect(claim.status).toBe(204);
  // The response clears the anon cookie (Max-Age=0).
  expect(claim.headers.get('Set-Cookie')).toMatch(/^__Host-anon=;.*Max-Age=0/);

  const authedList = await app.request('/api/connections', auth(t), env);
  expect(await authedList.json<Array<{ toolkit: string; status: string }>>()).toContainEqual(
    expect.objectContaining({ toolkit: 'github', status: 'active' })
  );

  // The claimed rows were moved off the anon id, so the same anon cookie
  // (were it still valid) would now see nothing.
  const anonList = await app.request('/api/connections', { headers: { Cookie: cookie } }, env);
  expect(await anonList.json()).toEqual([]);
});

it('claim is a no-op (still 204) when there is no anon cookie', async () => {
  const t = await verifiedToken('u-claim-noop');
  const res = await app.request('/api/connections/claim', { method: 'POST', ...auth(t) }, env);
  expect(res.status).toBe(204);
});
