// L1 exact cache (SPEC.md §8): sha256(modelId ∥ prompt ∥ temp ∥ maxTokens ∥ seed).
// Global scope, 24h TTL — safe because it's keyed on request *shape*, not a user,
// and Featherless calls are deterministic at temperature:0/seed:42.
import { getCacheEntry, putCacheEntry } from '../db';
import { sha256Hex } from '../hash';

const TIER = 'exact';
const TTL_MS = 24 * 60 * 60 * 1000;

export interface ExactCacheParams {
  modelId: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  seed: number;
}

export async function exactCacheKey(p: ExactCacheParams): Promise<string> {
  return sha256Hex(`${p.modelId}∣${p.prompt}∣${p.temperature}∣${p.maxTokens}∣${p.seed}`);
}

export async function getExact<T>(db: D1Database, p: ExactCacheParams): Promise<T | null> {
  const key = await exactCacheKey(p);
  const entry = await getCacheEntry(db, key);
  if (!entry) return null;
  return JSON.parse(entry.valueJson) as T;
}

export async function putExact<T>(db: D1Database, p: ExactCacheParams, value: T): Promise<void> {
  const key = await exactCacheKey(p);
  const now = Date.now();
  await putCacheEntry(db, {
    cacheKey: key,
    tier: TIER,
    userId: null, // global — L1 must never carry a user_id (SPEC.md §8 scoping rule)
    valueJson: JSON.stringify(value),
    createdAt: now,
    expiresAt: now + TTL_MS,
  });
}
