import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyAuthSchema } from '../../src/db';

beforeAll(async () => { await applyAuthSchema(env.DB); });

it('creates the users table', async () => {
  const r = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ name: string }>();
  expect(r?.name).toBe('users');
});
