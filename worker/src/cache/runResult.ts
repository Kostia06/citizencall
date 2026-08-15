// Run-result cache: key = sha256(userId ∥ normalized prompt ∥ policy version).
// PER USER, ALWAYS — a run's trace can embed the user's context prompt and is
// (indirectly) derived from that user's tool output, so by the SPEC.md §8
// scoping rule it may never live in a tier keyed without user_id. Anonymous
// actors are scoped by their anon id exactly the same way.
//
// Value is the full replayable result of a completed run: every trace event
// after run_start (run_start carries the fresh runId and is re-emitted live),
// plus the hops/tool-calls/totals needed to persist the cached run to D1 so
// GET /api/run/:id works identically for a cache-served run.
import type { Hop, TraceEvent } from '../types';
import { sha256Hex } from '../hash';
import { ensureRunCacheSchema } from './schema';

export const RUN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // SPEC default: 24h

export interface RunCacheKeyParams {
  userId: string;
  normalizedText: string;
  policyVersion: string;
}

export interface CachedToolCall {
  subTaskId: string;
  toolkit: string;
  tool: string;
  argsHash: string;
  cacheHit: boolean;
  latencyMs: number;
}

export interface CachedRun {
  events: TraceEvent[]; // everything after run_start, run_end included
  hops: Hop[];
  toolCalls: CachedToolCall[];
  totals: {
    totalCostUsd: number;
    baselineCostUsd: number;
    totalMs: number;
    cacheHits: number;
    planCacheHit: boolean;
  };
  cachedAt: number;
}

function assertScoped(userId: string): void {
  if (!userId) {
    // Never key a run result without its user — fail loudly rather than
    // silently caching cross-user (SPEC.md §8 scoping rule).
    throw new Error('run cache requires a non-empty userId (cache scoping rule)');
  }
}

export async function runCacheKey(p: RunCacheKeyParams): Promise<string> {
  assertScoped(p.userId);
  return sha256Hex(`${p.userId}∣${p.normalizedText}∣${p.policyVersion}`);
}

export async function getRunResult(db: D1Database, p: RunCacheKeyParams): Promise<CachedRun | null> {
  assertScoped(p.userId);
  await ensureRunCacheSchema(db);
  const key = await runCacheKey(p);
  const row = await db
    .prepare(`SELECT user_id, value_json FROM run_cache WHERE cache_key = ? AND expires_at > ?`)
    .bind(key, Date.now())
    .first<{ user_id: string; value_json: string }>();
  if (!row) return null;
  // Defense in depth: the key already embeds userId, but even a corrupted row
  // must never be served across users.
  if (row.user_id !== p.userId) return null;
  await db.prepare(`UPDATE run_cache SET hits = hits + 1 WHERE cache_key = ?`).bind(key).run();
  return JSON.parse(row.value_json) as CachedRun;
}

export async function putRunResult(
  db: D1Database,
  p: RunCacheKeyParams,
  value: Omit<CachedRun, 'cachedAt'>,
  ttlMs: number = RUN_CACHE_TTL_MS
): Promise<void> {
  assertScoped(p.userId);
  await ensureRunCacheSchema(db);
  const key = await runCacheKey(p);
  const now = Date.now();
  const cached: CachedRun = { ...value, cachedAt: now };
  await db
    .prepare(
      `INSERT INTO run_cache (cache_key, user_id, policy_version, value_json, created_at, expires_at, hits)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(cache_key) DO UPDATE SET
         value_json = excluded.value_json, created_at = excluded.created_at, expires_at = excluded.expires_at`
    )
    .bind(key, p.userId, p.policyVersion, JSON.stringify(cached), now, now + ttlMs)
    .run();
}
