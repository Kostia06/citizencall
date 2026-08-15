import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { signAccessToken } from '../../src/auth/jwt';
import app from '../../src/index';

beforeAll(async () => { await applyAuthSchema(env.DB); });
const json = (b: unknown, h: Record<string, string> = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });

it('me requires a valid bearer token', async () => {
  const res = await app.request('/auth/me', {}, env);
  expect(res.status).toBe(401);
});

it('logout then refresh fails', async () => {
  const email = 'logout@example.com', password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);
  const login = await app.request('/auth/login', json({ email, password, }, { 'X-Client': 'native' }), env);
  const { accessToken, refreshToken } = await login.json<any>();

  const out = await app.request('/auth/logout', json({ refreshToken }, { 'X-Client': 'native', Authorization: `Bearer ${accessToken}` }), env);
  expect(out.status).toBe(204);
  const refresh = await app.request('/auth/refresh', json({ refreshToken }, { 'X-Client': 'native' }), env);
  expect(refresh.status).toBe(401);
});

it('X-Dev-User header alone (no DEV_AUTH_BYPASS) does not bypass auth', async () => {
  // The vitest env has no DEV_AUTH_BYPASS binding set, so this proves the
  // bypass cannot be triggered by header alone in an environment where the
  // flag isn't explicitly enabled (i.e. production).
  const res = await app.request('/auth/me', { headers: { 'X-Dev-User': 'someone' } }, env);
  expect(res.status).toBe(401);
});

it('DEV_AUTH_BYPASS="false" + X-Dev-User does not bypass auth', async () => {
  // Guards against the truthiness footgun: the string "false" must not be
  // treated as enabled. Only the exact string "true" may bypass.
  const res = await app.request(
    '/auth/me',
    { headers: { 'X-Dev-User': 'someone' } },
    { ...env, DEV_AUTH_BYPASS: 'false' }
  );
  expect(res.status).toBe(401);
});

it('a token signed with the old "dev-secret" fallback is rejected', async () => {
  // Proves the public-constant fallback is gone: forging a token with the
  // literal string that used to be the default secret must not work.
  const forged = await signAccessToken('dev-secret', {
    sub: 'forged-user', sid: 'forged-session', emailVerified: true,
  });
  const res = await app.request('/auth/me', { headers: { Authorization: `Bearer ${forged}` } }, env);
  expect(res.status).toBe(401);
});

it('DELETE /sessions/:id cannot revoke another user\'s session (IDOR)', async () => {
  const signupAndLogin = async (email: string) => {
    const password = 'a-perfectly-fine-passphrase';
    await app.request('/auth/signup', json({ email, password }), env);
    const login = await app.request('/auth/login', json({ email, password }, { 'X-Client': 'native' }), env);
    return login.json<any>();
  };

  const a = await signupAndLogin('idor-a@example.com');
  const b = await signupAndLogin('idor-b@example.com');

  const bSessions = await app.request('/auth/sessions', { headers: { Authorization: `Bearer ${b.accessToken}` } }, env);
  const [bSession] = await bSessions.json<any>();

  // A tries to delete B's session by id — must be rejected, not revoked.
  const crossDelete = await app.request(
    `/auth/sessions/${bSession.id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${a.accessToken}` } },
    env
  );
  expect(crossDelete.status).toBe(404);

  // B's session is untouched: B can still refresh and call /me.
  const bRefresh = await app.request('/auth/refresh', json({ refreshToken: b.refreshToken }, { 'X-Client': 'native' }), env);
  expect(bRefresh.status).toBe(200);
  const bMe = await app.request('/auth/me', { headers: { Authorization: `Bearer ${b.accessToken}` } }, env);
  expect(bMe.status).toBe(200);

  // A can delete its own session id.
  const aSessions = await app.request('/auth/sessions', { headers: { Authorization: `Bearer ${a.accessToken}` } }, env);
  const [aSession] = await aSessions.json<any>();
  const ownDelete = await app.request(
    `/auth/sessions/${aSession.id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${a.accessToken}` } },
    env
  );
  expect(ownDelete.status).toBe(204);
});
