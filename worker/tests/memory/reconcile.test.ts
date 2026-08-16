// mem0-style reconciliation (memory/reconcile.ts): candidate retrieval by
// keyword overlap, strict op parsing, the deterministic no-candidate /
// no-model fallbacks, and the full ADD/UPDATE/DELETE/NONE matrix applied
// against seeded rows.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMemorySchema } from '../../src/memory/schema';
import { createMemory, getMemory, listMemories, type Memory } from '../../src/memory/store';
import {
  applyReconcileOps,
  parseReconcileOps,
  pickCandidates,
  reconcileFacts,
  upsertFactByTitle,
  type ReconcileResult,
} from '../../src/memory/reconcile';

beforeAll(async () => {
  await applyMemorySchema(env.DB);
});

const freshResult = (): ReconcileResult => ({ saved: null, added: 0, updated: 0, deleted: 0 });

describe('parseReconcileOps', () => {
  it('parses the {"memory": [...]} contract, normalizing events and ids', () => {
    const ops = parseReconcileOps(
      '{"memory": [{"event": "update", "id": 0, "text": "The agent should be called Bob", "title": "Agent\'s name"}, {"event": "NONE"}]}'
    );
    expect(ops).toEqual([
      { event: 'UPDATE', id: '0', text: 'The agent should be called Bob', title: "Agent's name" },
      { event: 'NONE', id: undefined, text: undefined, title: undefined },
    ]);
  });

  it('tolerates think-blocks and fences; malformed input yields []', () => {
    expect(parseReconcileOps('<think>ok</think>```json\n{"memory": [{"event": "ADD", "text": "User likes tea"}]}\n```')[0]!.event).toBe('ADD');
    expect(parseReconcileOps('no json here')).toEqual([]);
    expect(parseReconcileOps('{"memory": "nope"}')).toEqual([]);
    expect(parseReconcileOps('{"memory": [{"event": "EXPLODE", "text": "x"}]}')).toEqual([]);
  });
});

describe('pickCandidates', () => {
  it('returns only overlapping memories, best overlap first', () => {
    const mk = (title: string, contentMd: string): Memory => ({
      id: title,
      userId: 'x',
      title,
      contentMd,
      source: 'agent',
      createdAt: 0,
      updatedAt: 0,
    });
    const a = mk("Agent's name", 'The agent should be called Jeff.');
    const b = mk('Deploy day', 'User deploys on Fridays');
    const c = mk('Coffee', 'User drinks oat milk lattes');
    const picked = pickCandidates(['The agent should be called Bob'], [c, b, a]);
    expect(picked.map((m) => m.id)).toEqual(["Agent's name"]); // b, c have no overlap
  });
});

describe('reconcileFacts — deterministic paths (no provider key)', () => {
  it('no candidates ⇒ plain ADD with clean titles, zero model calls', async () => {
    const U = 'rec-add-user';
    const r = await reconcileFacts(env, env.DB, U, ['User prefers short answers']);
    expect(r.added).toBe(1);
    expect(r.saved!.title).toBe('Preference: short answers');
    expect((await listMemories(env.DB, U)).length).toBe(1);
  });

  it('candidates but no usable model ⇒ duplicate facts are NONE, same-title facts upsert', async () => {
    const U = 'rec-fallback-user';
    const seeded = await createMemory(env.DB, {
      userId: U,
      title: "Agent's name",
      contentMd: 'The agent should be called Jeff.',
      source: 'agent',
    });
    // Identical fact → NONE (jaccard dedupe), nothing added.
    const none = await reconcileFacts(env, env.DB, U, ['The agent should be called Jeff.']);
    expect(none.added).toBe(0);
    expect((await listMemories(env.DB, U)).length).toBe(1);
    // Changed value, same canonical title → the seeded row is updated in place.
    const upd = await reconcileFacts(env, env.DB, U, ['The agent should be called Bob.']);
    expect(upd.saved!.id).toBe(seeded.id);
    expect(upd.saved!.contentMd).toBe('The agent should be called Bob.');
    expect((await listMemories(env.DB, U)).length).toBe(1);
  });
});

describe('applyReconcileOps — the ADD/UPDATE/DELETE/NONE matrix', () => {
  it('applies each event against seeded rows, resolving ids by candidate index', async () => {
    const U = 'rec-matrix-user';
    const name = await createMemory(env.DB, { userId: U, title: "Agent's name", contentMd: 'The agent should be called Jeff.', source: 'agent' });
    const stale = await createMemory(env.DB, { userId: U, title: 'Coffee', contentMd: 'User drinks drip coffee', source: 'agent' });
    const kept = await createMemory(env.DB, { userId: U, title: 'Deploy day', contentMd: 'User deploys on Fridays', source: 'agent' });
    const candidates = [name, stale, kept];
    const existing = await listMemories(env.DB, U);
    const r = await applyReconcileOps(
      env.DB,
      U,
      [
        { event: 'UPDATE', id: '0', text: 'The agent should be called Bob.', title: "Agent's name" },
        { event: 'DELETE', id: '1' },
        { event: 'NONE', id: '2' },
        { event: 'ADD', text: 'User prefers tabs over spaces' },
        { event: 'ADD', text: 'User deploys on Fridays' }, // duplicate of kept ⇒ skipped
        { event: 'DELETE', id: '9' }, // hallucinated index ⇒ no-op
      ],
      candidates,
      existing,
      freshResult()
    );
    expect({ added: r.added, updated: r.updated, deleted: r.deleted }).toEqual({ added: 1, updated: 1, deleted: 1 });
    expect((await getMemory(env.DB, U, name.id))!.contentMd).toBe('The agent should be called Bob.');
    expect(await getMemory(env.DB, U, stale.id)).toBeNull();
    const rows = await listMemories(env.DB, U);
    expect(rows.length).toBe(3); // name (updated), kept, one new ADD
    expect(rows.map((m) => m.title)).toContain('Preference: tabs over spaces');
  });
});

describe('upsertFactByTitle', () => {
  it('creates on a fresh title and updates in place on a repeat', async () => {
    const U = 'rec-upsert-user';
    const first = await upsertFactByTitle(env.DB, U, { title: "User's name", contentMd: "User's name is Ann." });
    const second = await upsertFactByTitle(env.DB, U, { title: "user's name", contentMd: "User's name is Kim." });
    expect(second.id).toBe(first.id); // NOCASE title match updates, never duplicates
    expect((await listMemories(env.DB, U)).length).toBe(1);
  });
});
