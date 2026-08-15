// Run-result cache (cache/runResult.ts): per-user scoping is a hard security
// requirement — one user's cached run must never be served to another — plus
// TTL expiry and write/overwrite semantics.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyRunCacheSchema } from '../src/cache/schema';
import { getRunResult, putRunResult, type CachedRun } from '../src/cache/runResult';

beforeAll(async () => {
  await applyRunCacheSchema(env.DB);
});

function sampleValue(marker: string): Omit<CachedRun, 'cachedAt'> {
  return {
    events: [{ t: 'error', message: marker }],
    hops: [],
    toolCalls: [],
    totals: { totalCostUsd: 0.001, baselineCostUsd: 0.01, totalMs: 42, cacheHits: 0, planCacheHit: false },
  };
}

const keyA = { userId: 'user-a', normalizedText: 'summarize the week', policyVersion: 'v-test' };

describe('run-result cache', () => {
  it('round-trips a stored run for the same user/prompt/policy', async () => {
    await putRunResult(env.DB, keyA, sampleValue('a1'));
    const hit = await getRunResult(env.DB, keyA);
    expect(hit).not.toBeNull();
    expect(hit!.events).toEqual([{ t: 'error', message: 'a1' }]);
    expect(hit!.cachedAt).toBeGreaterThan(0);
  });

  it('never serves one user’s cached result to another user', async () => {
    await putRunResult(env.DB, keyA, sampleValue('a1'));
    expect(await getRunResult(env.DB, { ...keyA, userId: 'user-b' })).toBeNull();
  });

  it('misses when the policy version changes', async () => {
    await putRunResult(env.DB, keyA, sampleValue('a1'));
    expect(await getRunResult(env.DB, { ...keyA, policyVersion: 'v-next' })).toBeNull();
  });

  it('expires entries after their TTL', async () => {
    await putRunResult(env.DB, keyA, sampleValue('a1'), -1); // already expired
    expect(await getRunResult(env.DB, keyA)).toBeNull();
  });

  it('overwrites an existing entry for the same key', async () => {
    await putRunResult(env.DB, keyA, sampleValue('a1'));
    await putRunResult(env.DB, keyA, sampleValue('a2'));
    const hit = await getRunResult(env.DB, keyA);
    expect(hit!.events).toEqual([{ t: 'error', message: 'a2' }]);
  });

  it('refuses to operate without a userId (scoping rule)', async () => {
    await expect(putRunResult(env.DB, { ...keyA, userId: '' }, sampleValue('x'))).rejects.toThrow(/userId/);
    await expect(getRunResult(env.DB, { ...keyA, userId: '' })).rejects.toThrow(/userId/);
  });
});
