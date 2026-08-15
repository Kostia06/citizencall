// Stage 3 — execute. Calls the routed model (L1 exact cache), the routed tool
// if any (L2 tool cache, always user-scoped), verifies the result, and
// escalates exactly one rung on failure (SPEC.md §5.3–§5.4).
import type { Env } from '../env';
import type { Hop, ModelCandidate, Policy, RouteDecision, SubTask, TaskKind, TraceEvent, Verdict } from '../types';
import { NoEligibleModelError, routeSubTask } from './route';
import { verify } from './verify';
import {
  callFeatherless,
  FeatherlessBackpressureError,
  FeatherlessCapacityError,
  FeatherlessColdError,
  FeatherlessMessage,
  FeatherlessPlanError,
} from '../providers/featherless';
import { executeTool } from '../providers/composio';
import { getExact, putExact } from '../cache/exact';
import { getTool, putTool, toolCacheKey } from '../cache/tool';
import { recordVerdict } from '../cache/verdict';

export interface ExecuteContext {
  env: Env;
  db: D1Database;
  policy: Policy;
  candidates: ModelCandidate[];
  userId: string;
  emit: (e: TraceEvent) => void;
}

export interface ToolCallResult {
  subTaskId: string;
  toolkit: string;
  tool: string;
  argsHash: string;
  cacheHit: boolean;
  latencyMs: number;
}

export interface ExecuteResult {
  hops: Hop[];
  toolCalls: ToolCallResult[];
}

const MAX_TOKENS_BY_KIND: Record<TaskKind, number> = {
  classify: 32,
  extract_fields: 256,
  summarize: 256,
  normalize: 128,
};

const SYSTEM_PROMPT_BY_KIND: Record<TaskKind, string> = {
  classify: 'Classify the input. Reply with only the label, nothing else.',
  extract_fields: 'Extract structured fields from the input as a single JSON object. Reply with only JSON.',
  summarize: 'Summarize the input in 1-2 sentences.',
  normalize: 'Clean up this messy transcript into one clear instruction.',
};

function buildMessages(subTask: SubTask): FeatherlessMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT_BY_KIND[subTask.kind] },
    { role: 'user', content: subTask.instruction },
  ];
}

interface Attempt {
  decision: RouteDecision;
  hop: Hop;
  toolCall?: ToolCallResult;
}

export async function executeSubTask(ctx: ExecuteContext, subTask: SubTask): Promise<ExecuteResult> {
  const candidatesById = new Map(ctx.candidates.map((c) => [c.id, c]));

  const primary = await attempt(ctx, subTask, candidatesById, 0, undefined);
  const hops: Hop[] = [primary.hop];
  const toolCalls: ToolCallResult[] = primary.toolCall ? [primary.toolCall] : [];

  if (primary.hop.verdict === 'pass') return { hops, toolCalls };

  // Exactly one rung of escalation — never a third attempt, and if no rung 1
  // is defined/eligible we stop here on the primary's verdict.
  let escalated: Attempt;
  try {
    escalated = await attempt(ctx, subTask, candidatesById, 1, primary.hop.modelId);
  } catch (err) {
    if (err instanceof NoEligibleModelError) return { hops, toolCalls };
    throw err;
  }
  ctx.emit({ t: 'escalate', from: primary.hop.modelId, to: escalated.decision.modelId, reason: primary.hop.verdict });
  hops.push(escalated.hop);
  if (escalated.toolCall) toolCalls.push(escalated.toolCall);

  return { hops, toolCalls };
}

async function attempt(
  ctx: ExecuteContext,
  subTask: SubTask,
  candidatesById: Map<string, ModelCandidate>,
  ladderPosition: 0 | 1,
  escalatedFrom: string | undefined
): Promise<Attempt> {
  const decision = routeSubTask(ctx.policy, ctx.candidates, subTask, ladderPosition);
  ctx.emit({ t: 'route', decision });
  const model = candidatesById.get(decision.modelId);
  if (!model) throw new NoEligibleModelError(`routed to unknown candidate ${decision.modelId}`);

  const hopId = crypto.randomUUID();
  ctx.emit({ t: 'hop_start', hop: { id: hopId, subTaskId: subTask.id, modelId: model.id, paramsB: model.paramsB } });

  const toolOutcome = await runTool(ctx, subTask);
  const { hop, toolCall } = await runModel(ctx, subTask, model, hopId, escalatedFrom, toolOutcome);

  ctx.emit({ t: 'hop_end', hop });
  await recordVerdict(ctx.db, model.id, subTask.kind, hop.verdict);
  return { decision, hop, ...(toolCall ? { toolCall } : {}) };
}

