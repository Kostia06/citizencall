// RunDO — one Durable Object per run (SPEC.md §2, §13). Owns run state, the
// append-only SSE event buffer, and an L0 in-memory cache scoped to this run.
import type { Env } from './env';
import type { TraceEvent } from './types';
import { runPipeline } from './pipeline/run';
import { markRunErrored } from './db';
import { getConnectedAccountId } from './store/connections';
import { formatSseEvent, replayFrom, SSE_HEARTBEAT } from './sse';

export interface StartRunBody {
  runId: string;
  userId: string;
  text: string;
  source: 'text' | 'voice';
  noCache?: boolean;
  /** Prior turns of the client session — validated/truncated at POST
   * /api/run, passed through to runPipeline untouched. */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** Attached-file text — validated/capped at POST /api/run
   * (attachmentsSchema), passed through to runPipeline untouched. */
  attachments?: Array<{ name: string; mimeType?: string; text: string }>;
  /** Client Date.getTimezoneOffset() — for time-of-day routine schedules. */
  tzOffsetMinutes?: number;
}

const HEARTBEAT_MS = 15_000;
const CONNECTION_PAUSE_TIMEOUT_MS = 5 * 60_000;

/** How a connection-required pause ended: the user linked the toolkit, or
 * skipped (explicitly, or via the 5-minute timeout). */
export type ConnectionResolution = 'connected' | 'skipped';

interface PendingConnection {
  userId: string;
  toolkit: string;
  resolve: (resolution: ConnectionResolution) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 5s store poll — self-resume when the OAuth completes in another tab. */
  poll?: ReturnType<typeof setInterval>;
}

export class RunDO {
  private events: TraceEvent[] = [];
  private status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  private waiters: Array<() => void> = [];
  // L0 — one run, in-memory, never persisted (SPEC.md §8).
  private readonly l0 = new Map<string, unknown>();
  // Connection-required pause (at most one at a time — sub-tasks execute
  // sequentially). Status stays 'running' while paused so the SSE stream
  // keeps heartbeating instead of closing.
  private pendingConnection: PendingConnection | null = null;
  /** Injectable for tests (runInDurableObject) — production keeps 5 min. */
  connectionTimeoutMs = CONNECTION_PAUSE_TIMEOUT_MS;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/start')) return this.handleStart(request);
    if (request.method === 'POST' && url.pathname.endsWith('/resume')) return this.handleResume(request);
    if (request.method === 'GET' && url.pathname.endsWith('/stream')) return this.handleStream(request);
    return new Response('not found', { status: 404 });
  }

  getL0<T>(key: string): T | undefined {
    return this.l0.get(key) as T | undefined;
  }
  setL0(key: string, value: unknown): void {
    this.l0.set(key, value);
  }

  /** Test-visibility accessor (runInDurableObject) — the event buffer is
   * otherwise only observable through the SSE stream. */
  snapshotEvents(): readonly TraceEvent[] {
    return this.events;
  }

  /** Pipeline callback (threaded via RunPipelineOptions): emit
   * `connection_required`, then block the run until POST /resume settles the
   * pause or the timeout treats it as a skip. `run_resumed` is emitted here,
   * in settleConnectionWait, so the trace always shows the pair.
   *
   * SELF-RESUME: the OAuth flow finishes in another tab (or the user's
   * original tab navigated away entirely — observed live), so the DO also
   * polls the store every 5s and resumes ITSELF the moment the connection
   * exists. No tab needs to survive for a paused run to complete. */
  waitForConnection(userId: string, toolkit: string, subTaskId: string): Promise<ConnectionResolution> {
    this.push({ t: 'connection_required', toolkit, subTaskId });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settleConnectionWait('skipped'), this.connectionTimeoutMs);
      const poll = setInterval(() => {
        getConnectedAccountId(this.env.DB, userId, toolkit)
          .then((id) => {
            if (id) this.settleConnectionWait('connected');
          })
          .catch(() => undefined);
      }, 5_000);
      this.pendingConnection = { userId, toolkit, resolve, timer, poll };
    });
  }

  private settleConnectionWait(resolution: ConnectionResolution): void {
    const pending = this.pendingConnection;
    if (!pending) return;
    this.pendingConnection = null;
    clearTimeout(pending.timer);
    if (pending.poll) clearInterval(pending.poll);
    this.push({ t: 'run_resumed', toolkit: pending.toolkit, skipped: resolution === 'skipped' });
    pending.resolve(resolution);
  }

  private async handleResume(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== 'retry' && action !== 'skip') {
      return Response.json({ error: "action must be 'retry' or 'skip'" }, { status: 400 });
    }
    const pending = this.pendingConnection;
    if (!pending) return Response.json({ error: 'run is not paused' }, { status: 409 });

    if (action === 'skip') {
      this.settleConnectionWait('skipped');
      return Response.json({ resumed: true, skipped: true });
    }
    // retry — only resume when the connection actually exists NOW; a
    // premature retry keeps the pause alive instead of burning it on a
    // still-missing connection.
    const accountId = await getConnectedAccountId(this.env.DB, pending.userId, pending.toolkit);
    if (!accountId) return Response.json({ resumed: false, waiting: true });
    this.settleConnectionWait('connected');
    return Response.json({ resumed: true, skipped: false });
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
    await runPipeline(this.env, (e) => this.push(e), body, {
      waitForConnection: (toolkit, subTaskId) => this.waitForConnection(body.userId, toolkit, subTaskId),
    });
    this.status = 'done';
  }
}
