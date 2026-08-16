// Developer API keys — hashing, masking, owner scoping, usage counters.
import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import {
  applyApiKeysSchema,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  recordApiKeyCost,
  resolveApiKey,
} from '../../src/store/api-keys';

// Isolated storage resets D1 between tests, but the module's ensure guard
// is per-isolate — re-apply the schema explicitly.
beforeEach(async () => {
  await applyApiKeysSchema(env.DB);
});

it('creates a key whose full value appears only once and lists masked', async () => {
  const created = await createApiKey(env.DB, { userId: 'u-k1', name: 'ci bot', now: 1000 });
  expect(created.key).toMatch(/^cc_live_[0-9a-f]{48}$/);
  expect(created.masked).toBe(`cc_live_…${created.key.slice(-4)}`);

  const listed = await listApiKeys(env.DB, 'u-k1');
  expect(listed).toHaveLength(1);
  expect(listed[0]!.name).toBe('ci bot');
  expect(listed[0]!.masked).toBe(created.masked);
  // The full key never comes back from a list.
  expect(JSON.stringify(listed)).not.toContain(created.key);
});

it('resolves a valid key to its owner and bumps usage; rejects garbage', async () => {
  const created = await createApiKey(env.DB, { userId: 'u-k2', name: 'script', now: 1000 });

  const resolved = await resolveApiKey(env.DB, created.key, 2000);
  expect(resolved).toEqual({ userId: 'u-k2', keyId: created.id });

  expect(await resolveApiKey(env.DB, 'cc_live_not-a-real-key', 2000)).toBeNull();
  expect(await resolveApiKey(env.DB, 'sk-openai-shaped', 2000)).toBeNull();

  await recordApiKeyCost(env.DB, created.id, 0.0042);
  const row = (await listApiKeys(env.DB, 'u-k2'))[0]!;
  expect(row.requests).toBe(1);
  expect(row.costUsd).toBeCloseTo(0.0042);
  expect(row.lastUsedAt).toBe(2000);
});

it('delete is owner-scoped and a deleted key stops resolving', async () => {
  const created = await createApiKey(env.DB, { userId: 'u-k3', name: 'temp', now: 1 });
  expect(await deleteApiKey(env.DB, 'u-other', created.id)).toBe(false);
  expect(await deleteApiKey(env.DB, 'u-k3', created.id)).toBe(true);
  expect(await resolveApiKey(env.DB, created.key, 2)).toBeNull();
  expect(await listApiKeys(env.DB, 'u-k3')).toHaveLength(0);
});
