import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';
import { checkAndIncrement } from '../../src/auth/throttle';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('allows up to max then blocks within the window', async () => {
  const opts = { windowMs: 60000, max: 3 };
  for (let i = 0; i < 3; i++) {
    expect((await checkAndIncrement(env.DB, 'login:ip:test', 1000, opts)).allowed).toBe(true);
  }
  const blocked = await checkAndIncrement(env.DB, 'login:ip:test', 1000, opts);
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterMs).toBeGreaterThan(0);
});

it('resets after the window elapses', async () => {
  const opts = { windowMs: 60000, max: 1 };
  expect((await checkAndIncrement(env.DB, 'login:ip:test2', 1000, opts)).allowed).toBe(true);
  expect((await checkAndIncrement(env.DB, 'login:ip:test2', 1000, opts)).allowed).toBe(false);
  expect((await checkAndIncrement(env.DB, 'login:ip:test2', 70000, opts)).allowed).toBe(true);
});
