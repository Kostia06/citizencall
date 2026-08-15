// Stage 0 — normalize, voice only (SPEC.md §5.1, §7.4). Typed input skips
// this stage entirely. Uses the L1 exact cache since the call is
// deterministic (temperature:0, seed:42).
import type { Env } from '../env';
import type { Policy } from '../types';
import { getExact, putExact } from '../cache/exact';
import { callFeatherless } from '../providers/featherless';

export interface NormalizeResult {
  to: string;
  ms: number;
  modelId: string;
  cacheHit: boolean;
}

const MAX_TOKENS = 128;

export async function normalize(
  env: Env,
  db: D1Database,
  policy: Policy,
  raw: string,
  source: 'text' | 'voice'
): Promise<NormalizeResult> {
  if (source === 'text') return { to: raw, ms: 0, modelId: '', cacheHit: false };

  const modelId = policy.ladders.normalize?.[0];
  if (!modelId) {
    // normalize is optional (SPEC.md §7.4/§19) — if the kind was never
    // swept, fall through with the raw transcript rather than failing.
    return { to: raw, ms: 0, modelId: '', cacheHit: false };
  }

  const started = Date.now();
  const params = { modelId, prompt: raw, temperature: 0, maxTokens: MAX_TOKENS, seed: 42 };

  const cached = await getExact<{ content: string }>(db, params);
  if (cached) return { to: cached.content.trim(), ms: Date.now() - started, modelId, cacheHit: true };

  const result = await callFeatherless(env, {
    modelId,
    messages: [
      {
        role: 'system',
        content:
          'Clean up this messy speech transcript into one clear instruction. Reply with only the cleaned instruction, no preamble.',
      },
      { role: 'user', content: raw },
    ],
    maxTokens: MAX_TOKENS,
  });
  await putExact(db, params, { content: result.content });
  return { to: result.content.trim(), ms: Date.now() - started, modelId, cacheHit: false };
}
