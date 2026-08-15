// Stage 5 — trace. Small pure helpers for turning accumulated hops into the
// run_end summary event; persistence itself lives in db.ts.
import type { Hop, TraceEvent } from '../types';

export function sumCost(hops: Hop[]): number {
  return hops.reduce((sum, h) => sum + h.costUsd, 0);
}

export function buildRunEndEvent(
  runId: string,
  hops: Hop[],
  totalMs: number,
  baselineCostUsd: number
): TraceEvent {
  const totalCostUsd = sumCost(hops);
  const savingsPct = baselineCostUsd > 0 ? ((baselineCostUsd - totalCostUsd) / baselineCostUsd) * 100 : 0;
  return { t: 'run_end', runId, totalCostUsd, totalMs, baselineCostUsd, savingsPct };
}
