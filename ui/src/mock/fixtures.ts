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
    understudy: { label: 'Understudy router', accuracy: 0.92, costPer1k: 0.41 },
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
