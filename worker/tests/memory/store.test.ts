// user_memories CRUD (memory/store.ts): owner scoping is the hard rule —
// one user's memories are never visible or mutable from another user's id,
// anon ids included — plus ordering, dedup lookup, and the claim re-parent.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMemorySchema } from '../../src/memory/schema';
import {
  createMemory,
  deleteMemory,
  getMemory,
  getMemoryByTitle,
  listMemories,
  reassignMemories,
  updateMemory,
} from '../../src/memory/store';

beforeAll(async () => {
  await applyMemorySchema(env.DB);
});

const A = 'user-a';
const B = 'user-b';

describe('memory store — CRUD + owner scoping', () => {
  it('creates and lists newest-first', async () => {
    const first = await createMemory(env.DB, { userId: A, title: 'Older', contentMd: 'old', source: 'user', now: 1000 });
    const second = await createMemory(env.DB, { userId: A, title: 'Newer', contentMd: 'new', source: 'agent', now: 2000 });
    const list = await listMemories(env.DB, A);
    expect(list.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(list[0]!.source).toBe('agent');
  });

  it('never returns another user’s memory — list, get, or title lookup', async () => {
    const mine = await createMemory(env.DB, { userId: A, title: 'Secret Plan', contentMd: 'x', source: 'user' });
    expect((await listMemories(env.DB, B)).find((m) => m.id === mine.id)).toBeUndefined();
    expect(await getMemory(env.DB, B, mine.id)).toBeNull();
    expect(await getMemoryByTitle(env.DB, B, 'Secret Plan')).toBeNull();
    expect(await getMemoryByTitle(env.DB, A, 'secret plan')).not.toBeNull(); // case-insensitive for the owner
  });

  it('update and delete are owner-scoped', async () => {
    const mine = await createMemory(env.DB, { userId: A, title: 'Mine', contentMd: 'v1', source: 'user' });
    expect(await updateMemory(env.DB, B, mine.id, { contentMd: 'stolen' })).toBeNull();
    expect(await deleteMemory(env.DB, B, mine.id)).toBe(false);
    const updated = await updateMemory(env.DB, A, mine.id, { contentMd: 'v2' });
    expect(updated!.contentMd).toBe('v2');
    expect(await deleteMemory(env.DB, A, mine.id)).toBe(true);
    expect(await getMemory(env.DB, A, mine.id)).toBeNull();
  });

  it('refuses to operate without a userId (scoping rule)', async () => {
    await expect(listMemories(env.DB, '')).rejects.toThrow(/userId/);
    await expect(createMemory(env.DB, { userId: '', title: 't', contentMd: 'c', source: 'user' })).rejects.toThrow(/userId/);
  });

  it('reassignMemories re-parents an anon session onto the claimed account', async () => {
    const anon = `anon_${crypto.randomUUID()}`;
    const claimed = `user_${crypto.randomUUID()}`;
    const m = await createMemory(env.DB, { userId: anon, title: 'Anon note', contentMd: 'n', source: 'agent' });
    await reassignMemories(env.DB, anon, claimed);
    expect(await getMemory(env.DB, anon, m.id)).toBeNull();
    expect((await getMemory(env.DB, claimed, m.id))?.title).toBe('Anon note');
  });
});
