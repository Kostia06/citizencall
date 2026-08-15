// The whole run pipeline (SPEC.md §2 Tier 3): normalize → decompose → route →
// execute → verify/escalate → trace, plus the per-user run-result cache and
// the per-user store wiring (context prompt, tool enablement, connections,
// MCP toolkits). Lives in pipeline/ so the Durable Object stays a transport
// shell (SSE buffer + state) and delegates here — see the worker-b report for
// the small run.do.ts diff that makes RunDO call this instead of its inline
// copy.
import type { Env } from '../env';
import type { Hop, ModelCandidate, Policy, TraceEvent } from '../types';
import { policy as bootPolicy, candidates as bootCandidates } from '../policy';
import { normalize } from './normalize';
import { decompose } from './decompose';
import { executeSubTask, type PriorOutput, type ToolCallResult } from './execute';
import { buildRunEndEvent, sumCost } from './trace';
import { asTraceEvent } from './events';
import { listEnabledMcpToolkits } from './mcp';
import { finalizeRun, flushHops, flushToolCalls, insertRun, insertSubTasks } from '../db';
import { loadUserContext } from '../store/context';
import { normalizePlanKey } from '../cache/plan';
import { getRunResult, putRunResult } from '../cache/runResult';

export interface RunRequest {
  runId: string;
  userId: string;
  text: string;
  source: 'text' | 'voice';
  /** ⌘⏎ bypass: skip the run-cache lookup but still write through. */
  noCache?: boolean;
}

/** `policy`/`candidates` are test seams only — production always runs on the
 * boot-loaded policy.json + candidate roster (SPEC.md §13).
 * `waitForConnection` is production wiring: the DO (run.do.ts) provides it so
 * a missing Composio connection pauses the run instead of erroring. */
export interface RunPipelineOptions {
  policy?: Policy;
  candidates?: ModelCandidate[];
  waitForConnection?: (toolkit: string, subTaskId: string) => Promise<'connected' | 'skipped'>;
}

