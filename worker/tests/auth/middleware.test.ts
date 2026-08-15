import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
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
