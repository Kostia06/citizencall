// reporting.ts — roster/benchmark aggregations against seeded D1 rows.
// NOTE: these aggregates are deliberately GLOBAL (all users, one demo D1) —
// acceptable for the hackathon dashboard, documented in reporting.ts.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBenchmarkReport, buildRosterReport } from '../src/reporting';
import { policy } from '../src/policy';
import { applyCoreSchema } from './support/schema';

beforeAll(async () => {
  await applyCoreSchema(env.DB);
});

const RUNG0_CLASSIFY = policy.ladders.classify[0]!;
const RUNG1 = policy.baselines.frontier;

async function seed() {
  const runs = [
    // id, created, status, cost, baseline, ms
    ['run-1', 1000, 'done', 0.002, 0.02, 1200],
    ['run-2', 2000, 'done', 0.004, 0.02, 2000],
    ['run-3', 3000, 'error', 0, 0, 0],
  ] as const;
  for (const [id, created, status, cost, baseline, ms] of runs) {
    await env.DB.prepare(
      `INSERT INTO runs (id, user_id, request_text, source, created_at, status,
        total_cost_usd, baseline_cost_usd, total_ms, cache_hits, plan_cache_hit)
       VALUES (?, 'demo_kos', ?, 'text', ?, ?, ?, ?, ?, 0, 0)`
    )
      .bind(id, `prompt for ${id}`, created, status, cost, baseline, ms)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO sub_tasks (id, run_id, idx, kind, ctx_needed, needs_tools, sensitive, payload_json)
     VALUES ('st-1', 'run-1', 0, 'classify', 2000, 0, 0, '{}'),
            ('st-2', 'run-2', 0, 'summarize', 2000, 0, 0, '{}')`
  ).run();
  const hops = [
    // id, run, st, model, verdict, cache, cost, ms, ptoks, ctoks
    ['h-1', 'run-1', 'st-1', RUNG0_CLASSIFY, 'pass', 'none', 0.001, 400, 1000, 100],
    ['h-2', 'run-1', 'st-1', RUNG1, 'pass', 'none', 0.01, 900, 2000, 200],
    ['h-3', 'run-2', 'st-2', RUNG0_CLASSIFY, 'pass', 'exact', 0, 5, 0, 0],
  ] as const;
  for (const [id, run, st, model, verdict, cache, cost, ms, ptoks, ctoks] of hops) {
    await env.DB.prepare(
      `INSERT INTO hops (id, run_id, sub_task_id, model_id, model_class, params_b,
        prompt_tokens, completion_tokens, cost_usd, latency_ms, availability, verdict,
        escalated_from, cache_hit, created_at)
       VALUES (?, ?, ?, ?, 'test', 1, ?, ?, ?, ?, 'warm', ?, NULL, ?, 0)`
    )
      .bind(id, run, st, model, ptoks, ctoks, cost, ms, verdict, cache)
      .run();
  }
}

describe('buildRosterReport / buildBenchmarkReport', () => {
  it('returns the full ladder with zeroed stats on an empty database, then live aggregates once runs exist', async () => {
    // ---- empty state: full ladder still renders, stats are zeros ----
    const empty = await buildRosterReport(env.DB);
    expect(empty.policyVersion).toBe(policy.version);
    expect(empty.kinds.map((k) => k.kind).sort()).toEqual([
      'classify',
      'extract_fields',
      'normalize',
      'summarize',
    ]);
    for (const kind of empty.kinds) {
      expect(kind.models[0]!.role).toBe('rung0');
      expect(kind.models[1]!.role).toBe('rung1');
      // v3 policy wires live-probed alternates for every kind.
      expect(kind.models.filter((m) => m.role === 'alternate').length).toBeGreaterThan(0);
      for (const m of kind.models) {
        expect(m.pricePerMTokOut, `${m.modelId} price`).toBeGreaterThan(0);
        expect(m.servable, `${m.modelId} servable`).toBe(true);
        expect(m.stats.runs).toBe(0);
        expect(m.stats.passRate).toBeNull();
      }
    }

    const emptyBench = await buildBenchmarkReport(env.DB);
    expect(emptyBench.totals.runs).toBe(0);
    expect(emptyBench.totals.totalCostUsd).toBe(0);
    expect(emptyBench.recentRuns).toHaveLength(0);
    expect(emptyBench.perKind).toHaveLength(0);

    // ---- seeded: aggregates reflect the rows ----
    await seed();

    const roster = await buildRosterReport(env.DB);
    const classify = roster.kinds.find((k) => k.kind === 'classify')!;
    const rung0 = classify.models.find((m) => m.role === 'rung0')!;
    expect(rung0.modelId).toBe(RUNG0_CLASSIFY);
    expect(rung0.stats.runs).toBe(2); // run-1 (miss) + run-2 (cache hit hop)
    expect(rung0.stats.hops).toBe(2);
    expect(rung0.stats.passRate).toBe(1);
    expect(rung0.stats.totalCostUsd).toBeCloseTo(0.001, 6);
    const rung1 = classify.models.find((m) => m.role === 'rung1')!;
    expect(rung1.modelId).toBe(RUNG1);
    expect(rung1.stats.hops).toBe(1);

    const bench = await buildBenchmarkReport(env.DB);
    expect(bench.totals.runs).toBe(2); // errored run excluded
    expect(bench.totals.totalCostUsd).toBeCloseTo(0.006, 6);
    expect(bench.totals.baselineCostUsd).toBeCloseTo(0.04, 6);
    expect(bench.totals.savingsPct).toBeCloseTo(85, 1);
    expect(bench.totals.avgLatencyMs).toBe(1600);
    expect(bench.totals.p50LatencyMs).toBe(1200);
    expect(bench.totals.p95LatencyMs).toBe(2000);
    expect(bench.totals.cacheHitRate).toBeCloseTo(1 / 3, 4);

    // bars: frontier baseline (measured), cheap-default (repriced tokens), understudy (measured)
    const barByKey = new Map(bench.bars.map((b) => [b.key, b]));
    expect(barByKey.get('frontier_baseline')!.costUsd).toBeCloseTo(0.04, 6);
    expect(barByKey.get('understudy')!.costUsd).toBeCloseTo(0.006, 6);
    // 3000 prompt + 300 completion tokens at the cheap-default's catalog price.
    expect(barByKey.get('cheap_default')!.costUsd).toBeCloseTo((3000 * 0.4 + 300 * 0.8) / 1e6, 8);

    const perKind = new Map(bench.perKind.map((k) => [k.kind, k]));
    expect(perKind.get('classify')!.hops).toBe(2);
    expect(perKind.get('classify')!.passRate).toBe(1);
    expect(perKind.get('summarize')!.hops).toBe(1);
    expect(perKind.get('summarize')!.topModel).toBe(RUNG0_CLASSIFY);

    // recent runs: newest first, errored run included with 0 savings
    expect(bench.recentRuns.map((r) => r.id)).toEqual(['run-3', 'run-2', 'run-1']);
    const run1 = bench.recentRuns.find((r) => r.id === 'run-1')!;
    expect(run1.promptSnippet).toBe('prompt for run-1');
    expect(run1.models.sort()).toEqual([RUNG0_CLASSIFY, RUNG1].sort());
    expect(run1.savedPct).toBeCloseTo(90, 1);
  });
});
