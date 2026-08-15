import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { createSession, revokeAllForUser, rotateSession } from '../../src/auth/sessions';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('rotates a refresh token and invalidates the old one', async () => {
  const { refreshToken } = await createSession(env.DB, { userId: 'u-rot', userAgent: 'x', ip: '1', now: 1000 });
  const rotated = await rotateSession(env.DB, refreshToken, 2000);
  expect(rotated).not.toBe('invalid');
  expect(rotated).not.toBe('reused');
  // old token no longer works
  expect(await rotateSession(env.DB, refreshToken, 3000)).toBe('reused');
});

it('reuse-detection revokes the whole family', async () => {
  const { refreshToken } = await createSession(env.DB, { userId: 'u-fam', userAgent: 'x', ip: '1', now: 1000 });
  const r1 = await rotateSession(env.DB, refreshToken, 2000);
  if (r1 === 'invalid' || r1 === 'reused') throw new Error('setup');
  // replay the original (already-rotated) token → reused → family revoked
  expect(await rotateSession(env.DB, refreshToken, 2500)).toBe('reused');
  // the legitimately-rotated token is now also dead
  expect(await rotateSession(env.DB, r1.refreshToken, 3000)).toBe('invalid');
});

it('revokeAllForUser kills active sessions', async () => {
  const { refreshToken } = await createSession(env.DB, { userId: 'u-all', userAgent: 'x', ip: '1', now: 1000 });
  await revokeAllForUser(env.DB, 'u-all');
  expect(await rotateSession(env.DB, refreshToken, 2000)).toBe('invalid');
});
