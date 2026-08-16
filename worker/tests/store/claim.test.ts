// Claim-on-login (store/claim.ts + auth/routes.ts): rows an anonymous
// `__Host-anon` session accumulated must follow the browser onto the real
// account at login/signup — idempotently, owner-safely, and keeping the
// authenticated user's own row on any conflict.
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema, applyStoreSchema } from '../../src/db';
import { applyCoreSchema } from '../support/schema';
import { createUser, setEmailVerified } from '../../src/auth/users';
import { hashPassword } from '../../src/auth/password';
import { ensureTwofaSchema } from '../../src/auth/twofa';
import { createState } from '../../src/providers/composio';

const jsonHeaders = { 'Content-Type': 'application/json' };
const PASSWORD = 'correct horse battery staple 9!';

function cookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('expected a Set-Cookie header');
  return setCookieHeader.split(';')[0]!;
}

function anonIdFromUrl(url: string): string {
  const match = url.match(/user=(anon_[^&]+)/);
  if (!match) throw new Error(`expected an anon_ user id in ${url}`);
  return match[1]!;
}

async function connectAnon(cookie?: string): Promise<{ url: string; cookie: string; anonId: string }> {
  const res = await app.request(
    '/api/connect',
    { method: 'POST', headers: { ...jsonHeaders, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ toolkit: 'github' }) },
    env
  );
  expect(res.status).toBe(200);
  const { url } = await res.json<{ url: string }>();
  return { url, cookie: cookie ?? cookiePair(res.headers.get('Set-Cookie')), anonId: anonIdFromUrl(url) };
}

async function seedConnection(anonId: string, toolkit: string, connectedAccountId: string): Promise<void> {
  const state = await createState(env, { userId: anonId, toolkit });
  const done = await app.request(
    `/oauth/done?state=${encodeURIComponent(state)}&status=success&connected_account_id=${connectedAccountId}`,
    {},
    env
  );
  expect(done.status).toBe(302);
}

// 2FA is ON by default (users.twofa_enabled DEFAULT 1) — turn it off for
// the plain-login tests so /auth/login issues tokens directly. The explicit
// 2fa test below leaves it on to prove the claim happens at /auth/2fa/verify.
async function makeLoginUser(email: string, { twofa = false }: { twofa?: boolean } = {}): Promise<string> {
  const user = await createUser(env.DB, { email, passwordHash: await hashPassword(PASSWORD), now: Date.now() });
  await setEmailVerified(env.DB, user.id);
  if (!twofa) await env.DB.prepare(`UPDATE users SET twofa_enabled=0 WHERE id=?`).bind(user.id).run();
  return user.id;
}

async function login(email: string, cookie?: string): Promise<{ accessToken: string; setCookies: string[] }> {
  const res = await app.request(
    '/auth/login',
    {
      method: 'POST',
      headers: { ...jsonHeaders, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
    env
  );
  expect(res.status).toBe(200);
  const body = await res.json<{ accessToken: string }>();
  const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return { accessToken: body.accessToken, setCookies };
}

async function listConnections(accessToken: string): Promise<Array<{ toolkit: string; status: string }>> {
  const res = await app.request('/api/connections', { headers: { Authorization: `Bearer ${accessToken}` } }, env);
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await applyStoreSchema(env.DB);
  await applyCoreSchema(env.DB); // runs/hops — claim re-parents run history too
  // In beforeAll (not lazily): ensureTwofaSchema memoizes per-isolate, but
  // vitest-pool-workers rolls per-TEST storage back — an ALTER applied
  // inside a test would vanish while the memo says "done". beforeAll
  // writes persist for the whole file.
  await ensureTwofaSchema(env.DB);
});

it('login with an anon cookie claims that session and clears the cookie', async () => {
  const { cookie, anonId } = await connectAnon();
  await seedConnection(anonId, 'github', 'ca_login_claim');
  // Seed the other claimable stores directly under the anon id.
  await env.DB.prepare(`INSERT INTO user_settings(user_id,prefs_json,updated_at) VALUES(?,?,1)`)
    .bind(anonId, JSON.stringify({ contextPrompt: 'from-anon' }))
    .run();
  await env.DB.prepare(`INSERT INTO user_tools(user_id,toolkit,tool,enabled) VALUES(?,?,?,0)`)
    .bind(anonId, 'github', 'create_issue')
    .run();
  await env.DB.prepare(`INSERT INTO user_mcps(id,user_id,name,config_json,enabled,created_at) VALUES('mcp-claim-1',?,?,?,1,1)`)
    .bind(anonId, 'my mcp', JSON.stringify({ url: 'https://x.example', headers: {} }))
    .run();
  await env.DB.prepare(
    `INSERT INTO runs(id,user_id,request_text,source,created_at,status,total_cost_usd) VALUES('run-claim-1',?,?,?,1,'done',0.01)`
  )
    .bind(anonId, 'anon-era run', 'text')
    .run();

  await makeLoginUser('claim-login@example.com');
  const { accessToken, setCookies } = await login('claim-login@example.com', cookie);
  expect(setCookies.some((c) => /^__Host-anon=;/.test(c) && /Max-Age=0/.test(c))).toBe(true);

  // Connection now lives under the user…
  expect(await listConnections(accessToken)).toContainEqual(expect.objectContaining({ toolkit: 'github', status: 'active' }));
  // …and the old anon id owns nothing anywhere.
  const userId = (await env.DB.prepare(`SELECT id FROM users WHERE email='claim-login@example.com'`).first<{ id: string }>())!.id;
  for (const [table, col] of [
    ['user_connections', 'user_id'],
    ['user_settings', 'user_id'],
    ['user_tools', 'user_id'],
    ['user_mcps', 'user_id'],
    ['runs', 'user_id'],
  ] as const) {
    const anonLeft = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col}=?`).bind(anonId).first<{ n: number }>();
    expect(anonLeft!.n).toBe(0);
    const mine = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col}=?`).bind(userId).first<{ n: number }>();
    expect(mine!.n).toBeGreaterThan(0);
  }
});

