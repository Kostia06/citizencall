// Memory → pipeline context (memory/context.ts): relevance pick, the ~1KB
// hard bound, clean skip when empty, and cycle safety through the resolver.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMemorySchema } from '../../src/memory/schema';
import { createMemory } from '../../src/memory/store';
import { buildMemoryContext } from '../../src/memory/context';

beforeAll(async () => {
  await applyMemorySchema(env.DB);
});

describe('buildMemoryContext', () => {
  it('returns an empty block for a user with no memories (clean skip)', async () => {
    const ctx = await buildMemoryContext(env.DB, 'ctx-empty-user', 'summarize the standup');
    expect(ctx.block).toBe('');
    expect(ctx.memoryIds).toEqual([]);
  });

  it('prefers keyword overlap, keeps at most 3, and stays under the byte bound', async () => {
    const U = 'ctx-pick-user';
    for (let i = 0; i < 6; i++) {
      await createMemory(env.DB, { userId: U, title: `Filler ${i}`, contentMd: `unrelated note number ${i} `.repeat(20), source: 'user', now: 1000 + i });
    }
    const hit = await createMemory(env.DB, {
      userId: U,
      title: 'Deploy checklist',
      contentMd: 'Always run the smoke tests before a deploy.',
      source: 'agent',
      now: 10, // oldest — only overlap can surface it
    });
    const ctx = await buildMemoryContext(env.DB, U, 'what should I do before a deploy?');
    expect(ctx.memoryIds.length).toBeLessThanOrEqual(3);
    expect(ctx.memoryIds[0]).toBe(hit.id); // overlap outranks recency
    expect(ctx.block.startsWith('Known context')).toBe(true);
    expect(ctx.block).toContain('smoke tests');
    expect(ctx.block.length).toBeLessThanOrEqual(1000);
  });

  it('zero-overlap prompts still ride the most recent memories', async () => {
    const U = 'ctx-recency-user';
    const recent = await createMemory(env.DB, { userId: U, title: 'Prefers short answers', contentMd: 'I prefer short answers', source: 'agent' });
    const ctx = await buildMemoryContext(env.DB, U, 'xylophone quartz zeppelin');
    expect(ctx.memoryIds).toContain(recent.id);
  });

  it('inlines [[linked]] memory content cycle-safely (self-link terminates)', async () => {
    const U = 'ctx-cycle-user';
    await createMemory(env.DB, { userId: U, title: 'Loop', contentMd: 'stack preference is bun, see [[Loop]] and [[Detail]]', source: 'user' });
    await createMemory(env.DB, { userId: U, title: 'Detail', contentMd: 'always pin versions', source: 'user' });
    const ctx = await buildMemoryContext(env.DB, U, 'what is my stack preference?');
    expect(ctx.block).toContain('bun');
    expect(ctx.block).toContain('always pin versions');
    expect(ctx.block.length).toBeLessThanOrEqual(1000);
  });
});
