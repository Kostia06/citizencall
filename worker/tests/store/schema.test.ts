import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('creates the user_settings table', async () => {
  const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_settings'").first<{ name: string }>();
  expect(r?.name).toBe('user_settings');
});
