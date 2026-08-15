// RunDO — one Durable Object per run (SPEC.md §2, §13). Owns run state, the
// append-only SSE event buffer, and an L0 in-memory cache scoped to this run.
import type { Env } from './env';
import type { Hop, ModelCandidate, Policy, TraceEvent } from './types';
import { policy, candidates } from './policy';
import { normalize } from './pipeline/normalize';
import { decompose } from './pipeline/decompose';
import { executeSubTask, type ToolCallResult } from './pipeline/execute';
import { buildRunEndEvent, sumCost } from './pipeline/trace';
import { finalizeRun, flushHops, flushToolCalls, insertRun, insertSubTasks, markRunErrored } from './db';
import { formatSseEvent, replayFrom, SSE_HEARTBEAT } from './sse';

export interface StartRunBody {
  runId: string;
  userId: string;
  text: string;
  source: 'text' | 'voice';
}

const HEARTBEAT_MS = 15_000;

export class RunDO {
  private events: TraceEvent[] = [];
  private status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  private hops: Hop[] = [];
  private toolCalls: ToolCallResult[] = [];
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
    const startedAt = Date.now();
    this.push({ t: 'run_start', runId: body.runId, userId: body.userId, text: body.text, source: body.source });

    await insertRun(this.env.DB, {
      id: body.runId,
      userId: body.userId,
      requestText: body.text,
      source: body.source,
      transcriptRaw: body.source === 'voice' ? body.text : null,
      createdAt: startedAt,
    });

    const norm = await normalize(this.env, this.env.DB, policy, body.text, body.source);
    if (body.source === 'voice') {
      this.push({ t: 'normalized', from: body.text, to: norm.to, ms: norm.ms, modelId: norm.modelId });
    }

    const planStarted = Date.now();
    const { plan, cacheHit: planCacheHit } = await decompose(this.env, this.env.DB, policy, norm.to);
    this.push({ t: 'plan', plan, cacheHit: planCacheHit, ms: Date.now() - planStarted });
    await insertSubTasks(this.env.DB, body.runId, plan);

    let cacheHitCount = 0;
    for (const subTask of plan.subTasks) {
      const result = await executeSubTask(
        { env: this.env, db: this.env.DB, policy, candidates, userId: body.userId, emit: (e) => this.push(e) },
        subTask
      );
      this.hops.push(...result.hops);
      this.toolCalls.push(...result.toolCalls);
      cacheHitCount += result.hops.filter((h) => h.cacheHit !== 'none').length;
    }

    const totalMs = Date.now() - startedAt;
    const baselineCostUsd = estimateBaselineCost(this.hops, policy, candidates);
    this.push(buildRunEndEvent(body.runId, this.hops, totalMs, baselineCostUsd));

    await flushHops(this.env.DB, body.runId, this.hops);
    if (this.toolCalls.length > 0) {
      await flushToolCalls(
        this.env.DB,
        this.toolCalls.map((c) => ({ id: crypto.randomUUID(), runId: body.runId, ...c }))
      );
    }
    await finalizeRun(this.env.DB, body.runId, {
      totalCostUsd: sumCost(this.hops),
      baselineCostUsd,
      totalMs,
      cacheHits: cacheHitCount,
      planCacheHit,
    });

    this.status = 'done';
  }
}

// Live demo approximation only — SPEC.md §10 requires baselineCostUsd be
// measured offline, once per demo request, and reported alongside this
// number rather than trusted in place of it. Prices the LAST hop per
// sub-task (i.e. the final, successful attempt) at frontier-model rates.
function estimateBaselineCost(hops: Hop[], p: Policy, cands: ModelCandidate[]): number {
  const frontier = cands.find((c) => c.id === p.baselines.frontier);
  if (!frontier) return 0;
  const finalHopBySubTask = new Map<string, Hop>();
  for (const h of hops) finalHopBySubTask.set(h.subTaskId, h);
  let total = 0;
  for (const h of finalHopBySubTask.values()) {
    total +=
      (h.promptTokens / 1_000_000) * frontier.pricePerMTokIn +
      (h.completionTokens / 1_000_000) * frontier.pricePerMTokOut;
  }
  return total;
}