it('re-login is idempotent — the connection is still there and not duplicated', async () => {
  const { cookie, anonId } = await connectAnon();
  await seedConnection(anonId, 'github', 'ca_idem');
  await makeLoginUser('claim-idem@example.com');
  await login('claim-idem@example.com', cookie);
  const { accessToken } = await login('claim-idem@example.com'); // no anon cookie this time
  const list = await listConnections(accessToken);
  expect(list.filter((c) => c.toolkit === 'github')).toHaveLength(1);
  // Replaying the (cleared but still validly signed) anon cookie at a THIRD
  // login must also be a no-op: the anon id owns nothing anymore.
  const { accessToken: t3 } = await login('claim-idem@example.com', cookie);
  expect((await listConnections(t3)).filter((c) => c.toolkit === 'github')).toHaveLength(1);
});

it('on conflict the authenticated user\'s existing row wins', async () => {
  const userId = await makeLoginUser('claim-conflict@example.com');
  await env.DB.prepare(
    `INSERT INTO user_connections(user_id,toolkit,connected_account_id,status,connected_at) VALUES(?,?,?,'active',1)`
  )
    .bind(userId, 'github', 'ca_users_own')
    .run();

  const { cookie, anonId } = await connectAnon();
  await seedConnection(anonId, 'github', 'ca_anon_dupe');
  await login('claim-conflict@example.com', cookie);

  const row = await env.DB.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=? AND toolkit='github'`)
    .bind(userId)
    .first<{ connected_account_id: string }>();
  expect(row!.connected_account_id).toBe('ca_users_own'); // kept, not overwritten
});

it('claiming never touches another anon session\'s rows', async () => {
  const a = await connectAnon();
  await seedConnection(a.anonId, 'github', 'ca_actor_a');
  const b = await connectAnon();
  await seedConnection(b.anonId, 'github', 'ca_actor_b');

  await makeLoginUser('claim-isolation@example.com');
  await login('claim-isolation@example.com', a.cookie);

  // B's anon session still sees its own connection, untouched.
  const listB = await app.request('/api/connections', { headers: { Cookie: b.cookie } }, env);
  expect(await listB.json<Array<{ toolkit: string }>>()).toContainEqual(expect.objectContaining({ toolkit: 'github' }));
  const rowB = await env.DB.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=?`)
    .bind(b.anonId)
    .first<{ connected_account_id: string }>();
  expect(rowB!.connected_account_id).toBe('ca_actor_b');
});

it('signup (new account) claims the anon session too', async () => {
  const { cookie, anonId } = await connectAnon();
  await seedConnection(anonId, 'github', 'ca_signup_claim');

  const res = await app.request(
    '/auth/signup',
    { method: 'POST', headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify({ email: 'claim-signup@example.com', password: PASSWORD }) },
    env
  );
  expect(res.status).toBe(201);
  const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  expect(setCookies.some((c) => /^__Host-anon=;/.test(c) && /Max-Age=0/.test(c))).toBe(true);

  const userId = (await env.DB.prepare(`SELECT id FROM users WHERE email='claim-signup@example.com'`).first<{ id: string }>())!.id;
  const row = await env.DB.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=? AND toolkit='github'`)
    .bind(userId)
    .first<{ connected_account_id: string }>();
  expect(row!.connected_account_id).toBe('ca_signup_claim');
});

it('with 2FA on, the claim happens at /auth/2fa/verify (where tokens are issued)', async () => {
  const userId = await makeLoginUser('claim-2fa@example.com', { twofa: true });
  const { cookie, anonId } = await connectAnon();
  await seedConnection(anonId, 'github', 'ca_2fa_claim');

  const loginRes = await app.request(
    '/auth/login',
    { method: 'POST', headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify({ email: 'claim-2fa@example.com', password: PASSWORD }) },
    env
  );
  expect(loginRes.status).toBe(200);
  const challenge = await loginRes.json<{ requires2fa?: true; challengeId: string; devCode?: string }>();
  expect(challenge.requires2fa).toBe(true);
  // No tokens yet, so login must NOT have claimed or cleared the cookie.
  const still = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_connections WHERE user_id=?`).bind(anonId).first<{ n: number }>();
  expect(still!.n).toBe(1);

  const verifyRes = await app.request(
    '/auth/2fa/verify',
    { method: 'POST', headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.devCode }) },
    env
  );
  expect(verifyRes.status).toBe(200);
  const setCookies = (verifyRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  expect(setCookies.some((c) => /^__Host-anon=;/.test(c) && /Max-Age=0/.test(c))).toBe(true);
  const row = await env.DB.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=? AND toolkit='github'`)
    .bind(userId)
    .first<{ connected_account_id: string }>();
  expect(row!.connected_account_id).toBe('ca_2fa_claim');
});

it('signup on an EXISTING email must NOT claim (caller never authenticated)', async () => {
  await makeLoginUser('claim-existing@example.com');
  const { cookie, anonId } = await connectAnon();
  await seedConnection(anonId, 'github', 'ca_no_steal');

  const res = await app.request(
    '/auth/signup',
    { method: 'POST', headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify({ email: 'claim-existing@example.com', password: PASSWORD }) },
    env
  );
  expect(res.status).toBe(201); // anti-enumeration: identical response either way

  // The anon session still owns its connection — nothing moved.
  const row = await env.DB.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=?`)
    .bind(anonId)
    .first<{ connected_account_id: string }>();
  expect(row!.connected_account_id).toBe('ca_no_steal');
});
