// POST /api/suggest — a one-line "what's probably next" nudge for the
// client's command bar. Not part of the routed pipeline (route.ts's
// per-TaskKind ladders): this is a fire-and-forget suggestion, so it always
// reaches for the single cheapest warm/available model on the roster rather
// than scoring candidates against a task kind.
import { callFeatherless } from '../providers/featherless';
import { candidates } from '../policy';
import type { Env } from '../env';
import type { ModelCandidate } from '../types';

// Fixed fallback if the loaded roster (harness/fixtures/catalog_sample.json
// via policy.ts) is ever empty or has nothing warm+on-plan — keeps
// suggestNextAction() from throwing rather than degrading gracefully.
const FALLBACK_MODEL_ID = 'Qwen/Qwen3-0.6B';

const SYSTEM_PROMPT =
  'Given this session so far, suggest the single most likely next action as one short imperative instruction. Reply with ONLY the suggestion, no preamble.';

// Memoized per-isolate: the roster is loaded once at boot and doesn't change
// within a Worker's lifetime, so there's no reason to re-scan `candidates`
// on every /api/suggest call.
let cheapestModelId: string | null = null;

// Exported for tests — the lowest pricePerMTokOut candidate that's actually
// callable right now (warm + on this plan). Sorting by output price rather
// than input price because output tokens are what a tiny, capped-at-40-token
// completion mostly costs.
//
// The isolate-lifetime cache only applies to the default `candidates` roster
// (what production always calls with); an explicit `pool` argument — as
// tests pass — always computes fresh, so tests can probe different rosters
// without fighting a memoized result from an earlier call.
export function cheapestAvailableModel(pool?: ModelCandidate[]): string {
  if (pool === undefined && cheapestModelId) return cheapestModelId;
  const eligible = (pool ?? candidates).filter((m) => m.availability === 'warm' && m.availableOnPlan);
  const cheapest = [...eligible].sort((a, b) => a.pricePerMTokOut - b.pricePerMTokOut)[0];
  const resolved = cheapest?.id ?? FALLBACK_MODEL_ID;
  if (pool === undefined) cheapestModelId = resolved;
  return resolved;
}

// Canned, still-useful suggestion for dev/test with no FEATHERLESS_API_KEY —
// short-circuits before callFeatherless entirely (rather than relying on its
// generic `[stub:model] ...` echo) so the response reads like an actual
// imperative suggestion instead of a debug artifact.
function stubSuggestion(context: string[]): string {
  const last = context[context.length - 1]?.trim();
  if (!last) return 'Describe what you want to do next.';
  return `Continue from: "${last.slice(0, 80)}"`;
}

export async function suggestNextAction(env: Env, context: string[]): Promise<string> {
  if (!env.FEATHERLESS_API_KEY) return stubSuggestion(context);

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: context.length > 0 ? context.join('\n') : '(no prior context)' },
  ];
  // 160 not 40: reasoning-family models (Qwen3 etc.) spend budget on a think
  // block before content — at 40 the content comes back empty (found live).
  // It's a cap, not a spend; tiny models still stop after one line.
  try {
    const result = await callFeatherless(env, { modelId: cheapestAvailableModel(), maxTokens: 160, messages });
    const text = cleanSuggestion(result.content);
    if (text) return text;
  } catch {
    // Catalog listings aren't always servable (found live: a warm-listed
    // model 404ing as model_not_found). A suggestion is a nudge, never worth
    // a 500 — fall through to the known-good fallback, then to canned.
  }
  try {
    const result = await callFeatherless(env, { modelId: FALLBACK_MODEL_ID, maxTokens: 160, messages });
    const text = cleanSuggestion(result.content);
    if (text) return text;
  } catch {
    // fall through
  }
  return stubSuggestion(context);
}

// Reasoning models may leak a <think>…</think> block ahead of the actual
// suggestion; strip it (and any unclosed variant) before judging emptiness.
function cleanSuggestion(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*/g, '')
    .trim()
    .split('\n')[0]!
    .trim();
}
