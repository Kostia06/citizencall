// L2 tool cache (SPEC.md §8): sha256(userId ∥ toolkit ∥ tool ∥ canonicalJson(args)).
// PER USER, ALWAYS. Tool output (and any model output derived from it) may only
// be cached under a tier keyed with user_id — this is the scoping rule from §8,
// enforced here by making userId a required, non-empty argument.
import { getCacheEntry, putCacheEntry } from '../db';
import { canonicalJson, sha256Hex } from '../hash';

const TIER = 'tool';

// TTLs per SPEC.md §8. Anything not listed falls back to a conservative 60s.
const TOOL_TTL_MS: Record<string, number> = {
  'gmail.*': 120_000,
  'github.list_commits': 600_000,
  'github.get_pull_request': 300_000,
};

function ttlForTool(toolkit: string, tool: string): number {
  const wildcard = `${toolkit}.*`;
  const exact = `${toolkit}.${tool}`;
  return TOOL_TTL_MS[exact] ?? TOOL_TTL_MS[wildcard] ?? 60_000;
}

export interface ToolCacheParams {
  userId: string;
  toolkit: string;
  tool: string;
  args: Record<string, unknown>;
}

function assertScoped(userId: string): void {
  if (!userId) {
    // No tier keyed without user_id may store tool output — fail loudly rather
    // than silently caching cross-user (SPEC.md §8 scoping rule).
    throw new Error('L2 tool cache requires a non-empty userId (cache scoping rule)');
  }
}

export async function toolCacheKey(p: ToolCacheParams): Promise<string> {
  assertScoped(p.userId);
  return sha256Hex(`${p.userId}∣${p.toolkit}∣${p.tool}∣${canonicalJson(p.args)}`);
}

export async function getTool<T>(db: D1Database, p: ToolCacheParams): Promise<T | null> {
  assertScoped(p.userId);
  const key = await toolCacheKey(p);
  const entry = await getCacheEntry(db, key);
  if (!entry) return null;
  // Defense in depth: even if a row were somehow written without user_id, never
  // serve it back as a hit for a specific user.
  if (entry.userId !== p.userId) return null;
  return JSON.parse(entry.valueJson) as T;
}

export async function putTool<T>(db: D1Database, p: ToolCacheParams, value: T): Promise<void> {
  assertScoped(p.userId);
  const key = await toolCacheKey(p);
  const now = Date.now();
  await putCacheEntry(db, {
    cacheKey: key,
    tier: TIER,
    userId: p.userId,
    valueJson: JSON.stringify(value),
    createdAt: now,
    expiresAt: now + ttlForTool(p.toolkit, p.tool),
  });
}