export async function runPipeline(
  env: Env,
  emit: (e: TraceEvent) => void,
  body: RunRequest,
  opts: RunPipelineOptions = {}
): Promise<void> {
  const policy = opts.policy ?? bootPolicy;
  const candidates = opts.candidates ?? bootCandidates;
  const db = env.DB;
  const startedAt = Date.now();
  emit({ t: 'run_start', runId: body.runId, userId: body.userId, text: body.text, source: body.source });

  await insertRun(db, {
    id: body.runId,
    userId: body.userId,
    requestText: body.text,
    source: body.source,
    transcriptRaw: body.source === 'voice' ? body.text : null,
    createdAt: startedAt,
  });

  // (3a) Per-user store: the saved context prompt is prepended server-side, so
  // it shapes planning and every sub-task — and, because it changes the
  // normalized prompt, it is part of the run-cache key by construction.
  const userCtx = await loadUserContextSafe(db, body.userId);
  const effectiveText = userCtx.contextPrompt ? `${userCtx.contextPrompt}\n\n${body.text}` : body.text;

  const norm = await normalize(env, db, policy, effectiveText, body.source);
  if (body.source === 'voice') {
    emit({ t: 'normalized', from: body.text, to: norm.to, ms: norm.ms, modelId: norm.modelId });
  }

  // Run-result cache: key = hash(userId ∥ normalized prompt ∥ policy version).
  // Per-user is a hard security requirement — getRunResult/putRunResult refuse
  // to operate without a userId (anon actors pass their anon id).
  const cacheKeyParams = {
    userId: body.userId,
    normalizedText: normalizePlanKey(norm.to),
    policyVersion: policy.version,
  };

  if (!body.noCache) {
    const cached = await getRunResult(db, cacheKeyParams);
    if (cached) {
      emit(asTraceEvent({ t: 'cache_hit', runId: body.runId, cachedAt: cached.cachedAt, ageMs: Date.now() - cached.cachedAt }));
      // Replay the stored trace instead of re-running; only run_end carries
      // the run id, which must be this run's.
      for (const ev of cached.events) {
        emit(ev.t === 'run_end' ? { ...ev, runId: body.runId } : ev);
      }
      // Persist the cached run for GET /api/run/:id. Hops get fresh PK ids
      // (the original ids already exist in the hops table for the source
      // run); the replayed trace keeps the stored ids — the trace is the UI
      // surface, rows are the audit surface. total_cost_usd is 0 because
      // this run spent nothing; the replayed run_end intentionally shows the
      // original run's economics so the hop cards stay coherent.
      await flushHops(db, body.runId, cached.hops.map((h) => ({ ...h, id: crypto.randomUUID() })));
      if (cached.toolCalls.length > 0) {
        await flushToolCalls(db, cached.toolCalls.map((c) => ({ id: crypto.randomUUID(), runId: body.runId, ...c })));
      }
      await finalizeRun(db, body.runId, {
        totalCostUsd: 0,
        baselineCostUsd: cached.totals.baselineCostUsd,
        totalMs: Date.now() - startedAt,
        cacheHits: cached.hops.length,
        planCacheHit: true,
      });
      return;
    }
  }

  // Everything from here on is recorded for write-through: a later identical
  // run replays exactly this event stream.
  const recorded: TraceEvent[] = [];
  const record = (e: TraceEvent): void => {
    recorded.push(e);
    emit(e);
  };

  const mcpToolkits = await listEnabledMcpToolkits(db, body.userId).catch(() => []);
  const mcpTokens = new Set(mcpToolkits.map((m) => m.toolkit));

  const planStarted = Date.now();
  const { plan, cacheHit: planCacheHit } = await decompose(env, db, policy, norm.to, [...mcpTokens]);
  record({ t: 'plan', plan, cacheHit: planCacheHit, ms: Date.now() - planStarted });
  await insertSubTasks(db, body.runId, plan);

  const hops: Hop[] = [];
  const toolCalls: ToolCallResult[] = [];
  const priorOutputs = new Map<string, PriorOutput>();
  let cacheHitCount = 0;
  for (const subTask of plan.subTasks) {
    const result = await executeSubTask(
      {
        env,
        db,
        policy,
        candidates,
        userId: body.userId,
        emit: record,
        mcpToolkits: mcpTokens,
        priorOutputs,
        ...(opts.waitForConnection ? { waitForConnection: opts.waitForConnection } : {}),
      },
      subTask
    );
    hops.push(...result.hops);
    toolCalls.push(...result.toolCalls);
    priorOutputs.set(subTask.id, { content: result.output, toolDerived: result.toolDerived });
    cacheHitCount += result.hops.filter((h) => h.cacheHit !== 'none').length;
  }

  const totalMs = Date.now() - startedAt;
  const baselineCostUsd = estimateBaselineCost(hops, policy, candidates);
  record(buildRunEndEvent(body.runId, hops, totalMs, baselineCostUsd));

  await flushHops(db, body.runId, hops);
  if (toolCalls.length > 0) {
    await flushToolCalls(db, toolCalls.map((c) => ({ id: crypto.randomUUID(), runId: body.runId, ...c })));
  }
  const totals = {
    totalCostUsd: sumCost(hops),
    baselineCostUsd,
    totalMs,
    cacheHits: cacheHitCount,
    planCacheHit,
  };
  await finalizeRun(db, body.runId, totals);

  // Write-through — including on noCache (§ deliverable: bypass skips the
  // LOOKUP only). Runs whose final hop failed verification are not cached:
  // serving a stored failure for 24h would pin the user to it, while a retry
  // may pass (warmer model, fixed connection).
  if (allSubTasksPassed(plan.subTasks.map((s) => s.id), hops)) {
    await putRunResult(db, cacheKeyParams, { events: recorded, hops, toolCalls, totals });
  }
}

function allSubTasksPassed(subTaskIds: string[], hops: Hop[]): boolean {
  const finalVerdict = new Map<string, Hop['verdict']>();
  for (const h of hops) finalVerdict.set(h.subTaskId, h.verdict); // last hop wins
  return subTaskIds.every((id) => finalVerdict.get(id) === 'pass');
}

// The store must never take down a run — a missing store table or transient
// D1 error degrades to "no per-user context", loudly.
async function loadUserContextSafe(
  db: D1Database,
  userId: string
): Promise<{ contextPrompt: string }> {
  try {
    return await loadUserContext(db, userId);
  } catch (err) {
    console.error(`loadUserContext failed for ${userId}; running without per-user context:`, err);
    return { contextPrompt: '' };
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
