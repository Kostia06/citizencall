// Ported from ui/src/api.ts's `startRun` — React Native's built-in `fetch`
// can't stream a response body, so live mode uses `expo/fetch` (SDK 52+,
// backed by the native "winter" runtime) which exposes a real
// ReadableStream on `Response.body`. That plus `SseParser` (src/lib/sse.ts)
// re-parses the same `/api/run/:id/stream` SSE wire format the web client
// consumes via `EventSource` — chosen over polling `/api/run/:id` so hops
// still arrive live instead of as one coarse "done yet?" snapshot.
import { fetch as streamingFetch } from 'expo/fetch';
import { API_BASE, MOCK } from './config';
import { buildScenario } from './mockScenario';
import { SseParser } from '../lib/sse';
import type { RunAttachment, TraceEvent } from '../types/contract';

export interface RunHandle {
  runId: string;
  close(): void;
}

export interface StartRunOpts {
  userId: string;
  text: string;
  noCache?: boolean;
  attachments?: RunAttachment[];
  onEvent(event: TraceEvent): void;
  onError?(err: unknown): void;
}

export function startRun(opts: StartRunOpts): RunHandle {
  return MOCK ? startMockRun(opts) : startLiveRun(opts);
}

function startMockRun(opts: StartRunOpts): RunHandle {
  const runId = `mock-${Date.now().toString(36)}`;
  const steps = buildScenario({ runId, userId: opts.userId, text: opts.text, attachments: opts.attachments });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let elapsed = 0;
  for (const step of steps) {
    elapsed += step.delay;
    timers.push(setTimeout(() => opts.onEvent(step.event), elapsed));
  }
  return {
    runId,
    close() {
      timers.forEach(clearTimeout);
    },
  };
}

function startLiveRun(opts: StartRunOpts): RunHandle {
  let closed = false;
  let abort: AbortController | undefined;
  const provisional = { runId: '' };
  const handle: RunHandle = {
    get runId() {
      return provisional.runId;
    },
    close() {
      closed = true;
      abort?.abort();
    },
  };

  (async () => {
    try {
      const startRes = await fetch(`${API_BASE}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: opts.userId,
          text: opts.text,
          source: 'text',
          noCache: opts.noCache,
          attachments: opts.attachments ?? [],
        }),
      });
      if (!startRes.ok) throw new Error(`POST /api/run failed: ${startRes.status}`);
      const { runId } = (await startRes.json()) as { runId: string };
      provisional.runId = runId;
      if (closed) return;

      abort = new AbortController();
      const res = await streamingFetch(`${API_BASE}/api/run/${runId}/stream`, { signal: abort.signal as never });
      if (!res.body) throw new Error('stream response had no body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          try {
            opts.onEvent(JSON.parse(frame.data) as TraceEvent);
          } catch (err) {
            opts.onError?.(err);
          }
        }
      }
    } catch (err) {
      if (!closed) opts.onError?.(err);
    }
  })();

  return handle;
}
