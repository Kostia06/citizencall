// Live roster + benchmark reports for /api/roster and /api/benchmark.
//
// Merges three sources: the boot-loaded policy (per-kind ladders, alternates,
// provenance), the runtime candidate catalog (real per-MTok prices, live-
// verified 2026-08-15 against api.featherless.ai), and aggregate stats from
// the runs/hops D1 tables.
//
// SCOPING NOTE: every aggregate here is GLOBAL — across all users. For the
// hackathon these pages are a demo dashboard for one D1 database, so that is
// acceptable; a multi-tenant deployment would need a user_id dimension.
import type { ModelCandidate, Policy, TaskKind } from './types';
import { candidates, policy } from './policy';

// policy.json carries fields beyond the Policy contract (alternates,
// provenance) — typed here rather than widening worker/src/types.ts.
type PolicyExtras = {
  alternates?: Partial<Record<TaskKind, string[]>>;
  provenance?: { verifiedAt?: string };
};

export interface RosterModelStats {
  runs: number; // distinct runs this model appeared in
  hops: number;
  passRate: number | null; // verify() pass share, null when never used
  totalCostUsd: number;
  avgLatencyMs: number | null;
}

export interface RosterModelEntry {
  role: 'rung0' | 'rung1' | 'alternate';
  modelId: string;
  modelClass: string;
  paramsB: number;
  contextLength: number;
  pricePerMTokIn: number;
  pricePerMTokOut: number;
  hfDownloads: number | null;
  servable: boolean;
  stats: RosterModelStats;
}

export interface RosterReport {
  policyVersion: string;
  verifiedAt: string | null;
  generatedAt: string;
  kinds: Array<{ kind: TaskKind; models: RosterModelEntry[] }>;
}

