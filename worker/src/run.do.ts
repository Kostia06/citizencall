// RunDO — one Durable Object per run (SPEC.md §2, §13). Owns run state, the
// append-only SSE event buffer, and an L0 in-memory cache scoped to this run.
import type { Env } from './env';
import type { TraceEvent } from './types';
import { runPipeline } from './pipeline/run';
import { markRunErrored } from './db';
import { formatSseEvent, replayFrom, SSE_HEARTBEAT } from './sse';

export interface StartRunBody {
  runId: string;
  userId: string;
  text: string;
  source: 'text' | 'voice';
  noCache?: boolean;
}

const HEARTBEAT_MS = 15_000;

export class RunDO {
  private events: TraceEvent[] = [];
  private status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  private waiters: Array<() => void> = [];
  // L0 — one run, in-memory, never persisted (SPEC.md §8).
  private readonly l0 = new Map<string, unknown>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/start')) return this.handleStart(request);
    if (request.method === 'GET' && url.pathname.endsWith('/stream')) return this.handleStream(request);
    return new Response('not found', { status: 404 });
  }

  getL0<T>(key: string): T | undefined {
    return this.l0.get(key) as T | undefined;
  }
  setL0(key: string, value: unknown): void {
    this.l0.set(key, value);
  }

  private async handleStart(request: Request): Promise<Response> {
    if (this.status !== 'idle') return new Response('run already started', { status: 409 });
    const body = (await request.json()) as StartRunBody;
    this.status = 'running';
    // Kick off the pipeline without awaiting it here — combined with the
    // append-only buffer + replay-on-connect below, this is fix (a): whether
    // the SSE client attaches before or after this returns, it sees every
    // event from run_start onward.
    this.ctx.waitUntil(
      this.runPipeline(body).catch((err) => {
        this.push({ t: 'error', message: err instanceof Error ? err.message : String(err) });
        this.status = 'error';
        return markRunErrored(this.env.DB, body.runId);
      })
    );
    return new Response('ok');
  }

  private push(event: TraceEvent): void {
    this.events.push(event);
    for (const wake of this.waiters.splice(0)) wake();
  }

  private waitForMore(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async handleStream(request: Request): Promise<Response> {
    const lastEventId =
      request.headers.get('Last-Event-ID') ?? new URL(request.url).searchParams.get('lastEventId');
    const { fromIndex, events: backlog } = replayFrom(this.events, lastEventId);
    let idx = fromIndex;
    const encoder = new TextEncoder();
    const self = this;

    const stream = new ReadableStream({
      async start(controller) {
        for (const ev of backlog) {
          controller.enqueue(encoder.encode(formatSseEvent(idx, ev)));
          idx++;
        }
        while (true) {
          if (idx < self.events.length) {
            controller.enqueue(encoder.encode(formatSseEvent(idx, self.events[idx]!)));
            idx++;
            continue;
          }
          if (self.status === 'done' || self.status === 'error') {
            controller.close();
            return;
          }
          await self.waitForMore(HEARTBEAT_MS);
          if (idx >= self.events.length) {
            // Fix (c): heartbeat so a slow model call doesn't stall the wire.
            controller.enqueue(encoder.encode(SSE_HEARTBEAT));
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private async runPipeline(body: StartRunBody): Promise<void> {
    await runPipeline(this.env, (e) => this.push(e), body);
    this.status = 'done';
  }
}
