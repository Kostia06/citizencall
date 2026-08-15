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
  // createUser generates its own id; instead mint a token for a known id and insert that id:
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`
  )
    .bind(userId, `${userId}+tok@example.com`)
    .run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}
const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await applyStoreSchema(env.DB);
});

it('/oauth/done persists a completed Composio callback into user_connections', async () => {
  const t = await verifiedToken('u-oauth-1');

  // Simulate the browser redirect Composio makes back to us: no bearer
  // token, just a signed `state` (minted the same way createConnectionLink
  // does) plus the status/connected_account_id query params it appends.
  const state = await createState(env, { userId: 'u-oauth-1', toolkit: 'github' });
  const url = `/oauth/done?state=${encodeURIComponent(state)}&status=success&connected_account_id=ca_123`;
  const res = await app.request(url, {}, env);
  // The callback now bounces the browser back into the SPA (settings page)
  // instead of dead-ending on a JSON receipt.
  expect(res.status).toBe(302);
  const location = res.headers.get('location') ?? '';
  expect(location).toContain('/settings');
  expect(location).toContain('connected=github');
  expect(location).toContain('status=success');

  // The owning user now sees the connection as active via the bearer-gated
  // store route.
  const list = await app.request('/api/connections', auth(t), env);
  expect(list.status).toBe(200);
  const connections = await list.json<Array<{ toolkit: string; status: string }>>();
  expect(connections).toContainEqual(expect.objectContaining({ toolkit: 'github', status: 'active' }));
});

it('/oauth/done rejects a missing or invalid state', async () => {
  const res = await app.request('/oauth/done?status=success&connected_account_id=ca_x', {}, env);
  expect(res.status).toBe(400);

  const bad = await app.request('/oauth/done?state=not-a-real-state&status=success', {}, env);
  expect(bad.status).toBe(400);
});

// POST /api/connect no longer requires auth — resolveActor (worker/src/auth/anon.ts)
// falls back to a signed __Host-anon cookie session for a caller with no
// bearer token, so an anonymous request now succeeds instead of 401. It
// still ignores any userId supplied in the body either way; see
// tests/store/anon-connect.test.ts for the anon-cookie behavior itself.
it('POST /api/connect works anonymously and always ignores a userId in the body', async () => {
  const anonRes = await app.request(
    '/api/connect',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toolkit: 'github', userId: 'someone-else' }) },
    env
  );
  expect(anonRes.status).toBe(200);
  const anonBody = await anonRes.json<{ url: string; state: string }>();
  expect(anonBody.url).toMatch(/user=anon_/);
  expect(anonBody.url).not.toContain('user=someone-else');

  const t = await verifiedToken('u-oauth-2');
  const res = await app.request(
    '/api/connect',
    { method: 'POST', ...auth(t), body: JSON.stringify({ userId: 'someone-else', toolkit: 'github' }) },
    env
  );
  expect(res.status).toBe(200);
  const { url, state } = await res.json<{ url: string; state: string }>();
  expect(url).toContain('user=u-oauth-2');
  expect(url).not.toContain('user=someone-else');
  expect(typeof state).toBe('string');
});
