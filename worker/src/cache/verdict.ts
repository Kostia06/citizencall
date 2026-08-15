// L4 verdict cache (SPEC.md §8): (modelId, taskKind) -> rolling failure rate.
// Not a cache of outputs — a running verifier signal the router can use to
// down-weight models that keep failing verify() in production.
import { getVerifierFailureRate, recordVerifierAttempt } from '../db';
import type { TaskKind, Verdict } from '../types';

export async function recordVerdict(
  db: D1Database,
  modelId: string,
  kind: TaskKind,
  verdict: Verdict
): Promise<void> {
  await recordVerifierAttempt(db, modelId, kind, verdict !== 'pass');
}

// null = no data yet (never attempted) — callers should treat that as neutral,
// not as zero failure rate.
export async function failureRate(db: D1Database, modelId: string, kind: TaskKind): Promise<number | null> {
  return getVerifierFailureRate(db, modelId, kind);
}
