import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import app from '../../src/index';

beforeAll(async () => { await applyAuthSchema(env.DB); });

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

it('signup → login happy path (login allowed unverified)', async () => {
  const email = 'flow@example.com';
  const password = 'a-perfectly-fine-passphrase';
  let res = await app.request('/auth/signup', json({ email, password }), env);
  expect(res.status).toBe(201);

  res = await app.request('/auth/login', json({ email, password }), env);
  expect(res.status).toBe(200);
  const { accessToken, user } = await res.json<any>();
  expect(user.email).toBe(email);
  expect(typeof accessToken).toBe('string');
});

it('login gives a generic error for wrong password (no enumeration)', async () => {
  const res = await app.request('/auth/login', json({ email: 'flow@example.com', password: 'wrong-wrong-wrong' }), env);
  expect(res.status).toBe(401);
  expect((await res.json<any>()).error).toBe('Invalid email or password.');
});

it('unknown email login returns the SAME generic error', async () => {
  const res = await app.request('/auth/login', json({ email: 'nobody@example.com', password: 'whatever-here-ok' }), env);
  expect(res.status).toBe(401);
  expect((await res.json<any>()).error).toBe('Invalid email or password.');
});

it('rejects weak passwords at signup', async () => {
  const res = await app.request('/auth/signup', json({ email: 'weak@example.com', password: 'short' }), env);
  expect(res.status).toBe(400);
});
