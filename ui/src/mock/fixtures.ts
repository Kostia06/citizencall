import type { BenchmarkResult, RosterEntry } from '../types';

// Mirrors artifacts/*.example.json shapes so mock mode and a real backend
// render identically. See SPEC.md §13 (GET /api/roster, /api/benchmark).

const now = Date.now();

export const mockRoster: RosterEntry[] = [
  {
    taskKind: 'extract_fields',
    modelId: 'Qwen/Qwen3-14B',
    modelClass: 'qwen3',
    promotedAt: now - 86_400_000,
    accuracy: 0.91,
    ciLo: 0.62,
    ciHi: 0.98,
    costPer1k: 0.34,
    displacedModelId: 'zai-org/GLM-5.2',
    hfDownloads: 340,
  },
  {
    taskKind: 'classify',
    modelId: 'Qwen/Qwen3-8B',
    modelClass: 'qwen3',
    promotedAt: now - 86_400_000 * 2,
    accuracy: 0.88,
    ciLo: 0.62,
    ciHi: 0.98,
    costPer1k: 0.61,
    displacedModelId: 'zai-org/GLM-5.2',
    hfDownloads: 1240,
  },
  {
    taskKind: 'summarize',
    modelId: 'Qwen/Qwen3-8B',
    modelClass: 'qwen3',
    promotedAt: now - 3_600_000 * 5,
    accuracy: 0.83,
    ciLo: 0.55,
    ciHi: 0.95,
    costPer1k: 0.61,
    displacedModelId: 'zai-org/GLM-5.2',
    hfDownloads: 1240,
  },
];

export const mockBenchmark: BenchmarkResult = {
  generatedAt: new Date(now).toISOString(),
  baselines: {
    glm_only: { label: 'GLM-5.2 everything', accuracy: 0.93, costPer1k: 4.21 },
    glm_verify: { label: 'GLM-5.2 + verify/escalate', accuracy: 0.95, costPer1k: 4.55 },
    cheap_default: { label: 'Qwen3-4B everything', accuracy: 0.79, costPer1k: 0.88 },
    understudy: { label: 'CitizenCall router', accuracy: 0.92, costPer1k: 0.41 },
  },
  perKind: [
    {
      kind: 'extract_fields',
      promoted: 'Qwen/Qwen3-14B',
      accuracy: 0.91,
      ci: [0.62, 0.98],
      validity: 0.97,
      incumbent: 'zai-org/GLM-5.2',
      incumbentAccuracy: 0.95,
      heldInAccuracy: 0.96,
      heldOutAccuracy: 0.91,
      costEffectiveRatio: 0.19,
      n: 12,
    },
    {
      kind: 'classify',
      promoted: 'Qwen/Qwen3-8B',
      accuracy: 0.88,
      ci: [0.62, 0.98],
      validity: 0.99,
      incumbent: 'zai-org/GLM-5.2',
      incumbentAccuracy: 0.94,
      heldInAccuracy: 0.9,
      heldOutAccuracy: 0.88,
      costEffectiveRatio: 0.15,
      n: 12,
    },
    {
      kind: 'summarize',
      promoted: 'Qwen/Qwen3-8B',
      accuracy: 0.83,
      ci: [0.55, 0.95],
      validity: 0.95,
      incumbent: 'zai-org/GLM-5.2',
      incumbentAccuracy: 0.9,
      heldInAccuracy: 0.86,
      heldOutAccuracy: 0.83,
      costEffectiveRatio: 0.21,
      n: 12,
    },
  ],
  note: 'MOCK fixture — real numbers produced by harness/stats.py from sweep-log.jsonl.',
};

// ---- v3 report shapes (worker/src/reporting.ts) — served by the live
// /api/roster and /api/benchmark since the reporting rebuild. The legacy
// mockRoster/mockBenchmark above are kept for older call sites. ----

import type { BenchmarkReport, RosterReport } from '../api';

