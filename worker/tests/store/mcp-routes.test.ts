// Validation + owner scoping of the /api/mcps CRUD routes (store/routes.ts).
// The store-layer semantics are covered in mcps.test.ts; these exercise the
// HTTP boundary: shape validation on create/patch and the list shape the run
// pipeline consumes (UserMcp[]).
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema, applyStoreSchema } from '../../src/db';
import { signAccessToken } from '../../src/auth/jwt';

async function verifiedToken(userId: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`
  )
    .bind(userId, `${userId}@example.com`)
    .run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}

function jsonInit(token: string, method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await applyStoreSchema(env.DB);
});

it('POST /api/mcps rejects missing name, bad url, and non-string headers', async () => {
  const t = await verifiedToken('u-mcp-val');
  const cases: unknown[] = [
    { url: 'https://mcp.example.com' }, // no name
    { name: 'x', url: 'ftp://mcp.example.com' }, // non-http(s)
    { name: 'x', url: 'not a url' },
    { name: 'x', url: 'https://mcp.example.com', headers: { a: 1 } }, // non-string value
    { name: 'x', url: 'https://mcp.example.com', enabled: 'yes' }, // non-bool
    { name: 'x', url: 'https://mcp.example.com', extra: true }, // unknown key
  ];
  for (const body of cases) {
    const res = await app.request('/api/mcps', jsonInit(t, 'POST', body), env);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe('invalid mcp');
  }
});

it('POST /api/mcps accepts a valid entry and GET returns the pipeline shape', async () => {
  const t = await verifiedToken('u-mcp-ok');
  const create = await app.request(
    '/api/mcps',
    jsonInit(t, 'POST', { name: 'notes', url: 'https://mcp.example.com/sse', headers: { 'X-Key': 'v' } }),
    env
  );
  expect(create.status).toBe(201);
  const { id } = await create.json<{ id: string }>();
  expect(id).toBeTruthy();

  const list = await app.request('/api/mcps', { headers: { Authorization: `Bearer ${t}` } }, env);
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([
    { id, name: 'notes', url: 'https://mcp.example.com/sse', headers: { 'X-Key': 'v' }, enabled: true, createdAt: expect.any(Number) },
  ]);
});

it('PATCH /api/mcps/:id validates the patch and merges url/headers into config', async () => {
  const t = await verifiedToken('u-mcp-patch');
  const create = await app.request(
    '/api/mcps',
    jsonInit(t, 'POST', { name: 'a', url: 'https://one.example.com', headers: { A: '1' } }),
    env
  );
  const { id } = await create.json<{ id: string }>();

  const bad = await app.request(`/api/mcps/${id}`, jsonInit(t, 'PATCH', { url: 'javascript:alert(1)' }), env);
  expect(bad.status).toBe(400);

  const good = await app.request(`/api/mcps/${id}`, jsonInit(t, 'PATCH', { url: 'https://two.example.com', enabled: false }), env);
  expect(good.status).toBe(200);

  const list = await app.request('/api/mcps', { headers: { Authorization: `Bearer ${t}` } }, env);
  expect(await list.json()).toEqual([
    // headers survived the url-only patch (merged, not clobbered)
    { id, name: 'a', url: 'https://two.example.com', headers: { A: '1' }, enabled: false, createdAt: expect.any(Number) },
  ]);
});

it('PATCH on another user\'s mcp 404s without leaking', async () => {
  const owner = await verifiedToken('u-mcp-owner');
  const attacker = await verifiedToken('u-mcp-attacker');
  const create = await app.request('/api/mcps', jsonInit(owner, 'POST', { name: 'a', url: 'https://x.example.com' }), env);
  const { id } = await create.json<{ id: string }>();

  const res = await app.request(`/api/mcps/${id}`, jsonInit(attacker, 'PATCH', { url: 'https://evil.example.com' }), env);
  expect(res.status).toBe(404);
});
