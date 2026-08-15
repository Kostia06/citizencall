// L2 tool cache must be scoped per-user, always (SPEC.md §8 scoping rule):
// "No tier keyed without user_id may store tool output, or model output
// derived from tool output." These tests operate purely at the key-derivation
// level — no D1 needed to prove two users can never collide on a cache key.
import { describe, expect, it } from 'vitest';
import { toolCacheKey } from '../src/cache/tool';
import { exactCacheKey } from '../src/cache/exact';

describe('L2 tool cache — user isolation', () => {
  const baseArgs = { repo: 'understudy', since: '2026-08-01' };

  it('produces different keys for different users with identical args', async () => {
    const keyA = await toolCacheKey({ userId: 'demo_kos', toolkit: 'github', tool: 'list_commits', args: baseArgs });
    const keyB = await toolCacheKey({
      userId: 'demo_teammate',
      toolkit: 'github',
      tool: 'list_commits',
      args: baseArgs,
    });
    expect(keyA).not.toBe(keyB);
  });

  it('produces the same key for the same user and args regardless of key order', async () => {
    const keyA = await toolCacheKey({
      userId: 'demo_kos',
      toolkit: 'github',
      tool: 'list_commits',
      args: { repo: 'understudy', since: '2026-08-01' },
    });
    const keyB = await toolCacheKey({
      userId: 'demo_kos',
      toolkit: 'github',
      tool: 'list_commits',
      args: { since: '2026-08-01', repo: 'understudy' },
    });
    expect(keyA).toBe(keyB);
  });

  it('refuses to derive a key without a userId — the scoping rule enforced at the boundary', async () => {
    await expect(toolCacheKey({ userId: '', toolkit: 'gmail', tool: 'fetch_emails', args: {} })).rejects.toThrow(
      /userId/
    );
  });
});

describe('L1 exact cache — deliberately global (no user dimension)', () => {
  it('is a pure function of request shape, not identity', async () => {
    const key = await exactCacheKey({ modelId: 'Qwen/Qwen3-8B', prompt: 'hello', temperature: 0, maxTokens: 32, seed: 42 });
    // Structural guarantee: the L1 key type has no userId field to smuggle
    // one in, unlike L2's ToolCacheParams.
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
