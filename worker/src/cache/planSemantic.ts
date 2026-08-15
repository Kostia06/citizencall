// L3 plan cache — semantic near-match tier (SPEC.md §8 "semantic L3" future
// work). The exact-match lookup in cache/plan.ts stays the untouched fast
// path; this module only runs on an exact MISS, scanning a bounded window of
// recent plan-cache rows with lexical-semantic similarity (cache/planSimilarity.ts).
//
// Scoping: the plan cache is GLOBAL / cross-user by design — plans contain no
// user data and no tool output. assertPlanIsGlobal keeps that true at the
// write boundary (mirror image of runResult.ts's assertScoped, which enforces
// the opposite rule for the per-user run cache).
//
// Schema: lazily extends the existing plan_cache table (same pattern as
// ensureRunCacheSchema in cache/schema.ts) with
//   tokens        TEXT — space-joined contentTokens(normalized), computed once
//                        at write time so a scan never re-normalizes per row
//   borrowed_from TEXT — provenance: set when this row was minted by promoting
//                        a semantic near-match of another row's plan
// ALTER TABLE ADD COLUMN is not IF-NOT-EXISTS in SQLite, so the duplicate-
// column error is swallowed to keep the ensure idempotent.
import type { Plan } from '../types';
import { contentTokens, isNearMatch, planSimilarity, toolkitGateAllows, type PlanSimilarity } from './planSimilarity';

// Bounded candidate scan: only the most-recent rows, via the created_at index,
// so a large cache can never make decompose slow.
export const PLAN_SCAN_LIMIT = 200;
// plan.ts documents a 7d TTL for the plan cache; make it real here: the
// near-match scan ignores older rows, and every write prunes them best-effort.
export const PLAN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// One-token prompts ("summarize") are too generic to near-match safely.
const MIN_CONTENT_TOKENS = 2;

const SCHEMA_STATEMENTS = [
  // Same shape as worker/schema.sql — lazy provisioning so tests and cold
  // environments work without extra wiring (see cache/schema.ts).
  `CREATE TABLE IF NOT EXISTS plan_cache(normalized TEXT PRIMARY KEY, plan_json TEXT, created_at INTEGER, hits INTEGER DEFAULT 0)`,
  `ALTER TABLE plan_cache ADD COLUMN tokens TEXT`,
  `ALTER TABLE plan_cache ADD COLUMN borrowed_from TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_plan_cache_created ON plan_cache(created_at)`,
];

export async function applyPlanSemanticSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await db.prepare(stmt).run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column/i.test(message)) throw err;
    }
  }
}

// One ensure per D1 binding per isolate (same pattern as ensureRunCacheSchema).
const ensured = new WeakSet<D1Database>();

export async function ensurePlanSemanticSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  await applyPlanSemanticSchema(db);
  ensured.add(db);
}

// The WeakSet memo can outlive the storage it ensured (vitest-pool-workers
// resets D1 per test file while module state survives; a future prod reset
// would behave the same). Any "no such column/table" from a plan_cache query
// re-applies the schema once and retries — never fails a run on a memo miss.
async function withSchemaRetry<T>(db: D1Database, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/no such (column|table)/i.test(message)) throw err;
    await applyPlanSemanticSchema(db);
    return await op();
  }
}

/**
 * SPEC.md §8: the plan cache is global, so a plan must never smuggle in
 * user-scoped data. Plans are pure task structure (kinds, instructions,
 * toolkit names); refuse to store anything carrying identity/credential keys.
 */
export function assertPlanIsGlobal(plan: Plan): void {
  const forbidden = /^(userid|user_id|email|token|accesstoken|access_token|authorization|apikey|api_key|secret)$/i;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.test(key)) {
          throw new Error(`plan cache is global (SPEC.md §8): refusing to store plan with user-scoped field "${key}"`);
        }
        walk(child);
      }
    }
  };
  walk(plan);
}

/**
 * Write a plan under its normalized key, with the precomputed token text the
 * near-match scan needs and (for promoted near-matches) provenance of the key
 * it borrowed from. Also prunes expired rows, best-effort.
 */
export async function putPlanIndexed(
  db: D1Database,
  normalizedKey: string,
  plan: Plan,
  borrowedFrom: string | null = null
): Promise<void> {
  assertPlanIsGlobal(plan);
  await ensurePlanSemanticSchema(db);
  const now = Date.now();
  await withSchemaRetry(db, () =>
    db
      .prepare(
        `INSERT INTO plan_cache (normalized, plan_json, tokens, borrowed_from, created_at, hits)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(normalized) DO UPDATE SET
           plan_json = excluded.plan_json, tokens = excluded.tokens,
           borrowed_from = excluded.borrowed_from, created_at = excluded.created_at`
      )
      .bind(normalizedKey, JSON.stringify(plan), contentTokens(normalizedKey).join(' '), borrowedFrom, now)
      .run()
  );
  try {
    await db.prepare(`DELETE FROM plan_cache WHERE created_at < ?`).bind(now - PLAN_CACHE_TTL_MS).run();
  } catch {
    // Pruning is housekeeping — it must never fail a plan write.
  }
}

export interface NearPlanHit {
  plan: Plan;
  /** The normalized key of the cached row the plan was borrowed from. */
  matchedKey: string;
  similarity: PlanSimilarity;
}

/**
 * Semantic near-match lookup, called only after an exact miss. Scans the
 * PLAN_SCAN_LIMIT most-recent unexpired rows and returns the best candidate
 * that clears BOTH similarity thresholds AND the toolkit safety gate — or
 * null, because on any doubt the model call is the correct fallback.
 */
export async function findNearPlan(db: D1Database, normalizedKey: string): Promise<NearPlanHit | null> {
  await ensurePlanSemanticSchema(db);
  const promptTokens = contentTokens(normalizedKey);
  if (promptTokens.length < MIN_CONTENT_TOKENS) return null;

  const { results } = await withSchemaRetry(db, () =>
    db
      .prepare(
        `SELECT normalized, plan_json, tokens FROM plan_cache
         WHERE normalized != ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .bind(normalizedKey, Date.now() - PLAN_CACHE_TTL_MS, PLAN_SCAN_LIMIT)
      .all<{ normalized: string; plan_json: string; tokens: string | null }>()
  );

  let best: NearPlanHit | null = null;
  let bestScore = -1;
  for (const row of results ?? []) {
    // Rows written before the tokens column existed fall back to tokenizing
    // their key inline — correctness over speed for legacy rows only.
    const candidateTokens = row.tokens ? row.tokens.split(' ') : contentTokens(row.normalized);
    const similarity = planSimilarity(promptTokens, candidateTokens);
    if (!isNearMatch(similarity)) continue;

    let plan: Plan;
    try {
      plan = JSON.parse(row.plan_json) as Plan;
    } catch {
      continue; // a corrupt row must never surface as a hit
    }
    if (!Array.isArray(plan?.subTasks) || plan.subTasks.length === 0) continue;
    if (!toolkitGateAllows(normalizedKey, promptTokens, plan)) continue;

    const score = similarity.jaccard + similarity.trigram;
    if (score > bestScore) {
      bestScore = score;
      best = { plan, matchedKey: row.normalized, similarity };
    }
  }

  if (best) {
    // Count the borrow on the donor row, same as an exact hit would.
    await db.prepare(`UPDATE plan_cache SET hits = hits + 1 WHERE normalized = ?`).bind(best.matchedKey).run();
  }
  return best;
}
