import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema, applyStoreSchema } from '../../src/db';
import { createUser, setEmailVerified } from '../../src/auth/users';
import { signAccessToken } from '../../src/auth/jwt';

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

it('requires auth', async () => {
  expect((await app.request('/api/settings', {}, env)).status).toBe(401);
});

it('settings round-trip for the token user', async () => {
  const t = await verifiedToken('u-routes-1');
  let res = await app.request('/api/settings', { method: 'PUT', ...auth(t), body: JSON.stringify({ contextPrompt: 'hi' }) }, env);
  expect(res.status).toBe(200);
  res = await app.request('/api/settings', auth(t), env);
  expect((await res.json<any>()).contextPrompt).toBe('hi');
});

it('user A cannot read user B settings (scoping)', async () => {
  const tA = await verifiedToken('u-routes-A');
  const tB = await verifiedToken('u-routes-B');
  await app.request('/api/settings', { method: 'PUT', ...auth(tB), body: JSON.stringify({ contextPrompt: 'B-secret' }) }, env);
  const res = await app.request('/api/settings', auth(tA), env);
  expect((await res.json<any>()).contextPrompt).not.toBe('B-secret'); // A sees its own (default '')
});

it('connections/mcps/tools are scoped and require auth', async () => {
  expect((await app.request('/api/connections', {}, env)).status).toBe(401);
  expect((await app.request('/api/mcps', {}, env)).status).toBe(401);
  expect((await app.request('/api/tools', {}, env)).status).toBe(401);

  const tA = await verifiedToken('u-routes-mcp-A');
  const created = await app.request('/api/mcps', { method: 'POST', ...auth(tA), body: JSON.stringify({ name: 'my-mcp' }) }, env);
  expect(created.status).toBe(201);
  const { id } = await created.json<{ id: string }>();

  const tB = await verifiedToken('u-routes-mcp-B');
  const listB = await app.request('/api/mcps', auth(tB), env);
  expect((await listB.json<any[]>())).toEqual([]);

  // B cannot delete A's mcp
  const delByB = await app.request(`/api/mcps/${id}`, { method: 'DELETE', ...auth(tB) }, env);
  expect(delByB.status).toBe(404);

  const delByA = await app.request(`/api/mcps/${id}`, { method: 'DELETE', ...auth(tA) }, env);
  expect(delByA.status).toBe(204);
});

// R1 regression: mounting storeRoutes at /api must not shadow the existing,
// non-auth /api/* routes registered directly on the main app.
it('does not shadow pre-existing non-auth /api/* routes', async () => {
  // /api/benchmark is a static-fixture route with no DB dependency, so a
  // non-200 here can only mean the store auth gate intercepted it.
  const res = await app.request('/api/benchmark', {}, env);
  expect(res.status).not.toBe(401);
  expect(res.status).toBe(200);
});
