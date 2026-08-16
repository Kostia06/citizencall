// GET /api/sessions (store/routes.ts): the ACTOR'S recent runs, newest
// first, limit 50 — scoped strictly to the resolved identity (bearer user
// or signed `__Host-anon` cookie). One actor must never see another's runs.
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
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`
  )
    .bind(userId, `${userId}+tok@example.com`)
    .run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}

async function seedRun(id: string, userId: string, text: string, createdAt: number, status = 'done', cost = 0.02): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,user_id,request_text,source,created_at,status,total_cost_usd) VALUES(?,?,?,'text',?,?,?)`
  )
    .bind(id, userId, text, createdAt, status, cost)
    .run();
}

interface SessionRow {
  id: string;
  requestText: string;
  createdAt: number;
  totalCostUsd: number;
  status: string;
}

async function getSessions(init: RequestInit): Promise<SessionRow[]> {
  const res = await app.request('/api/sessions', init, env);
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await applyStoreSchema(env.DB);
  await applyCoreSchema(env.DB);
});

it('lists only the bearer user\'s runs, newest first, with the summary fields', async () => {
  const tA = await verifiedToken('u-sess-A');
  await verifiedToken('u-sess-B');
  await seedRun('sess-a1', 'u-sess-A', 'older prompt', 1000);
  await seedRun('sess-a2', 'u-sess-A', 'newer prompt', 2000, 'error', 0.5);
  await seedRun('sess-b1', 'u-sess-B', 'not yours', 1500);

  const sessions = await getSessions({ headers: { Authorization: `Bearer ${tA}` } });
  expect(sessions.map((s) => s.id)).toEqual(['sess-a2', 'sess-a1']); // newest first, B's excluded
  expect(sessions[0]).toEqual({ id: 'sess-a2', requestText: 'newer prompt', createdAt: 2000, totalCostUsd: 0.5, status: 'error' });
});

it('user B never sees A\'s runs', async () => {
  const tB = await verifiedToken('u-sess-B2');
  await seedRun('sess-a3', 'u-sess-A2', 'a only', 1000);
  const sessions = await getSessions({ headers: { Authorization: `Bearer ${tB}` } });
  expect(sessions.map((s) => s.id)).not.toContain('sess-a3');
});

it('anon actors get their own cookie-scoped history — and nobody else\'s', async () => {
  // Mint two distinct anon sessions via any resolveActor route.
  const mint = async () => {
    const res = await app.request('/api/sessions', {}, env);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie');
    if (!setCookie) throw new Error('expected a fresh anon cookie');
    return setCookie.split(';')[0]!;
  };
  const cookieA = await mint();
  const cookieB = await mint();

  // Runs land under the anon id the cookie resolves to — start one via
  // POST /api/run is heavyweight here, so resolve the id by seeding through
  // the same signed cookie: hit /api/connect to learn the id.
  const connect = async (cookie: string) => {
    const res = await app.request(
      '/api/connect',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ toolkit: 'github' }) },
      env
    );
    const { url } = await res.json<{ url: string }>();
    return url.match(/user=(anon_[^&]+)/)![1]!;
  };
  const anonA = await connect(cookieA);
  const anonB = await connect(cookieB);
  await seedRun('sess-anon-a', anonA, 'anon A run', 3000);
  await seedRun('sess-anon-b', anonB, 'anon B run', 3000);

  const a = await getSessions({ headers: { Cookie: cookieA } });
  expect(a.map((s) => s.id)).toEqual(['sess-anon-a']);
  const b = await getSessions({ headers: { Cookie: cookieB } });
  expect(b.map((s) => s.id)).toEqual(['sess-anon-b']);
});

it('caps the list at 50, newest first', async () => {
  const t = await verifiedToken('u-sess-many');
  for (let i = 0; i < 55; i++) {
    await seedRun(`sess-many-${i}`, 'u-sess-many', `run ${i}`, 10_000 + i);
  }
  const sessions = await getSessions({ headers: { Authorization: `Bearer ${t}` } });
  expect(sessions).toHaveLength(50);
  expect(sessions[0]!.id).toBe('sess-many-54');
});
