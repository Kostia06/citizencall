// Agent auto-write (pipeline/memory-hook.ts) and its runPipeline wiring:
// explicit "remember …" prompts store without a model call, extraction
// parsing is strict, cache-hit replays never auto-write, and the injected
// memory context is part of the run-cache key by construction.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { applyRunCacheSchema } from '../../src/cache/schema';
import { applyMemorySchema } from '../../src/memory/schema';
import { createMemory, listMemories, deleteMemory } from '../../src/memory/store';
import { extractExplicitRemember, maybeAutoWriteMemory, parseExtraction } from '../../src/pipeline/memory-hook';
import { runPipeline } from '../../src/pipeline/run';
import type { ModelCandidate, Policy, TraceEvent } from '../../src/types';
import { applyCoreSchema } from '../support/schema';

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyStoreSchema(env.DB);
  await applyRunCacheSchema(env.DB);
  await applyMemorySchema(env.DB);
});

const candidates: ModelCandidate[] = [
  {
    id: 'small-summarizer',
    modelClass: 'test',
    contextLength: 32768,
    paramsB: 4,
    pricePerMTokIn: 0.05,
    pricePerMTokOut: 0.1,
    concurrencyCost: 1,
    availability: 'warm',
    isHotLive: true,
    toolUse: true,
    availableOnPlan: true,
  },
  {
    id: 'big-generalist',
    modelClass: 'test',
    contextLength: 262144,
    paramsB: 100,
    pricePerMTokIn: 0.6,
    pricePerMTokOut: 2.2,
    concurrencyCost: 4,
    availability: 'warm',
    isHotLive: true,
    toolUse: true,
    availableOnPlan: true,
  },
];

const policy: Policy = {
  version: 'v-test',
  generatedAt: '2026-01-01T00:00:00Z',
  weights: { quality: 1, cost: 0.35 },
  ladders: {
    classify: [],
    extract_fields: ['small-summarizer', 'big-generalist'],
    summarize: ['small-summarizer', 'big-generalist'],
    normalize: [],
  },
  quality: { 'small-summarizer': { summarize: 0.9, extract_fields: 0.6 }, 'big-generalist': { summarize: 0.95, extract_fields: 0.9 } },
  qualityCI: {},
  baselines: { frontier: 'big-generalist', cheapDefault: 'small-summarizer' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

type AnyEvent = TraceEvent & { t: string };

async function run(userId: string, text: string): Promise<AnyEvent[]> {
  const events: AnyEvent[] = [];
  await runPipeline(env, (e) => events.push(e as AnyEvent), { runId: crypto.randomUUID(), userId, text, source: 'text' }, { policy, candidates });
  return events;
}

const kinds = (events: AnyEvent[]) => events.map((e) => e.t);

describe('extractExplicitRemember / parseExtraction', () => {
  it('lifts the fact out of a "remember that …" prompt', () => {
    const f = extractExplicitRemember('Please remember that I prefer short answers.');
    expect(f!.contentMd).toBe('I prefer short answers.');
    expect(f!.title).toBe('I prefer short answers');
  });

  it('returns null when there is nothing to remember', () => {
    expect(extractExplicitRemember('summarize the standup notes')).toBeNull();
    expect(extractExplicitRemember('remember')).toBeNull();
  });

  it('parses TITLE/FACT, tolerates think-blocks, rejects NONE and noise', () => {
    expect(parseExtraction('TITLE: Prefers dark mode\nFACT: The user prefers dark mode.')).toEqual({
      title: 'Prefers dark mode',
      contentMd: 'The user prefers dark mode.',
    });
    expect(parseExtraction('<think>hmm</think>\nNONE')).toBeNull();
    expect(parseExtraction('NONE')).toBeNull();
    expect(parseExtraction('The user likes cats, probably.')).toBeNull();
  });
});

describe('maybeAutoWriteMemory', () => {
  it('stores an explicit remember with source agent, deduping on title', async () => {
    const U = 'hook-user-1';
    const first = await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'remember that I deploy on Fridays', answer: 'ok' });
    expect(first!.source).toBe('agent');
    const again = await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'remember that I deploy on Fridays', answer: 'ok' });
    expect(again!.id).toBe(first!.id); // updated, not duplicated
    expect((await listMemories(env.DB, U)).length).toBe(1);
  });

  it('writes nothing for a plain prompt without a provider key', async () => {
    const U = 'hook-user-2';
    expect(env.FEATHERLESS_API_KEY).toBeUndefined(); // precondition for this path
    const saved = await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'summarize the weekly report', answer: 'summary…' });
    expect(saved).toBeNull();
    expect(await listMemories(env.DB, U)).toEqual([]);
  });
});

describe('runPipeline — memory wiring', () => {
  it('emits memory_saved before run_end on an explicit remember run', async () => {
    const U = 'hook-run-user-1';
    const events = await run(U, 'remember that I prefer short answers');
    const saved = events.find((e) => e.t === 'memory_saved') as Extract<TraceEvent, { t: 'memory_saved' }>;
    expect(saved).toBeDefined();
    expect(saved.title).toBe('I prefer short answers');
    expect(kinds(events).indexOf('memory_saved')).toBeLessThan(kinds(events).indexOf('run_end'));
    const rows = await listMemories(env.DB, U);
    expect(rows.length).toBe(1);
    expect(rows[0]!.source).toBe('agent');
  });

  it('never auto-writes on a cache-hit replay, and replays carry no memory_saved', async () => {
    const U = 'hook-run-user-2';
    const text = 'summarize the incident report';
    await run(U, text); // seed the run cache; no memory involved
    expect(await listMemories(env.DB, U)).toEqual([]);
    const replay = await run(U, text);
    expect(kinds(replay)).toContain('cache_hit');
    expect(kinds(replay)).not.toContain('memory_saved');
    expect(await listMemories(env.DB, U)).toEqual([]); // still nothing written
  });

  it('a stable memory set replays from cache without re-announcing the save', async () => {
    const U = 'hook-run-user-3';
    const text = 'remember that I prefer tabs over spaces';
    await run(U, text); // run 1: writes the memory AFTER its own cache key was computed
    const second = await run(U, text); // run 2: memory now in the input → new key → miss, dedup update
    expect(kinds(second)).not.toContain('cache_hit');
    const third = await run(U, text); // run 3: memory set unchanged → key matches run 2 → replay
    expect(kinds(third)).toContain('cache_hit');
    expect(kinds(third)).not.toContain('memory_saved');
    expect((await listMemories(env.DB, U)).length).toBe(1);
  });

  it('injected memory context is part of the run-cache key (injection is real)', async () => {
    const U = 'hook-run-user-4';
    const text = 'draft the release notes'; // no "remember" — no auto-writes
    const m = await createMemory(env.DB, { userId: U, title: 'Tone', contentMd: 'Keep release notes terse.', source: 'user' });
    await run(U, text);
    expect(kinds(await run(U, text))).toContain('cache_hit'); // stable memories → hit
    await deleteMemory(env.DB, U, m.id);
    // Same prompt, memory gone → the injected block disappears from the model
    // input, so the key changes and the cache misses: proof the block was in.
    expect(kinds(await run(U, text))).not.toContain('cache_hit');
  });
});
