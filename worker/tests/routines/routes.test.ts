// Routine CRUD + manual trigger routes (worker/src/routines/routes.ts).
// Owner scoping mirrors tests/store/routes.test.ts; the anon-cookie path
// mirrors tests/store/anon-connect.test.ts.
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema } from '../../src/db';
import { applyRoutinesSchema } from '../../src/routines/schema';
import { signAccessToken } from '../../src/auth/jwt';

async function verifiedToken(userId: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`
  )
    .bind(userId, `${userId}@example.com`)
    .run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}
const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
const jsonHeaders = { 'Content-Type': 'application/json' };

function cookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('expected a Set-Cookie header');
  return setCookieHeader.split(';')[0]!;
}

async function createFor(token: string, body: Record<string, unknown>): Promise<Response> {
  return app.request('/api/routines', { method: 'POST', ...auth(token), body: JSON.stringify(body) }, env);
}

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await applyRoutinesSchema(env.DB);
});

it('CRUD round-trip for the token user', async () => {
  const t = await verifiedToken('u-rt-crud');
  const created = await createFor(t, { name: 'Morning digest', prompt: 'summarize my inbox', schedule: 'daily' });
  expect(created.status).toBe(201);
  const routine = await created.json<any>();
  expect(routine).toMatchObject({
    name: 'Morning digest',
    prompt: 'summarize my inbox',
    schedule: 'daily',
    enabled: true,
    lastRunAt: null,
  });
  expect(typeof routine.id).toBe('string');
  expect(typeof routine.createdAt).toBe('number');

  const list = await (await app.request('/api/routines', auth(t), env)).json<any[]>();
  expect(list.map((r) => r.id)).toContain(routine.id);

  // Partial update: only `enabled` changes, the rest is preserved.
  const put = await app.request(
    `/api/routines/${routine.id}`,
    { method: 'PUT', ...auth(t), body: JSON.stringify({ enabled: false }) },
    env
  );
  expect(put.status).toBe(200);
  const updated = await put.json<any>();
  expect(updated.enabled).toBe(false);
  expect(updated.name).toBe('Morning digest');
  expect(updated.schedule).toBe('daily');

  // schedule can be cleared to null (manual-only).
  const cleared = await app.request(
    `/api/routines/${routine.id}`,
    { method: 'PUT', ...auth(t), body: JSON.stringify({ schedule: null }) },
    env
  );
  expect((await cleared.json<any>()).schedule).toBeNull();

  const del = await app.request(`/api/routines/${routine.id}`, { method: 'DELETE', ...auth(t) }, env);
  expect(del.status).toBe(204);
  const after = await (await app.request('/api/routines', auth(t), env)).json<any[]>();
  expect(after.map((r) => r.id)).not.toContain(routine.id);
});

it("owner scoping: A's routines are invisible and untouchable for B and anon", async () => {
  const tA = await verifiedToken('u-rt-A');
  const tB = await verifiedToken('u-rt-B');
  const { id } = await (await createFor(tA, { name: 'A only', prompt: 'p' })).json<{ id: string }>();

  const listB = await (await app.request('/api/routines', auth(tB), env)).json<any[]>();
  expect(listB).toEqual([]);

  // A fresh anon session sees nothing either.
  const anonList = await app.request('/api/routines', {}, env);
  expect(anonList.status).toBe(200);
  expect(await anonList.json()).toEqual([]);

  const putB = await app.request(
    `/api/routines/${id}`,
    { method: 'PUT', ...auth(tB), body: JSON.stringify({ name: 'stolen' }) },
    env
  );
  expect(putB.status).toBe(404);
  expect((await app.request(`/api/routines/${id}`, { method: 'DELETE', ...auth(tB) }, env)).status).toBe(404);
  expect((await app.request(`/api/routines/${id}/run`, { method: 'POST', ...auth(tB) }, env)).status).toBe(404);

  // Still there for A.
  const listA = await (await app.request('/api/routines', auth(tA), env)).json<any[]>();
  expect(listA.map((r) => r.id)).toContain(id);
});

it('anon actors can create routines and see them again via the cookie session', async () => {
  const created = await app.request(
    '/api/routines',
    { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'anon routine', prompt: 'hello' }) },
    env
  );
  expect(created.status).toBe(201);
  const setCookie = created.headers.get('Set-Cookie');
  expect(setCookie).toMatch(/^__Host-anon=/);
  const { id } = await created.json<{ id: string }>();

  const list = await app.request('/api/routines', { headers: { Cookie: cookiePair(setCookie) } }, env);
  expect((await list.json<any[]>()).map((r) => r.id)).toContain(id);
});

it('validation rejects bad names, prompts, schedules, and unknown keys', async () => {
  const t = await verifiedToken('u-rt-val');
  const bad: Record<string, unknown>[] = [
    { prompt: 'p' }, // name missing
    { name: '', prompt: 'p' },
    { name: 'x'.repeat(101), prompt: 'p' },
    { name: 'n' }, // prompt missing
    { name: 'n', prompt: '' },
    { name: 'n', prompt: 'x'.repeat(4001) },
    { name: 'n', prompt: 'p', schedule: 'monthly' },
    { name: 'n', prompt: 'p', schdule: 'daily' }, // typo key -> .strict()
  ];
  for (const body of bad) {
    expect((await createFor(t, body)).status).toBe(400);
  }
  // Literal JSON `null` body is a clean 400, not a 500.
  const nullBody = await app.request('/api/routines', { method: 'POST', ...auth(t), body: 'null' }, env);
  expect(nullBody.status).toBe(400);
  // PUT validates too.
  const { id } = await (await createFor(t, { name: 'ok', prompt: 'p' })).json<{ id: string }>();
  const badPut = await app.request(
    `/api/routines/${id}`,
    { method: 'PUT', ...auth(t), body: JSON.stringify({ schedule: 'yearly' }) },
    env
  );
  expect(badPut.status).toBe(400);
});

it('POST /api/routines/:id/run starts a run through the RUN namespace and stamps lastRunAt', async () => {
  const t = await verifiedToken('u-rt-run');
  const { id } = await (
    await createFor(t, { name: 'run me', prompt: 'do the thing', schedule: null })
  ).json<{ id: string }>();

  // Mocked RUN binding (passed via app.request's env): the real RunDO would
  // kick off a background pipeline via waitUntil, which outlives the test's
  // isolated-storage scope. Recording the /start body asserts the exact
  // /api/run contract instead.
  const started: any[] = [];
  const mockRun = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (_url: string, init?: RequestInit) => {
        started.push(JSON.parse(String(init?.body)));
        return new Response('{}');
      },
    }),
  };
  const envWithMock = { ...env, RUN: mockRun } as typeof env;

  const before = Date.now();
  const res = await app.request(`/api/routines/${id}/run`, { method: 'POST', ...auth(t) }, envWithMock);
  expect(res.status).toBe(200);
  const { runId } = await res.json<{ runId: string }>();
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({
    runId,
    userId: 'u-rt-run',
    text: 'do the thing',
    source: 'text',
    noCache: false,
  });

  const list = await (await app.request('/api/routines', auth(t), env)).json<any[]>();
  const routine = list.find((r) => r.id === id);
  expect(routine.lastRunAt).toBeGreaterThanOrEqual(before);
});
