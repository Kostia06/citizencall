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
import { extractExplicitRemember, extractRetraction, isQuestionOnly, maybeAutoWriteMemory } from '../../src/pipeline/memory-hook';
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

describe('extractExplicitRemember', () => {
  it('lifts the fact out of a "remember that …" prompt with a clean subject title', () => {
    const f = extractExplicitRemember('Please remember that I prefer short answers.');
    expect(f!.contentMd).toBe('I prefer short answers.');
    expect(f!.title).toBe('Preference: short answers');
  });

  it('normalizes identity statements under canonical titles', () => {
    const agent = extractExplicitRemember('your name is jeff');
    expect(agent!.title).toBe("Agent's name");
    expect(agent!.contentMd).toBe('The agent should be called Jeff.');
    const user = extractExplicitRemember('call me ann, please summarize this');
    expect(user!.title).toBe("User's name");
    expect(user!.contentMd).toBe("User's name is Ann.");
  });

  it('returns null when there is nothing to remember', () => {
    expect(extractExplicitRemember('summarize the standup notes')).toBeNull();
    expect(extractExplicitRemember('remember')).toBeNull();
  });
});

describe('extractRetraction', () => {
  it('maps "forget my/your name" to the canonical titles', () => {
    expect(extractRetraction('forget my name')).toEqual({ title: "User's name" });
    expect(extractRetraction('please forget your name now')).toEqual({ title: "Agent's name" });
  });

  it('pure questions never reach extraction (mis-attribution guard, found live)', () => {
    expect(isQuestionOnly("what's your name?")).toBe(true);
    expect(isQuestionOnly('how do I deploy this?  ')).toBe(true);
    expect(isQuestionOnly('my name is Ann, what can you do?')).toBe(false); // carries a fact
    expect(isQuestionOnly('summarize the report')).toBe(false); // not a question
  });

  it('keeps a free-form topic and ignores non-retractions', () => {
    expect(extractRetraction('forget about my coffee preference')).toEqual({ topic: 'my coffee preference' });
    expect(extractRetraction("don't forget I like tea")).toBeNull(); // a remember, not a retraction
    expect(extractRetraction('summarize the report')).toBeNull();
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

  it('updates the same subject instead of duplicating: Jeff → Bob is one memory', async () => {
    const U = 'hook-user-name';
    const jeff = await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'your name is jeff', answer: 'ok' });
    expect(jeff!.title).toBe("Agent's name");
    expect(jeff!.contentMd).toBe('The agent should be called Jeff.');
    const bob = await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'actually, call yourself Bob from now on', answer: 'ok' });
    expect(bob!.id).toBe(jeff!.id); // UPDATE, never a second row
    expect(bob!.contentMd).toBe('The agent should be called Bob.');
    expect((await listMemories(env.DB, U)).length).toBe(1);
  });

  it('a retraction deletes the memory: "forget your name"', async () => {
    const U = 'hook-user-forget';
    await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'your name is jeff', answer: 'ok' });
    expect((await listMemories(env.DB, U)).length).toBe(1);
    const saved = await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'forget your name', answer: 'ok' });
    expect(saved).toBeNull(); // deletions announce nothing
    expect(await listMemories(env.DB, U)).toEqual([]);
  });

  it('canonical retraction also catches a mis-titled row about the same subject', async () => {
    const U = 'hook-user-forget-2';
    // A model-written row: right subject, wrong title (found live).
    await createMemory(env.DB, { userId: U, title: "User's name", contentMd: 'The agent should be called Bob.', source: 'agent' });
    await maybeAutoWriteMemory(env, env.DB, { userId: U, prompt: 'forget your name', answer: 'ok' });
    expect(await listMemories(env.DB, U)).toEqual([]);
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
    expect(saved.title).toBe('Preference: short answers');
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
