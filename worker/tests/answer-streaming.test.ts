// Answer streaming through the pipeline (pipeline/run.ts + execute.ts):
// live runs emit answer_delta chunks for the FINAL sub-task followed by the
// authoritative whole-text `answer`; answer_delta is never written into the
// run-result cache, so a cache-hit replay emits only `answer`.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyStoreSchema } from '../src/db';
import { applyRunCacheSchema } from '../src/cache/schema';
import { runPipeline } from '../src/pipeline/run';
import type { ModelCandidate, Policy, TraceEvent } from '../src/types';
import { applyCoreSchema } from './support/schema';

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyStoreSchema(env.DB);
  await applyRunCacheSchema(env.DB);
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
];

const policy: Policy = {
  version: 'v-stream-test',
  generatedAt: '2026-01-01T00:00:00Z',
  weights: { quality: 1, cost: 0.35 },
  ladders: {
    classify: ['small-summarizer'],
    extract_fields: ['small-summarizer'],
    summarize: ['small-summarizer'],
    normalize: ['small-summarizer'],
  },
  quality: { 'small-summarizer': { summarize: 0.9, extract_fields: 0.9, classify: 0.9, normalize: 0.9 } },
  qualityCI: {},
  baselines: { frontier: 'small-summarizer', cheapDefault: 'small-summarizer' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

async function run(userId: string, text: string): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  await runPipeline(env, (e) => events.push(e), { runId: crypto.randomUUID(), userId, text, source: 'text' }, { policy, candidates });
  return events;
}

describe('answer streaming', () => {
  it('emits answer_delta chunks that reassemble into the final answer', async () => {
    const events = await run('stream_user', 'summarize: red pandas are small arboreal mammals');
    const deltas = events.filter((e): e is Extract<TraceEvent, { t: 'answer_delta' }> => e.t === 'answer_delta');
    const answer = events.find((e): e is Extract<TraceEvent, { t: 'answer' }> => e.t === 'answer');
    expect(deltas.length).toBeGreaterThan(0); // stub mode: one synthetic delta
    expect(answer).toBeDefined();
    expect(deltas.map((d) => d.text).join('')).toBe(answer!.text);
    // Deltas only ever belong to the final sub-task — the same one the
    // answer event names.
    expect(new Set(deltas.map((d) => d.subTaskId))).toEqual(new Set([answer!.subTaskId]));
    // Deltas precede the answer on the wire.
    expect(events.findIndex((e) => e.t === 'answer_delta')).toBeLessThan(events.findIndex((e) => e.t === 'answer'));
  });

  it('never records answer_delta into the run cache — replays emit only answer', async () => {
    const prompt = 'summarize: cached replays carry no deltas';
    const kinds = (events: TraceEvent[]): string[] => events.map((e) => e.t);
    const first = await run('stream_user', prompt);
    expect(kinds(first)).toContain('answer_delta');
    expect(kinds(first)).not.toContain('cache_hit');

    const second = await run('stream_user', prompt);
    expect(kinds(second)).toContain('cache_hit'); // served from the run cache
    expect(kinds(second)).not.toContain('answer_delta'); // filtered out of the recording
    expect(kinds(second)).toContain('answer'); // the whole answer still replays
  });
});
