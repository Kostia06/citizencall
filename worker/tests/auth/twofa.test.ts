import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { ensureTwofaSchema, shouldExposeDevCode } from '../../src/auth/twofa';
import { getUserByEmail } from '../../src/auth/users';
import { jsonInit as json, twofaLogin } from '../support/twofa';
import app from '../../src/index';

beforeAll(async () => {
  await applyAuthSchema(env.DB);
  await ensureTwofaSchema(env.DB);
});

const PASSWORD = 'a-perfectly-fine-passphrase';

async function signupAndChallenge(email: string) {
  await app.request('/auth/signup', json({ email, password: PASSWORD }), env);
  const login = await app.request('/auth/login', json({ email, password: PASSWORD }), env);
  expect(login.status).toBe(200);
  const challenge = await login.json<any>();
  expect(challenge.requires2fa).toBe(true);
  return { login, challenge };
}

const wrongCode = (right: string) => (right === '000000' ? '111111' : '000000');
const verify = (challengeId: string, code: string, headers: Record<string, string> = {}) =>
  app.request('/auth/2fa/verify', json({ challengeId, code }, headers), env);
const resend = (challengeId: string) => app.request('/auth/2fa/resend', json({ challengeId }), env);
const backdateLastSent = (challengeId: string) =>
  env.DB.prepare(`UPDATE twofa_challenges SET last_sent_at=? WHERE id=?`)
    .bind(Date.now() - 31_000, challengeId).run();

it('happy path: login returns a challenge (no tokens), verify returns tokens that work', async () => {
  const { login, challenge } = await signupAndChallenge('twofa-happy@example.com');
  // The challenge response must not leak any credential material.
  expect(challenge.accessToken).toBeUndefined();
  expect(challenge.refreshToken).toBeUndefined();
  expect(login.headers.get('Set-Cookie')).toBeNull();
  expect(typeof challenge.challengeId).toBe('string');
  expect(challenge.devCode).toMatch(/^\d{6}$/); // no RESEND_API_KEY in test env

  const res = await verify(challenge.challengeId, challenge.devCode);
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(typeof body.accessToken).toBe('string');
  expect(body.user.email).toBe('twofa-happy@example.com');
  expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-refresh=/); // web client

  const me = await app.request('/auth/me', { headers: { Authorization: `Bearer ${body.accessToken}` } }, env);
  expect(me.status).toBe(200);
});

it('native verify returns refreshToken in the body and sets no cookie', async () => {
  const { challenge } = await signupAndChallenge('twofa-native@example.com');
  const res = await verify(challenge.challengeId, challenge.devCode, { 'X-Client': 'native' });
  expect(res.status).toBe(200);
  expect(res.headers.get('Set-Cookie')).toBeNull();
  const body = await res.json<any>();
  expect(typeof body.refreshToken).toBe('string');
});

it('wrong code 5 times kills the challenge — the correct code no longer works', async () => {
  const { challenge } = await signupAndChallenge('twofa-attempts@example.com');
  const bad = wrongCode(challenge.devCode);
  for (let i = 0; i < 5; i++) {
    const res = await verify(challenge.challengeId, bad);
    expect(res.status).toBe(401);
    expect((await res.json<any>()).error).toBe('Invalid or expired code.');
  }
  const dead = await verify(challenge.challengeId, challenge.devCode);
  expect(dead.status).toBe(401);
});

it('an expired code is rejected', async () => {
  const { challenge } = await signupAndChallenge('twofa-expired@example.com');
  await env.DB.prepare(`UPDATE twofa_challenges SET expires_at=? WHERE id=?`)
    .bind(Date.now() - 1000, challenge.challengeId).run();
  const res = await verify(challenge.challengeId, challenge.devCode);
  expect(res.status).toBe(401);
});

it('codes are single-use: a second verify with the same code fails', async () => {
  const { challenge } = await signupAndChallenge('twofa-single-use@example.com');
  const first = await verify(challenge.challengeId, challenge.devCode);
  expect(first.status).toBe(200);
  const replay = await verify(challenge.challengeId, challenge.devCode);
  expect(replay.status).toBe(401);
});

