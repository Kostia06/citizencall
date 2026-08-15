// Cycle safety for [[link]] resolution (memory/resolve.ts) — the roadmap's
// explicit HARD requirement. Every cycle shape must terminate: self-link,
// two-node cycle, and long chains must be cut at the depth cap.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMemorySchema } from '../../src/memory/schema';
import { createMemory } from '../../src/memory/store';
import { resolveMemory } from '../../src/memory/resolve';
import { parseLinks } from '../../src/memory/links';

beforeAll(async () => {
  await applyMemorySchema(env.DB);
});

const U = 'resolve-user';

async function mem(title: string, contentMd: string, userId = U) {
  return createMemory(env.DB, { userId, title, contentMd, source: 'user' });
}

describe('parseLinks', () => {
  it('extracts [[memory]] and @tool refs, de-duplicated', () => {
    const links = parseLinks('See [[Plan A]] and [[plan a]] again, plus @github and @GitHub, mail me@example.com');
    expect(links.memoryRefs).toEqual(['Plan A']);
    expect(links.toolRefs).toEqual(['github']);
  });
});

describe('resolveMemory — cycle safety (HARD requirement)', () => {
  it('A→A self-link terminates and does not duplicate A', async () => {
    const a = await mem('Self', 'I link to [[Self]] forever');
    const r = await resolveMemory(env.DB, U, a.id);
    expect(r!.root.id).toBe(a.id);
    expect(r!.linked).toEqual([]); // root already visited — never re-enters
  });

  it('A→B→A cycle terminates with each node visited once', async () => {
    await mem('Cycle A', 'goes to [[Cycle B]]');
    await mem('Cycle B', 'goes back to [[Cycle A]]');
    const r = await resolveMemory(env.DB, U, 'Cycle A');
    expect(r!.linked.map((m) => m.title)).toEqual(['Cycle B']);
  });

  it('deep chains are cut at the depth cap and flagged truncated', async () => {
    await mem('Chain 1', '→ [[Chain 2]]');
    await mem('Chain 2', '→ [[Chain 3]]');
    await mem('Chain 3', '→ [[Chain 4]]');
    await mem('Chain 4', 'the end');
    const r = await resolveMemory(env.DB, U, 'Chain 1', { maxDepth: 2 });
    expect(r!.linked.map((m) => m.title)).toEqual(['Chain 2', 'Chain 3']);
    expect(r!.truncated).toBe(true);
    const deep = await resolveMemory(env.DB, U, 'Chain 1', { maxDepth: 10 });
    expect(deep!.linked.map((m) => m.title)).toEqual(['Chain 2', 'Chain 3', 'Chain 4']);
    expect(deep!.truncated).toBe(false);
  });

  it('maxDepth 0 resolves the root only', async () => {
    await mem('Rooty', 'links [[Chain 1]]');
    const r = await resolveMemory(env.DB, U, 'Rooty', { maxDepth: 0 });
    expect(r!.linked).toEqual([]);
    expect(r!.truncated).toBe(true);
  });

  it('collects @tool refs across the walk and reports broken links', async () => {
    await mem('Tools', 'use @github then [[Nowhere]] and [[Tools Child]]');
    await mem('Tools Child', 'also @gmail');
    const r = await resolveMemory(env.DB, U, 'Tools');
    expect(r!.tools).toEqual(['github', 'gmail']);
    expect(r!.unresolved).toEqual(['Nowhere']);
  });

  it('a [[link]] can never cross users', async () => {
    await mem('Other Secret', 'private', 'resolve-other-user');
    await mem('Leaky', 'try [[Other Secret]]');
    const r = await resolveMemory(env.DB, U, 'Leaky');
    expect(r!.linked).toEqual([]);
    expect(r!.unresolved).toEqual(['Other Secret']);
  });
});
