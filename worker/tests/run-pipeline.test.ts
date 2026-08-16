// runPipeline (pipeline/run.ts): run-result caching semantics — hit replays
// the stored trace with a cache_hit event, noCache bypasses lookup but still
// writes through, results are strictly per-user, failed runs are not cached —
// plus the store wiring: contextPrompt prepended server-side.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyStoreSchema } from '../src/db';
import { applyRunCacheSchema } from '../src/cache/schema';
import { runPipeline } from '../src/pipeline/run';
import { putSettings } from '../src/store/settings';
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

async function run(userId: string, text: string, noCache?: boolean): Promise<{ runId: string; events: AnyEvent[] }> {
  const runId = crypto.randomUUID();
  const events: AnyEvent[] = [];
  await runPipeline(
    env,
    (e) => events.push(e as AnyEvent),
    { runId, userId, text, source: 'text', ...(noCache !== undefined ? { noCache } : {}) },
    { policy, candidates }
  );
  return { runId, events };
}

const kinds = (events: AnyEvent[]) => events.map((e) => e.t);

describe('runPipeline — run-result cache', () => {
  it('serves the second identical run from cache: cache_hit + replayed trace, no new model hops', async () => {
    const text = 'summarize the standup notes';
    const first = await run('demo_kos', text);
    expect(kinds(first.events)).not.toContain('cache_hit');
    expect(kinds(first.events)).toContain('run_end');

    const second = await run('demo_kos', text);
    expect(kinds(second.events)).toContain('cache_hit');
    // Replay carries the same shape of trace (plan + hops + run_end)…
    expect(kinds(second.events)).toContain('plan');
    expect(kinds(second.events)).toContain('hop_end');
    // …with run_end rewritten to THIS run's id.
    const runEnd = second.events.find((e) => e.t === 'run_end') as Extract<TraceEvent, { t: 'run_end' }>;
    expect(runEnd.runId).toBe(second.runId);

    // The cached run is persisted: run row finalized at zero spend, hops kept
    // for the audit surface.
    const row = await env.DB.prepare(`SELECT status, total_cost_usd, cache_hits FROM runs WHERE id = ?`)
      .bind(second.runId)
      .first<{ status: string; total_cost_usd: number; cache_hits: number }>();
    expect(row!.status).toBe('done');
    expect(row!.total_cost_usd).toBe(0);
    expect(row!.cache_hits).toBeGreaterThan(0);
    const hops = await env.DB.prepare(`SELECT COUNT(*) AS n FROM hops WHERE run_id = ?`).bind(second.runId).first<{ n: number }>();
    expect(hops!.n).toBeGreaterThan(0);
  });

  it('never serves a cached run across users, anon ids included', async () => {
    const text = 'summarize the incident timeline';
    await run('demo_kos', text);
    const other = await run('anon-4f2a', text);
    expect(kinds(other.events)).not.toContain('cache_hit');
  });

  it('noCache skips the lookup but still writes through', async () => {
    const text = 'summarize the release changelog';
    await run('demo_kos', text); // seed the cache
    const bypass = await run('demo_kos', text, true);
    expect(kinds(bypass.events)).not.toContain('cache_hit'); // lookup skipped

    const after = await run('demo_kos', text);
    expect(kinds(after.events)).toContain('cache_hit'); // bypass still wrote through
  });

  it('does not cache a run whose final hop failed verification', async () => {
    // summarize whose stub echo trips the degenerate-repetition detector (a
    // 5-word shingle repeated 5×) on both rungs, so the run must not be
    // cached. (extract_fields no longer works here: as the FINAL sub-task it
    // answers in prose and the stub echo passes that contract.)
    const text =
      'summarize: buy milk now please today buy milk now please today buy milk now please today buy milk now please today buy milk now please today';
    const first = await run('demo_kos', text);
    const firstEnd = first.events.filter((e) => e.t === 'hop_end');
    expect(firstEnd.length).toBe(2); // primary + one escalation

    const second = await run('demo_kos', text);
    expect(kinds(second.events)).not.toContain('cache_hit');
  });
});

describe('runPipeline — store wiring', () => {
  it('carries the saved contextPrompt as user context, NOT in the planned text', async () => {
    await putSettings(env.DB, 'demo_teammate', { contextPrompt: 'Always answer in French.' }, Date.now());
    const { events } = await run('demo_teammate', 'summarize the weekly report');
    const plan = events.find((e) => e.t === 'plan') as Extract<TraceEvent, { t: 'plan' }>;
    // The context prompt now rides the SYSTEM message of each sub-task call
    // (execute.ts buildMessages) instead of polluting the user text — the
    // plan is built from the user's actual request only.
    expect(plan.plan.subTasks[0]!.instruction).toContain('summarize the weekly report');
    expect(plan.plan.subTasks[0]!.instruction).not.toContain('Always answer in French.');
  });
});