it('resend rotates the code: new code works, old code is dead', async () => {
  const { challenge } = await signupAndChallenge('twofa-rotate@example.com');
  await backdateLastSent(challenge.challengeId);
  const res = await resend(challenge.challengeId);
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(body).toMatchObject({ ok: true, retryAfterSec: 30 });
  expect(body.devCode).toMatch(/^\d{6}$/);

  // Old code invalidated by rotation (1-in-a-million flake if the fresh
  // random code equals the old one — acceptable).
  const old = await verify(challenge.challengeId, challenge.devCode);
  expect(old.status).toBe(401);
  const fresh = await verify(challenge.challengeId, body.devCode);
  expect(fresh.status).toBe(200);
});

it('resend inside the 30s window is a generic no-op: no rotation, no devCode', async () => {
  const { challenge } = await signupAndChallenge('twofa-rate-limit@example.com');
  const res = await resend(challenge.challengeId); // immediately after login send
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(body).toEqual({ ok: true, retryAfterSec: 30 }); // no devCode leaked
  // Original code untouched by the denied resend.
  const ok = await verify(challenge.challengeId, challenge.devCode);
  expect(ok.status).toBe(200);
});

it('resend stops after 5 sends per challenge', async () => {
  const { challenge } = await signupAndChallenge('twofa-max-sends@example.com');
  await env.DB.prepare(`UPDATE twofa_challenges SET sends=5, last_sent_at=? WHERE id=?`)
    .bind(Date.now() - 31_000, challenge.challengeId).run();
  const res = await resend(challenge.challengeId);
  expect(res.status).toBe(200);
  expect(await res.json<any>()).toEqual({ ok: true, retryAfterSec: 30 }); // denied, generic
  const ok = await verify(challenge.challengeId, challenge.devCode); // code unchanged
  expect(ok.status).toBe(200);
});

it('resend for an unknown challengeId returns the identical generic body (no enumeration)', async () => {
  const res = await resend('definitely-not-a-real-challenge-id');
  expect(res.status).toBe(200);
  expect(await res.json<any>()).toEqual({ ok: true, retryAfterSec: 30 });
});

it('a user with twofa_enabled=0 logs in directly with tokens (current behavior preserved)', async () => {
  const email = 'twofa-off@example.com';
  await app.request('/auth/signup', json({ email, password: PASSWORD }), env);
  await env.DB.prepare(`UPDATE users SET twofa_enabled=0 WHERE email=?`).bind(email).run();
  const res = await app.request('/auth/login', json({ email, password: PASSWORD }), env);
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(body.requires2fa).toBeUndefined();
  expect(typeof body.accessToken).toBe('string');
  expect(body.user.email).toBe(email);
});

it('verify with a bogus challengeId fails with the same generic error', async () => {
  const res = await verify('nope', '123456');
  expect(res.status).toBe(401);
  expect((await res.json<any>()).error).toBe('Invalid or expired code.');
});

it('devCode gating: exposed only when no key is configured or bypass is exactly "true"', () => {
  const base = {} as any;
  expect(shouldExposeDevCode({ ...base })).toBe(true); // no key, dev fallback
  expect(shouldExposeDevCode({ ...base, RESEND_API_KEY: 're_live_key' })).toBe(false); // production
  expect(shouldExposeDevCode({ ...base, RESEND_API_KEY: 're_live_key', DEV_AUTH_BYPASS: 'true' })).toBe(true);
  expect(shouldExposeDevCode({ ...base, RESEND_API_KEY: 're_live_key', DEV_AUTH_BYPASS: 'false' })).toBe(false);
  expect(shouldExposeDevCode({ ...base, RESEND_API_KEY: 're_live_key', DEV_AUTH_BYPASS: '1' })).toBe(false);
});

it('signup default: new users have twofa_enabled=1', async () => {
  const email = 'twofa-default@example.com';
  await app.request('/auth/signup', json({ email, password: PASSWORD }), env);
  const user = await getUserByEmail(env.DB, email);
  const row = await env.DB.prepare(`SELECT twofa_enabled FROM users WHERE id=?`)
    .bind(user!.id).first<{ twofa_enabled: number }>();
  expect(row?.twofa_enabled).toBe(1);
});
