// L3 plan cache (SPEC.md §8): EXACT match on the normalized request text
// (lowercase, strip punct, collapse whitespace) — not semantic. Global, 7d TTL,
// plan-only: never stores tool or model output derived from tool output.
import { getPlanCacheEntry, putPlanCacheEntry } from '../db';
import type { Plan } from '../types';

export function normalizePlanKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation, keep letters/digits/space
    .trim()
    .replace(/\s+/g, ' ');
}

export async function getPlan(db: D1Database, text: string): Promise<Plan | null> {
  const entry = await getPlanCacheEntry(db, normalizePlanKey(text));
  if (!entry) return null;
  return JSON.parse(entry.planJson) as Plan;
}

export async function putPlan(db: D1Database, text: string, plan: Plan): Promise<void> {
  await putPlanCacheEntry(db, normalizePlanKey(text), plan);
}
