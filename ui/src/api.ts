import type { BenchmarkResult, RosterEntry, TraceEvent } from './types';
import { mockBenchmark, mockFunnel, mockRoster } from './mock/fixtures';
import { buildScenario } from './mock/scenario';

// MOCK is on by default so the UI is fully demoable with zero backend —
// flip VITE_MOCK=false to talk to a real Worker. See SPEC.md §13.
export const MOCK: boolean = import.meta.env.VITE_MOCK !== 'false';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export interface RunHandle {
  runId: string;
  close(): void;
}

export interface StartRunOpts {
  userId: string;
  text: string;
  source: 'text' | 'voice';
  noCache?: boolean;
  onEvent(event: TraceEvent): void;
  onError?(err: unknown): void;
}

/** Kicks off a run and streams TraceEvents back through onEvent. In MOCK
 * mode this replays a scripted sequence on a timer, no network involved. */
export function startRun(opts: StartRunOpts): RunHandle {
  if (MOCK) {
    return startMockRun(opts);
  }
  return startLiveRun(opts);
}

function startMockRun(opts: StartRunOpts): RunHandle {
  const runId = `mock-${Date.now().toString(36)}`;
  const steps = buildScenario({ runId, userId: opts.userId, text: opts.text, source: opts.source });
  const timers: number[] = [];
  let elapsed = 0;

  for (const step of steps) {
    elapsed += step.delay;
    const id = window.setTimeout(() => opts.onEvent(step.event), elapsed);
    timers.push(id);
  }

  return {
    runId,
    close() {
      timers.forEach((id) => window.clearTimeout(id));
    },
  };
}

function startLiveRun(opts: StartRunOpts): RunHandle {
  let es: EventSource | undefined;
  let closed = false;
  // Placeholder id until POST /api/run resolves — callers only read runId
  // synchronously for mock mode; live mode should use the resolved id from
  // the run_start TraceEvent instead.
  const provisional = { runId: '', close: () => undefined };
  const handle: RunHandle = {
    get runId() {
      return provisional.runId;
    },
    close() {
      closed = true;
      es?.close();
    },
  };

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: opts.userId,
          text: opts.text,
          source: opts.source,
          noCache: opts.noCache,
        }),
      });
      if (!res.ok) throw new Error(`POST /api/run failed: ${res.status}`);
      const { runId } = (await res.json()) as { runId: string };
      provisional.runId = runId;
      if (closed) return;

      // Native EventSource sends Last-Event-ID automatically on reconnect
      // (SPEC.md §13 fix (b)) as long as the server emits `id:` per event.
      es = new EventSource(`${API_BASE}/api/run/${runId}/stream`);
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as TraceEvent;
          opts.onEvent(event);
        } catch (err) {
          opts.onError?.(err);
        }
      };
      es.onerror = (err) => {
        // EventSource retries on its own; surface it but don't tear down —
        // a transient drop mid-run is expected and should self-heal.
        opts.onError?.(err);
      };
    } catch (err) {
      opts.onError?.(err);
    }
  })();

  return handle;
}

export async function fetchRoster(): Promise<RosterEntry[]> {
  if (MOCK) return mockRoster;
  const res = await fetch(`${API_BASE}/api/roster`);
  if (!res.ok) throw new Error(`GET /api/roster failed: ${res.status}`);
  return res.json();
}

export async function fetchBenchmark(): Promise<BenchmarkResult> {
  if (MOCK) return mockBenchmark;
  const res = await fetch(`${API_BASE}/api/benchmark`);
  if (!res.ok) throw new Error(`GET /api/benchmark failed: ${res.status}`);
  return res.json();
}

export async function fetchFunnel(): Promise<typeof mockFunnel> {
  if (MOCK) return mockFunnel;
  const res = await fetch(`${API_BASE}/api/funnel`);
  if (!res.ok) throw new Error(`GET /api/funnel failed: ${res.status}`);
  return res.json();
}

export async function connectToolkit(userId: string, toolkit: 'github' | 'gmail'): Promise<{ url: string }> {
  if (MOCK) return { url: '#' };
  const res = await fetch(`${API_BASE}/api/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, toolkit }),
  });
  if (!res.ok) throw new Error(`POST /api/connect failed: ${res.status}`);
  return res.json();
}
