import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { createEmailToken, getUserByEmail } from '../../src/auth/users';
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

it('signup on an already-existing email returns the identical generic response (no enumeration)', async () => {
  const email = 'dupe@example.com';
  const password = 'a-perfectly-fine-passphrase';
  const first = await app.request('/auth/signup', json({ email, password }), env);
  expect(first.status).toBe(201);
  const firstBody = await first.json<any>();

  const second = await app.request('/auth/signup', json({ email, password }), env);
  expect(second.status).toBe(201);
  const secondBody = await second.json<any>();

  expect(secondBody).toEqual(firstBody);
  expect(secondBody).toEqual({ ok: true });
});

it('login response does not leak the password hash', async () => {
  const email = 'nohash@example.com';
  const password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);
  const res = await app.request('/auth/login', json({ email, password }), env);
  expect(res.status).toBe(200);
  const { user } = await res.json<any>();
  expect(user.passwordHash).toBeUndefined();
});

it('native login returns refreshToken in the body and sets no cookie', async () => {
  const email = 'native-login@example.com';
  const password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);
  const res = await app.request('/auth/login', json({ email, password }, { 'X-Client': 'native' }), env);
  expect(res.status).toBe(200);
  expect(res.headers.get('Set-Cookie')).toBeNull();
  const body = await res.json<any>();
  expect(typeof body.refreshToken).toBe('string');
});

it('web login sets the __Host-refresh cookie and omits refreshToken from the body', async () => {
  const email = 'web-login@example.com';
  const password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);
  const res = await app.request('/auth/login', json({ email, password }), env);
  expect(res.status).toBe(200);
  const cookie = res.headers.get('Set-Cookie');
  expect(cookie).toMatch(/^__Host-refresh=/);
  const body = await res.json<any>();
  expect(body.refreshToken).toBeUndefined();
});

it('refresh happy path (native): a new accessToken comes back for a valid refreshToken', async () => {
  const email = 'refresh-happy@example.com';
  const password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);
  const login = await app.request('/auth/login', json({ email, password }, { 'X-Client': 'native' }), env);
  const { refreshToken } = await login.json<any>();

  const res = await app.request('/auth/refresh', json({ refreshToken }, { 'X-Client': 'native' }), env);
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(typeof body.accessToken).toBe('string');
});

it('password reset happy path: new password logs in and old sessions are revoked', async () => {
  const email = 'reset-happy@example.com';
  const oldPassword = 'a-perfectly-fine-passphrase';
  const newPassword = 'a-different-fine-passphrase';
  await app.request('/auth/signup', json({ email, password: oldPassword }), env);

  // Establish an old session whose refresh token must die on reset.
  const oldLogin = await app.request('/auth/login', json({ email, password: oldPassword }, { 'X-Client': 'native' }), env);
  const { refreshToken: oldRefreshToken } = await oldLogin.json<any>();

  const user = await getUserByEmail(env.DB, email);
  const resetToken = await createEmailToken(env.DB, { userId: user!.id, type: 'reset', now: Date.now(), ttlMs: 3600000 });

  const reset = await app.request('/auth/password/reset', json({ token: resetToken, password: newPassword }), env);
  expect(reset.status).toBe(200);

  const newLogin = await app.request('/auth/login', json({ email, password: newPassword }), env);
  expect(newLogin.status).toBe(200);

  const oldRefresh = await app.request('/auth/refresh', json({ refreshToken: oldRefreshToken }, { 'X-Client': 'native' }), env);
  expect(oldRefresh.status).toBe(401);
});

it('resend-verification returns the identical generic body for an existing and a non-existent email (no enumeration)', async () => {
  const email = 'resend-existing@example.com';
  const password = 'a-perfectly-fine-passphrase';
  await app.request('/auth/signup', json({ email, password }), env);

  const existing = await app.request('/auth/resend-verification', json({ email }), env);
  expect(existing.status).toBe(200);
  const existingBody = await existing.json<any>();

  const missing = await app.request('/auth/resend-verification', json({ email: 'nobody-resend@example.com' }), env);
  expect(missing.status).toBe(200);
  const missingBody = await missing.json<any>();

  expect(existingBody).toEqual({ ok: true });
  expect(missingBody).toEqual({ ok: true });
});