interface ToolOutcome {
  ok: boolean;
  call: ToolCallResult;
}

async function runTool(ctx: ExecuteContext, subTask: SubTask): Promise<ToolOutcome | undefined> {
  if (!subTask.needsTools || !subTask.toolCall) return undefined;

  const params = { userId: ctx.userId, toolkit: subTask.toolCall.toolkit, tool: subTask.toolCall.tool, args: subTask.toolCall.args };
  const started = Date.now();

  const cached = await getTool<{ ok: boolean; output: unknown }>(ctx.db, params);
  let ok: boolean;
  if (cached) {
    ok = cached.ok;
  } else {
    const result = await executeTool(ctx.env, params);
    ok = result.ok;
    await putTool(ctx.db, params, { ok: result.ok, output: result.output });
  }

  const argsHash = await toolCacheKey(params);
  const latencyMs = Date.now() - started;
  ctx.emit({ t: 'tool_call', toolkit: params.toolkit, tool: params.tool, cacheHit: Boolean(cached), ms: latencyMs });
  return {
    ok,
    call: { subTaskId: subTask.id, toolkit: params.toolkit, tool: params.tool, argsHash, cacheHit: Boolean(cached), latencyMs },
  };
}

async function runModel(
  ctx: ExecuteContext,
  subTask: SubTask,
  model: ModelCandidate,
  hopId: string,
  escalatedFrom: string | undefined,
  toolOutcome: ToolOutcome | undefined
): Promise<{ hop: Hop; toolCall?: ToolCallResult }> {
  const started = Date.now();
  const maxTokens = MAX_TOKENS_BY_KIND[subTask.kind];
  const messages = buildMessages(subTask);
  const cacheParams = {
    modelId: model.id,
    prompt: messages.map((m) => `${m.role}:${m.content}`).join('\n'),
    temperature: 0,
    maxTokens,
    seed: 42,
  };

  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheHit: Hop['cacheHit'] = 'none';
  let verdict: Verdict;

  try {
    const exactHit = await getExact<{ content: string; promptTokens: number; completionTokens: number }>(
      ctx.db,
      cacheParams
    );
    if (exactHit) {
      ({ content, promptTokens, completionTokens } = exactHit);
      cacheHit = 'exact';
    } else {
      const result = await callFeatherless(ctx.env, { modelId: model.id, messages, maxTokens });
      ({ content, promptTokens, completionTokens } = result);
      await putExact(ctx.db, cacheParams, { content, promptTokens, completionTokens });
    }
    verdict = verify({
      kind: subTask.kind,
      output: content,
      needsTools: subTask.needsTools,
      ...(toolOutcome ? { toolOk: toolOutcome.ok } : {}),
    });
  } catch (err) {
    if (err instanceof FeatherlessColdError) {
      // Never a benchmark failure — the model just wasn't warm.
      verdict = 'fail_cold';
    } else if (
      err instanceof FeatherlessPlanError ||
      err instanceof FeatherlessBackpressureError ||
      err instanceof FeatherlessCapacityError
    ) {
      // Provider/infra failure, not a content-shape failure — Verdict has no
      // dedicated case for this, so it's bucketed with fail_tool (the closest
      // "external system didn't deliver" verdict) rather than inventing one.
      verdict = 'fail_tool';
    } else {
      throw err;
    }
  }

  const costUsd =
    (promptTokens / 1_000_000) * model.pricePerMTokIn + (completionTokens / 1_000_000) * model.pricePerMTokOut;

  const hop: Hop = {
    id: hopId,
    subTaskId: subTask.id,
    modelId: model.id,
    modelClass: model.modelClass,
    paramsB: model.paramsB,
    promptTokens,
    completionTokens,
    costUsd,
    latencyMs: Date.now() - started,
    availability: model.availability,
    verdict,
    ...(escalatedFrom ? { escalatedFrom } : {}),
    cacheHit,
  };
  return { hop, ...(toolOutcome ? { toolCall: toolOutcome.call } : {}) };
}