const mockStats = (runs: number, hops: number, passRate: number | null, cost: number, ms: number | null) => ({
  runs,
  hops,
  passRate,
  totalCostUsd: cost,
  avgLatencyMs: ms,
});

export const mockRosterReport: RosterReport = {
  policyVersion: 'v3-live-widened (mock)',
  verifiedAt: '2026-08-15',
  generatedAt: new Date(now).toISOString(),
  kinds: [
    {
      kind: 'classify',
      models: [
        { role: 'rung0', modelId: 'Qwen/Qwen2.5-0.5B-Instruct', modelClass: 'Qwen2.5', paramsB: 0.5, contextLength: 32768, pricePerMTokIn: 0.04, pricePerMTokOut: 0.08, hfDownloads: 1100000, servable: true, stats: mockStats(6, 7, 1, 0.0004, 420) },
        { role: 'rung1', modelId: 'zai-org/GLM-5.2', modelClass: 'glm52-753b', paramsB: 753, contextLength: 262144, pricePerMTokIn: 0.75, pricePerMTokOut: 2.4, hfDownloads: 2100000, servable: true, stats: mockStats(2, 2, 1, 0.012, 1900) },
        { role: 'alternate', modelId: 'Qwen/Qwen2.5-7B-Instruct', modelClass: 'qwen25-7b', paramsB: 7, contextLength: 32768, pricePerMTokIn: 0.17, pricePerMTokOut: 0.2, hfDownloads: 12315563, servable: true, stats: mockStats(0, 0, null, 0, null) },
      ],
    },
    {
      kind: 'extract_fields',
      models: [
        { role: 'rung0', modelId: 'Qwen/Qwen2.5-1.5B-Instruct', modelClass: 'Qwen2.5', paramsB: 1.5, contextLength: 32768, pricePerMTokIn: 0.04, pricePerMTokOut: 0.08, hfDownloads: 940000, servable: true, stats: mockStats(4, 5, 0.8, 0.0007, 510) },
        { role: 'rung1', modelId: 'zai-org/GLM-5.2', modelClass: 'glm52-753b', paramsB: 753, contextLength: 262144, pricePerMTokIn: 0.75, pricePerMTokOut: 2.4, hfDownloads: 2100000, servable: true, stats: mockStats(1, 1, 1, 0.008, 2100) },
        { role: 'alternate', modelId: 'microsoft/phi-4', modelClass: 'phi4-14b', paramsB: 14, contextLength: 32768, pricePerMTokIn: 0.07, pricePerMTokOut: 0.14, hfDownloads: 690115, servable: true, stats: mockStats(0, 0, null, 0, null) },
      ],
    },
    {
      kind: 'summarize',
      models: [
        { role: 'rung0', modelId: 'Qwen/Qwen2.5-1.5B-Instruct', modelClass: 'Qwen2.5', paramsB: 1.5, contextLength: 32768, pricePerMTokIn: 0.04, pricePerMTokOut: 0.08, hfDownloads: 940000, servable: true, stats: mockStats(3, 3, 1, 0.0005, 640) },
        { role: 'rung1', modelId: 'zai-org/GLM-5.2', modelClass: 'glm52-753b', paramsB: 753, contextLength: 262144, pricePerMTokIn: 0.75, pricePerMTokOut: 2.4, hfDownloads: 2100000, servable: true, stats: mockStats(1, 1, 1, 0.009, 2400) },
        { role: 'alternate', modelId: 'mistralai/Mistral-Nemo-Instruct-2407', modelClass: 'mistral-nemo', paramsB: 12, contextLength: 32768, pricePerMTokIn: 0.25, pricePerMTokOut: 0.4, hfDownloads: 408094, servable: true, stats: mockStats(0, 0, null, 0, null) },
      ],
    },
    {
      kind: 'normalize',
      models: [
        { role: 'rung0', modelId: 'Qwen/Qwen2.5-0.5B-Instruct', modelClass: 'Qwen2.5', paramsB: 0.5, contextLength: 32768, pricePerMTokIn: 0.04, pricePerMTokOut: 0.08, hfDownloads: 1100000, servable: true, stats: mockStats(2, 2, 1, 0.0001, 380) },
        { role: 'rung1', modelId: 'zai-org/GLM-5.2', modelClass: 'glm52-753b', paramsB: 753, contextLength: 262144, pricePerMTokIn: 0.75, pricePerMTokOut: 2.4, hfDownloads: 2100000, servable: true, stats: mockStats(0, 0, null, 0, null) },
        { role: 'alternate', modelId: 'Qwen/Qwen2.5-3B-Instruct', modelClass: 'qwen25-3b', paramsB: 3, contextLength: 32768, pricePerMTokIn: 0.32, pricePerMTokOut: 1.6, hfDownloads: 6811632, servable: true, stats: mockStats(0, 0, null, 0, null) },
      ],
    },
  ],
};

