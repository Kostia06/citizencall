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

// ---- Streaming variant ------------------------------------------------------
//
// Same request/return contract and error taxonomy as callFeatherless; the only
// addition is `onDelta`, invoked once per content chunk as it arrives. Token
// counts come from the terminal usage chunk when the provider sends one
// (stream_options.include_usage) and are estimated from text length (chars/4,
// the same heuristic the stub uses) when it doesn't.
export async function callFeatherlessStream(
  env: Env,
  req: FeatherlessRequest,
  onDelta: (text: string) => void
): Promise<FeatherlessResult> {
  if (!env.FEATHERLESS_API_KEY) {
    // Stub mode streams exactly one synthetic delta so the pipeline's
    // delta→answer reconciliation is exercised without a network dependency.
    const result = await stubCall(req);
    onDelta(result.content);
    return result;
  }
  return liveStreamCall(env.FEATHERLESS_API_KEY, req, onDelta);
}

async function liveStreamCall(
  apiKey: string,
  req: FeatherlessRequest,
  onDelta: (text: string) => void
): Promise<FeatherlessResult> {
  const started = Date.now();

  // Identical status-code taxonomy and 503 retry loop as liveCall — every
  // mapped error fires before the body starts streaming, so retrying here
  // never replays partial deltas.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.modelId,
          messages: req.messages,
          temperature: 0,
          seed: 42,
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });

      if (res.status === 400) throw new FeatherlessColdError(`model ${req.modelId} cold`);
      if (res.status === 403) throw new FeatherlessPlanError(`plan exclusion or HF gating for ${req.modelId}`);
      if (res.status === 429) throw new FeatherlessBackpressureError('concurrency units exhausted');
      if (res.status === 503) {
        if (attempt < MAX_RETRIES_503) continue;
        throw new FeatherlessCapacityError('GPU capacity, transient — retries exhausted');
      }
      if (!res.ok) throw new Error(`Featherless ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error('Featherless stream: response had no body');

      const parsed = await consumeSseBody(res.body, onDelta);
      const promptTokens =
        parsed.usage?.prompt_tokens ??
        Math.max(1, Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4));
      const completionTokens = parsed.usage?.completion_tokens ?? Math.max(1, Math.ceil(parsed.content.length / 4));
      return { content: parsed.content, promptTokens, completionTokens, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface SseUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

async function consumeSseBody(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<{ content: string; usage?: SseUsage }> {
  let content = '';
  let usage: SseUsage | undefined;
  const parser = createSseParser((data) => {
    const chunk = data as {
      choices?: { delta?: { content?: string | null } }[];
      usage?: SseUsage | null;
    };
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      content += delta;
      onDelta(delta);
    }
    if (chunk.usage) usage = chunk.usage; // terminal usage chunk (include_usage)
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode()); // flush any trailing multi-byte sequence
  return usage ? { content, usage } : { content };
}

/** Incremental OpenAI-style SSE parser. Frames may split anywhere across
 * network chunks; `push` buffers until a full `\n`-terminated line exists,
 * strips the `data: ` prefix, ignores `[DONE]`/comments/blank lines, and
 * calls `onData` with each parsed JSON payload. Exported for unit tests. */
export function createSseParser(onData: (data: unknown) => void): { push(chunk: string): void } {
  let buffer = '';
  return {
    push(chunk: string): void {
      buffer += chunk;
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl === -1) return;
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue; // blank line / `: keepalive` comment
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          onData(JSON.parse(payload));
        } catch {
          // A malformed frame is dropped rather than killing the stream —
          // the final `answer` event reconciles the full text regardless.
        }
      }
    },
  };
}

/** Coalesces streamed deltas so downstream trace events fire at most once per
 * `minIntervalMs` (~10/sec at the default). Timer-free by design: text
 * accumulates until the next push crosses the interval, and `end()` flushes
 * the remainder — callers MUST call it before using the accumulated result.
 * The first push always flushes immediately (fast first paint). */
export function createDeltaCoalescer(
  flush: (text: string) => void,
  minIntervalMs = 100,
  now: () => number = Date.now
): { push(text: string): void; end(): void } {
  let buffer = '';
  let lastFlush = 0;
  return {
    push(text: string): void {
      buffer += text;
      const t = now();
      if (t - lastFlush >= minIntervalMs && buffer) {
        flush(buffer);
        buffer = '';
        lastFlush = t;
      }
    },
    end(): void {
      if (buffer) {
        flush(buffer);
        buffer = '';
      }
    },
  };
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
