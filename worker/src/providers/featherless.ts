// Featherless chat-completions client (SPEC.md §5.3). Guarded behind
// env.FEATHERLESS_API_KEY — with no key set, callFeatherless returns a
// deterministic stub so `pnpm test` and local dev never need a real key.
import type { Env } from '../env';

export interface FeatherlessMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FeatherlessRequest {
  modelId: string;
  messages: FeatherlessMessage[];
  maxTokens: number;
}

export interface FeatherlessResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

// One class per row of the SPEC.md §5.3 error table so callers can branch on
// `instanceof` instead of parsing status codes again.
export class FeatherlessColdError extends Error {
  readonly code = 'fail_cold' as const;
}
export class FeatherlessPlanError extends Error {
  readonly code = 'plan_or_gating' as const;
}
export class FeatherlessBackpressureError extends Error {
  readonly code = 'backpressure' as const; // 429 — immediate, never queued
}
export class FeatherlessCapacityError extends Error {
  readonly code = 'capacity' as const; // 503 after retries exhausted
}

const ENDPOINT = 'https://api.featherless.ai/v1/chat/completions';
const CLIENT_TIMEOUT_MS = 120_000; // no documented server timeout — set our own
const MAX_RETRIES_503 = 3;

export async function callFeatherless(env: Env, req: FeatherlessRequest): Promise<FeatherlessResult> {
  if (!env.FEATHERLESS_API_KEY) return stubCall(req);
  return liveCall(env.FEATHERLESS_API_KEY, req);
}

async function liveCall(apiKey: string, req: FeatherlessRequest): Promise<FeatherlessResult> {
  const started = Date.now();

  // 503 (transient GPU capacity) retries up to 3x; every other error code is
  // terminal and thrown immediately — see the SPEC.md §5.3 error table.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.modelId,
          messages: req.messages,
          temperature: 0,
          seed: 42,
          max_tokens: req.maxTokens, // ALWAYS set — biggest cost lever per §9.6
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 400) throw new FeatherlessColdError(`model ${req.modelId} cold`);
    if (res.status === 403) throw new FeatherlessPlanError(`plan exclusion or HF gating for ${req.modelId}`);
    if (res.status === 429) throw new FeatherlessBackpressureError('concurrency units exhausted');
    if (res.status === 503) {
      if (attempt < MAX_RETRIES_503) continue;
      throw new FeatherlessCapacityError('GPU capacity, transient — retries exhausted');
    }
    if (!res.ok) throw new Error(`Featherless ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: body.choices[0]?.message.content ?? '',
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}

// Deterministic stub: same input always produces the same "output" so cache
// tests and the demo remain reproducible without a network dependency.
async function stubCall(req: FeatherlessRequest): Promise<FeatherlessResult> {
  const last = req.messages[req.messages.length - 1]?.content ?? '';
  const promptTokens = Math.max(1, Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4));
  const content = `[stub:${req.modelId}] ${last.trim().slice(0, 200)}`;
  const completionTokens = Math.max(1, Math.ceil(content.length / 4));
  return {
    content,
    promptTokens,
    completionTokens: Math.min(completionTokens, req.maxTokens),
    latencyMs: 1, // deterministic — stub never simulates network jitter
  };
}