export const mockBenchmarkReport: BenchmarkReport = {
  generatedAt: new Date(now).toISOString(),
  source: 'live',
  policyVersion: 'v3-live-widened (mock)',
  totals: {
    runs: 9,
    totalCostUsd: 0.0214,
    baselineCostUsd: 0.1618,
    savingsPct: 86.8,
    cacheHitRate: 0.33,
    avgLatencyMs: 2140,
    p50LatencyMs: 1820,
    p95LatencyMs: 4650,
  },
  bars: [
    { key: 'frontier_baseline', label: 'GLM-5.2 everything', costUsd: 0.1618, note: 'measured baseline per run' },
    { key: 'cheap_default', label: 'Qwen3-4B everything', costUsd: 0.0388, note: 'same tokens repriced — estimate' },
    { key: 'understudy', label: 'CitizenCall router', costUsd: 0.0214, note: 'measured' },
  ],
  perKind: [
    { kind: 'classify', hops: 8, passRate: 1, costUsd: 0.0009, avgLatencyMs: 430, topModel: 'Qwen/Qwen2.5-0.5B-Instruct' },
    { kind: 'extract_fields', hops: 6, passRate: 0.83, costUsd: 0.0092, avgLatencyMs: 780, topModel: 'Qwen/Qwen2.5-1.5B-Instruct' },
    { kind: 'summarize', hops: 5, passRate: 1, costUsd: 0.0113, avgLatencyMs: 950, topModel: 'Qwen/Qwen2.5-1.5B-Instruct' },
  ],
  recentRuns: [
    { id: 'mock-run-3', promptSnippet: 'Summarize my latest github commits and draft a standup note', models: ['Qwen/Qwen2.5-1.5B-Instruct'], costUsd: 0.0041, baselineCostUsd: 0.031, savedPct: 86.8, status: 'done', createdAt: now - 240_000, totalMs: 4210 },
    { id: 'mock-run-2', promptSnippet: 'Classify these support emails by urgency', models: ['Qwen/Qwen2.5-0.5B-Instruct'], costUsd: 0.0002, baselineCostUsd: 0.008, savedPct: 97.5, status: 'done', createdAt: now - 1_500_000, totalMs: 1650 },
    { id: 'mock-run-1', promptSnippet: 'Extract the invoice fields from this PDF text', models: ['Qwen/Qwen2.5-1.5B-Instruct', 'zai-org/GLM-5.2'], costUsd: 0.0171, baselineCostUsd: 0.041, savedPct: 58.3, status: 'done', createdAt: now - 3_900_000, totalMs: 5120 },
  ],
  note: 'MOCK fixture — live numbers come from the runs/hops D1 tables via worker/src/reporting.ts.',
};

export const mockFunnel = {
  stages: [
    { label: 'models catalogued', count: 45190 },
    { label: 'tool-use-capable', count: 34504 },
    { label: 'passed metadata prefilter', count: 612 },
    { label: 'retrieved (8 × 3 kinds)', count: 24 },
    { label: 'reachable at sweep time', count: 14 },
    { label: 'survived round 1', count: 12 },
    { label: 'promoted', count: 3 },
  ],
};
