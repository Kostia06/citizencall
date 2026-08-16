import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema, applyStoreSchema } from '../../src/db';
import { applyCoreSchema } from '../support/schema';
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
  // runs/hops/sub_tasks: /api/benchmark now aggregates live D1 stats
  // (reporting.ts), so the no-shadowing test below needs the core schema.
  await applyCoreSchema(env.DB);
});

it('settings is anon-friendly — no-cookie GET mints an anon session with defaults', async () => {
  // Was a 401 gate; swapped for resolveActor (like /connections) so the bar
  // arranger persists for anonymous sessions and claim-on-login re-keys it.
  const res = await app.request('/api/settings', {}, env);
  expect(res.status).toBe(200);
  expect((await res.json<any>()).buttons.length).toBeGreaterThan(0);
  expect(res.headers.get('set-cookie') ?? '').toContain('anon');
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

it('mcps/tools require auth; connections works anonymously (resolveActor) and stays scoped', async () => {
  expect((await app.request('/api/mcps', {}, env)).status).toBe(401);
  expect((await app.request('/api/tools', {}, env)).status).toBe(401);
  // /api/connections swapped its gate for resolveActor (worker/src/auth/anon.ts) so
  // an anonymous caller gets a cookie session instead of 401 — see
  // tests/store/anon-connect.test.ts for the anon-cookie behavior itself.
  const anonConnections = await app.request('/api/connections', {}, env);
  expect(anonConnections.status).toBe(200);
  expect(await anonConnections.json()).toEqual([]);

  const tA = await verifiedToken('u-routes-mcp-A');
  const created = await app.request('/api/mcps', { method: 'POST', ...auth(tA), body: JSON.stringify({ name: 'my-mcp', url: 'https://mcp.example.com' }) }, env);
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

// Regression: a literal JSON `null` body parses successfully (typeof null
// is 'object'), so naive property access on the parsed body would throw and
// surface as a 500 instead of the intended 400 for a missing field.
it('POST /mcps with a null JSON body returns 400, not 500', async () => {
  const t = await verifiedToken('u-routes-null-mcp');
  const res = await app.request('/api/mcps', { method: 'POST', ...auth(t), body: 'null' }, env);
  expect(res.status).toBe(400);
});

it('PATCH /tools with a null JSON body returns 400, not 500', async () => {
  const t = await verifiedToken('u-routes-null-tools');
  const res = await app.request('/api/tools', { method: 'PATCH', ...auth(t), body: 'null' }, env);
  expect(res.status).toBe(400);
});

// R1 regression: mounting storeRoutes at /api must not shadow the existing,
// non-auth /api/* routes registered directly on the main app.
it('does not shadow pre-existing non-auth /api/* routes', async () => {
  // /api/benchmark is a no-auth route (live D1 aggregate since
  // reporting.ts; schema applied in beforeAll), so a 401 here can only
  // mean the store auth gate intercepted it.
  const res = await app.request('/api/benchmark', {}, env);
  expect(res.status).not.toBe(401);
  expect(res.status).toBe(200);
});
