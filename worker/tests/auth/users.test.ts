import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { consumeEmailToken, createEmailToken, createUser, getUserByEmail, setEmailVerified } from '../../src/auth/users';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('creates and finds a user by email, case-insensitively', async () => {
  await createUser(env.DB, { email: 'Test@Example.com', passwordHash: 'scrypt$x', now: 1 });
  const u = await getUserByEmail(env.DB, 'test@example.com');
  expect(u?.email).toBe('test@example.com');
  expect(u?.emailVerified).toBe(false);
});

it('verifies via a single-use email token', async () => {
  const u = await createUser(env.DB, { email: 'verify@example.com', passwordHash: 'scrypt$x', now: 1 });
  const token = await createEmailToken(env.DB, { userId: u.id, type: 'verify', now: 1, ttlMs: 1000 });
  expect(await consumeEmailToken(env.DB, 'verify', token, 2)).toBe(u.id);
  expect(await consumeEmailToken(env.DB, 'verify', token, 3)).toBeNull(); // single use
  await setEmailVerified(env.DB, u.id);
  const found = await getUserByEmail(env.DB, 'verify@example.com');
  expect(found?.emailVerified).toBe(true);
});

it('is single-use under concurrent consumption', async () => {
  const u = await createUser(env.DB, { email: 'race@example.com', passwordHash: 'scrypt$x', now: 1 });
  const token = await createEmailToken(env.DB, { userId: u.id, type: 'verify', now: 1, ttlMs: 1000 });
  const [a, b] = await Promise.all([
    consumeEmailToken(env.DB, 'verify', token, 2),
    consumeEmailToken(env.DB, 'verify', token, 2),
  ]);
  const results = [a, b];
  expect(results.filter((r) => r === u.id)).toHaveLength(1);
  expect(results.filter((r) => r === null)).toHaveLength(1);
});