export interface BenchmarkReport {
  generatedAt: string;
  source: 'live';
  policyVersion: string;
  totals: {
    runs: number;
    totalCostUsd: number;
    baselineCostUsd: number;
    savingsPct: number; // vs frontier baseline
    cacheHitRate: number; // share of hops answered from a cache tier
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  bars: Array<{ key: string; label: string; costUsd: number; note?: string }>;
  perKind: Array<{
    kind: string;
    hops: number;
    passRate: number;
    costUsd: number;
    avgLatencyMs: number;
    topModel: string | null;
  }>;
  recentRuns: Array<{
    id: string;
    promptSnippet: string;
    models: string[];
    costUsd: number;
    baselineCostUsd: number;
    savedPct: number;
    status: string;
    createdAt: number;
    totalMs: number;
  }>;
}

const candidatesById = new Map<string, ModelCandidate>(candidates.map((c) => [c.id, c]));

function isServable(m: ModelCandidate | undefined): boolean {
  return !!m && (m.availability === 'warm' || m.availability === 'loading') && m.availableOnPlan;
}

interface HopAggRow {
  model_id: string;
  runs: number;
  hops: number;
  pass_rate: number;
  total_cost: number;
  avg_ms: number;
}

async function hopStatsByModel(db: D1Database): Promise<Map<string, HopAggRow>> {
  const { results } = await db
    .prepare(
      `SELECT model_id, COUNT(DISTINCT run_id) AS runs, COUNT(*) AS hops,
        AVG(CASE WHEN verdict = 'pass' THEN 1.0 ELSE 0.0 END) AS pass_rate,
        SUM(cost_usd) AS total_cost, AVG(latency_ms) AS avg_ms
       FROM hops GROUP BY model_id`
    )
    .all<HopAggRow>();
  return new Map(results.map((r) => [r.model_id, r]));
}

function toEntry(
  modelId: string,
  role: RosterModelEntry['role'],
  stats: Map<string, HopAggRow>
): RosterModelEntry {
  const m = candidatesById.get(modelId);
  const s = stats.get(modelId);
  return {
    role,
    modelId,
    modelClass: m?.modelClass ?? 'unknown',
    paramsB: m?.paramsB ?? 0,
    contextLength: m?.contextLength ?? 0,
    pricePerMTokIn: m?.pricePerMTokIn ?? 0,
    pricePerMTokOut: m?.pricePerMTokOut ?? 0,
    hfDownloads: m?.hfDownloads ?? null,
    servable: isServable(m),
    stats: {
      runs: s?.runs ?? 0,
      hops: s?.hops ?? 0,
      passRate: s ? s.pass_rate : null,
      totalCostUsd: s?.total_cost ?? 0,
      avgLatencyMs: s ? Math.round(s.avg_ms) : null,
    },
  };
}

export async function buildRosterReport(db: D1Database): Promise<RosterReport> {
  const extras = policy as Policy & PolicyExtras;
  const stats = await hopStatsByModel(db);

  const kinds = (Object.keys(policy.ladders) as TaskKind[]).map((kind) => {
    const ladder = policy.ladders[kind] ?? [];
    const alternates = extras.alternates?.[kind] ?? [];
    const models: RosterModelEntry[] = [];
    if (ladder[0]) models.push(toEntry(ladder[0], 'rung0', stats));
    if (ladder[1]) models.push(toEntry(ladder[1], 'rung1', stats));
    for (const id of alternates) {
      // An alternate that graduated into the ladder shouldn't render twice.
      if (!ladder.includes(id)) models.push(toEntry(id, 'alternate', stats));
    }
    return { kind, models };
  });

  return {
    policyVersion: policy.version,
    verifiedAt: extras.provenance?.verifiedAt ?? null,
    generatedAt: new Date().toISOString(),
    kinds,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

const RECENT_RUNS_LIMIT = 12;

export async function buildBenchmarkReport(db: D1Database): Promise<BenchmarkReport> {
  const totalsRow = await db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(total_cost_usd) AS cost, SUM(baseline_cost_usd) AS baseline
       FROM runs WHERE status = 'done'`
    )
    .first<{ n: number; cost: number | null; baseline: number | null }>();

  const { results: latencyRows } = await db
    .prepare(`SELECT total_ms FROM runs WHERE status = 'done' ORDER BY total_ms ASC`)
    .all<{ total_ms: number }>();
  const latencies = latencyRows.map((r) => r.total_ms);
  const avgLatencyMs =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  const hopTotals = await db
    .prepare(
      `SELECT COUNT(*) AS hops,
        AVG(CASE WHEN cache_hit != 'none' THEN 1.0 ELSE 0.0 END) AS cache_rate,
        SUM(prompt_tokens) AS prompt_toks, SUM(completion_tokens) AS completion_toks
       FROM hops`
    )
    .first<{ hops: number; cache_rate: number | null; prompt_toks: number | null; completion_toks: number | null }>();

  const runs = totalsRow?.n ?? 0;
  const totalCostUsd = totalsRow?.cost ?? 0;
  const baselineCostUsd = totalsRow?.baseline ?? 0;
  const savingsPct = baselineCostUsd > 0 ? (1 - totalCostUsd / baselineCostUsd) * 100 : 0;

  // "Cheap default everything": the same token volume repriced at the policy's
  // cheap-default baseline model (SPEC.md §10 bar 3). An estimate — repriced
  // real tokens, not a re-run — labeled as such in the bar note.
  const cheapDefault = candidatesById.get(policy.baselines.cheapDefault);
  const cheapDefaultCostUsd = cheapDefault
    ? ((hopTotals?.prompt_toks ?? 0) * cheapDefault.pricePerMTokIn +
        (hopTotals?.completion_toks ?? 0) * cheapDefault.pricePerMTokOut) /
      1_000_000
    : 0;

  const { results: perKindRows } = await db
    .prepare(
      `SELECT st.kind AS kind, COUNT(*) AS hops,
        AVG(CASE WHEN h.verdict = 'pass' THEN 1.0 ELSE 0.0 END) AS pass_rate,
        SUM(h.cost_usd) AS cost, AVG(h.latency_ms) AS avg_ms
       FROM hops h JOIN sub_tasks st ON st.id = h.sub_task_id
       GROUP BY st.kind ORDER BY st.kind`
    )
    .all<{ kind: string; hops: number; pass_rate: number; cost: number; avg_ms: number }>();

  const { results: topModelRows } = await db
    .prepare(
      `SELECT st.kind AS kind, h.model_id AS model_id, COUNT(*) AS n
       FROM hops h JOIN sub_tasks st ON st.id = h.sub_task_id
       GROUP BY st.kind, h.model_id ORDER BY st.kind, n DESC`
    )
    .all<{ kind: string; model_id: string; n: number }>();
  const topModelByKind = new Map<string, string>();
  for (const row of topModelRows) {
    if (!topModelByKind.has(row.kind)) topModelByKind.set(row.kind, row.model_id);
  }

  const { results: recentRows } = await db
    .prepare(
      `SELECT r.id, r.request_text, r.total_cost_usd, r.baseline_cost_usd, r.status,
        r.created_at, r.total_ms,
        (SELECT GROUP_CONCAT(DISTINCT h.model_id) FROM hops h WHERE h.run_id = r.id) AS models
       FROM runs r ORDER BY r.created_at DESC LIMIT ${RECENT_RUNS_LIMIT}`
    )
    .all<{
      id: string;
      request_text: string | null;
      total_cost_usd: number;
      baseline_cost_usd: number;
      status: string;
      created_at: number;
      total_ms: number;
      models: string | null;
    }>();

  return {
    generatedAt: new Date().toISOString(),
    source: 'live',
    policyVersion: policy.version,
    totals: {
      runs,
      totalCostUsd,
      baselineCostUsd,
      savingsPct,
      cacheHitRate: hopTotals?.cache_rate ?? 0,
      avgLatencyMs,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
    },
    bars: [
      {
        key: 'frontier_baseline',
        label: `${policy.baselines.frontier.split('/').pop()} everything`,
        costUsd: baselineCostUsd,
        note: 'measured baseline per run',
      },
      {
        key: 'cheap_default',
        label: `${policy.baselines.cheapDefault.split('/').pop()} everything`,
        costUsd: cheapDefaultCostUsd,
        note: 'same tokens repriced — estimate',
      },
      {
        key: 'understudy',
        label: 'CitizenCall router',
        costUsd: totalCostUsd,
        note: 'measured',
      },
    ],
    perKind: perKindRows.map((r) => ({
      kind: r.kind,
      hops: r.hops,
      passRate: r.pass_rate,
      costUsd: r.cost,
      avgLatencyMs: Math.round(r.avg_ms),
      topModel: topModelByKind.get(r.kind) ?? null,
    })),
    recentRuns: recentRows.map((r) => ({
      id: r.id,
      promptSnippet: (r.request_text ?? '').slice(0, 80),
      models: r.models ? r.models.split(',') : [],
      costUsd: r.total_cost_usd,
      baselineCostUsd: r.baseline_cost_usd,
      savedPct:
        r.baseline_cost_usd > 0 ? (1 - r.total_cost_usd / r.baseline_cost_usd) * 100 : 0,
      status: r.status,
      createdAt: r.created_at,
      totalMs: r.total_ms,
    })),
  };
}
