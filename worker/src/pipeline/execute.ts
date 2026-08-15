// Stage 3 — execute. Runs the routed tool (gated on the user's per-tool
// enablement + live connection, L2 tool cache always user-scoped), calls the
// routed model with tool/dependency context (L1 exact cache, global — skipped
// for anything derived from tool output per the SPEC.md §8 scoping rule),
// verifies the result, and escalates exactly one rung on failure
// (SPEC.md §5.3–§5.4).
import type { Env } from '../env';
import { getToolkitCatalog } from '../providers/composio-catalog';
import type { Hop, ModelCandidate, Policy, RouteDecision, SubTask, TaskKind, TraceEvent, Verdict } from '../types';
import { NoEligibleModelError, routeSubTask } from './route';
import { verify } from './verify';
import { asTraceEvent } from './events';
import type { McpTransport } from './mcp';
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
import { listToolOverrides } from '../store/tools';
import { getConnectedAccountId } from '../store/connections';

/** Output of an earlier sub-task, threaded into dependents' prompts. The
 * toolDerived taint must propagate: model output built on tool output is
 * itself "derived from tool output" for the §8 cache-scoping rule. */
export interface PriorOutput {
  content: string;
  toolDerived: boolean;
}

export interface ExecuteContext {
  env: Env;
  db: D1Database;
  policy: Policy;
  candidates: ModelCandidate[];
  userId: string;
  emit: (e: TraceEvent) => void;
  /** Planner-facing toolkit tokens of the user's enabled MCPs (pipeline/mcp.ts). */
  mcpToolkits?: ReadonlySet<string>;
  /** MCP call transport — absent means "not implemented", never a crash. */
  mcpTransport?: McpTransport;
  /** Outputs of already-executed sub-tasks, keyed by sub-task id. */
  priorOutputs?: ReadonlyMap<string, PriorOutput>;
  /** Connection-required pause (run.do.ts implements this): emits
   * `connection_required`, then blocks until the user connects the toolkit
   * ('connected'), skips, or the pause times out ('skipped'). The DO emits
   * `run_resumed` itself before resolving. Absent (tests, callers without a
   * DO) means the legacy behavior: an error trace + fail_tool. */
  waitForConnection?: (toolkit: string, subTaskId: string) => Promise<'connected' | 'skipped'>;
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
  /** Final (last-hop) model output, for dependency threading. */
  output: string;
  /** True when `output` is derived from tool output — see PriorOutput. */
  toolDerived: boolean;
}

// Builtins always allowed; everything else is validated against the live
// Composio catalog (memory/D1-cached, ~ms) — /api/connect works for all
// 1,200+ toolkits now, so a hardcoded github/gmail allowlist here silently
// killed the connection-required pause for every other app (found live:
// "post a discord update" skipped instead of pausing on Connect Discord).
const COMPOSIO_BUILTINS: ReadonlySet<string> = new Set(['github', 'gmail']);

async function isComposioToolkit(env: Env, toolkit: string): Promise<boolean> {
  if (COMPOSIO_BUILTINS.has(toolkit)) return true;
  try {
    const { toolkits } = await getToolkitCatalog(env);
    return toolkits.some((t) => t.slug === toolkit);
  } catch {
    return false; // catalog unavailable — behave like the old allowlist
  }
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

// The frontier generalist (GLM-5.2) is a REASONING model: it spends its
// budget on a `reasoning` block before any `content` appears. Measured live
// (2026-08-15): at max_tokens=256 it returns finish_reason=length with EMPTY
// content (fail_empty); at 1024 it finishes reasoning and answers, but a live
// run measured 1005 completion tokens — too close to the cap. 2048 buys real
// margin; max_tokens is a cap, cost is actual usage, so the headroom only
// pays for tokens actually produced.
const REASONING_HEADROOM_TOKENS = 2048;

function maxTokensFor(policy: Policy, model: ModelCandidate, kind: TaskKind): number {
  const base = MAX_TOKENS_BY_KIND[kind];
  return model.id === policy.baselines.frontier ? Math.max(base, REASONING_HEADROOM_TOKENS) : base;
}

// Bounds on context blocks spliced into the user message — max_tokens is the
// biggest cost lever (SPEC.md §9.6) and prompt size is the other half of it.
const MAX_TOOL_CONTEXT_CHARS = 4000;
const MAX_DEP_CONTEXT_CHARS = 2000;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

function buildMessages(subTask: SubTask, contextBlocks: string[]): FeatherlessMessage[] {
  const content = [...contextBlocks, subTask.instruction].join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT_BY_KIND[subTask.kind] },
    { role: 'user', content },
  ];
}

interface Attempt {
  decision: RouteDecision;
  hop: Hop;
  content: string;
  toolDerived: boolean;
  toolStatus?: ToolOutcome['status'];
  toolCall?: ToolCallResult;
}

export async function executeSubTask(ctx: ExecuteContext, subTask: SubTask): Promise<ExecuteResult> {
  const candidatesById = new Map(ctx.candidates.map((c) => [c.id, c]));

  // Policy/catalog drift (a re-swept policy.json promoting a model the live
  // roster doesn't carry) must degrade to the generalist rung, not kill the
  // run — rung 1 runs as the primary then, and there is no rung left to
  // escalate to.
  let primary: Attempt;
  let primaryRanOnFallbackRung = false;
  try {
    primary = await attempt(ctx, subTask, candidatesById, 0, undefined);
  } catch (err) {
    if (!(err instanceof NoEligibleModelError)) throw err;
    primary = await attempt(ctx, subTask, candidatesById, 1, undefined);
    primaryRanOnFallbackRung = true;
  }
  const hops: Hop[] = [primary.hop];
  const toolCalls: ToolCallResult[] = primary.toolCall ? [primary.toolCall] : [];
  const resultOf = (a: Attempt): ExecuteResult => ({ hops, toolCalls, output: a.content, toolDerived: a.toolDerived });

  if (primary.hop.verdict === 'pass') return resultOf(primary);
  // A missing/revoked connection is not fixable by a bigger model — escalating
  // would just fail the tool again and burn a hop. The error event was already
  // emitted by runTool.
  if (primary.toolStatus === 'no_connection') return resultOf(primary);
  // The primary already ran on the escalation rung — re-routing the same rung
  // would just repeat the same model.
  if (primaryRanOnFallbackRung) return resultOf(primary);

  // Exactly one rung of escalation — never a third attempt, and if no rung 1
  // is defined/eligible we stop here on the primary's verdict.
  let escalated: Attempt;
  try {
    escalated = await attempt(ctx, subTask, candidatesById, 1, primary.hop.modelId);
  } catch (err) {
    if (err instanceof NoEligibleModelError) return resultOf(primary);
    throw err;
  }
  ctx.emit({ t: 'escalate', from: primary.hop.modelId, to: escalated.decision.modelId, reason: primary.hop.verdict });
  hops.push(escalated.hop);
  if (escalated.toolCall) toolCalls.push(escalated.toolCall);

  return resultOf(escalated);
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
  const outcome = await runModel(ctx, subTask, model, hopId, escalatedFrom, toolOutcome);

  ctx.emit({ t: 'hop_end', hop: outcome.hop });
  await recordVerdict(ctx.db, model.id, subTask.kind, outcome.hop.verdict);
  return {
    decision,
    hop: outcome.hop,
    content: outcome.content,
    toolDerived: outcome.toolDerived,
    ...(toolOutcome ? { toolStatus: toolOutcome.status } : {}),
    ...(toolOutcome?.status === 'ran' ? { toolCall: toolOutcome.call } : {}),
  };
}

type ToolOutcome =
  | { status: 'ran'; ok: boolean; output: unknown; call: ToolCallResult }
  | { status: 'skipped' } // tool_skipped already emitted
  | { status: 'no_connection' }; // error already emitted

async function runTool(ctx: ExecuteContext, subTask: SubTask): Promise<ToolOutcome | undefined> {
  if (!subTask.needsTools || !subTask.toolCall) return undefined;
  const { toolkit, tool } = subTask.toolCall;

  const skip = (reason: string): ToolOutcome => {
    ctx.emit(asTraceEvent({ t: 'tool_skipped', toolkit, tool, reason }));
    return { status: 'skipped' };
  };

  // User-defined MCP toolkit — call through the transport when one exists,
  // otherwise skip cleanly (pipeline/mcp.ts explains why there is no default
  // transport yet).
  if (ctx.mcpToolkits?.has(toolkit)) {
    if (await isToolDisabled(ctx, toolkit, tool)) return skip('disabled by user');
    if (!ctx.mcpTransport) return skip('mcp transport not implemented');
    const started = Date.now();
    const result = await ctx.mcpTransport.call(toolkit, tool, subTask.toolCall.args);
    const call = await buildCallRow(ctx, subTask, false, Date.now() - started);
    ctx.emit({ t: 'tool_call', toolkit, tool, cacheHit: false, ms: call.latencyMs });
    return { status: 'ran', ok: result.ok, output: result.output, call };
  }

  // Plans are cached globally (L3), so a plan minted for one user can name a
  // toolkit another user doesn't have (e.g. someone else's MCP) — skip it for
  // this user instead of firing a doomed Composio call.
  if (!(await isComposioToolkit(ctx.env, toolkit))) return skip('toolkit not available for this user');

  if (await isToolDisabled(ctx, toolkit, tool)) return skip('disabled by user');

  // Live mode only: a Composio call executes against the actor's connected
  // account, so a missing/revoked connection is checked before any network
  // call — never a crash mid-run. Stub mode (no API key) has no real
  // connections to check. With a waitForConnection callback (the DO run
  // path), a missing connection PAUSES the run until the user connects or
  // skips; without one, it surfaces as the legacy trace error.
  if (ctx.env.COMPOSIO_API_KEY) {
    let connectedAccountId = await getConnectedAccountId(ctx.db, ctx.userId, toolkit);
    if (!connectedAccountId && ctx.waitForConnection) {
      const resolution = await ctx.waitForConnection(toolkit, subTask.id);
      if (resolution === 'skipped') return skip('connection not linked — skipped');
      // 'connected' — the DO verified the connection exists before resuming;
      // re-read it here to execute against the fresh account.
      connectedAccountId = await getConnectedAccountId(ctx.db, ctx.userId, toolkit);
    }
    if (!connectedAccountId) {
      ctx.emit({
        t: 'error',
        message: `no active ${toolkit} connection for this user — connect it and retry`,
      });
      return { status: 'no_connection' };
    }
  }

  const params = { userId: ctx.userId, toolkit, tool, args: subTask.toolCall.args };
  const started = Date.now();

  const cached = await getTool<{ ok: boolean; output: unknown }>(ctx.db, params);
  let ok: boolean;
  let output: unknown;
  if (cached) {
    ({ ok, output } = cached);
  } else {
    const result = await executeTool(ctx.env, params);
    ({ ok, output } = result);
    await putTool(ctx.db, params, { ok, output });
  }

  const latencyMs = Date.now() - started;
  const call = await buildCallRow(ctx, subTask, Boolean(cached), latencyMs);
  ctx.emit({ t: 'tool_call', toolkit, tool, cacheHit: Boolean(cached), ms: latencyMs });
  return { status: 'ran', ok, output, call };
}

// user_tools convention (from the UI): toolkits with a known static tool list
// (github/gmail) get per-tool rows; other toolkits use tool='*' meaning "all
// tools of this toolkit". Per-tool rows take precedence over '*' when both
// exist; no row at all means enabled. store/tools.ts's isToolEnabled defaults
// to true on a missing row, so it cannot express the '*' precedence — the
// precedence lives here over the raw listToolOverrides rows instead.
async function isToolDisabled(ctx: ExecuteContext, toolkit: string, tool: string): Promise<boolean> {
  const overrides = await listToolOverrides(ctx.db, ctx.userId);
  const exact = overrides.find((o) => o.toolkit === toolkit && o.tool === tool);
  if (exact) return !exact.enabled;
  const wildcard = overrides.find((o) => o.toolkit === toolkit && o.tool === '*');
  if (wildcard) return !wildcard.enabled;
  return false; // default-on
}

async function buildCallRow(
  ctx: ExecuteContext,
  subTask: SubTask,
  cacheHit: boolean,
  latencyMs: number
): Promise<ToolCallResult> {
  const { toolkit, tool, args } = subTask.toolCall!;
  const argsHash = await toolCacheKey({ userId: ctx.userId, toolkit, tool, args });
  return { subTaskId: subTask.id, toolkit, tool, argsHash, cacheHit, latencyMs };
}

function contextBlocks(ctx: ExecuteContext, subTask: SubTask, toolOutcome: ToolOutcome | undefined): {
  blocks: string[];
  toolDerived: boolean;
} {
  const blocks: string[] = [];
  let toolDerived = false;

  for (const depId of subTask.dependsOn) {
    const dep = ctx.priorOutputs?.get(depId);
    if (!dep) continue;
    blocks.push(`Result of an earlier step:\n${truncate(dep.content, MAX_DEP_CONTEXT_CHARS)}`);
    toolDerived ||= dep.toolDerived;
  }

  if (toolOutcome?.status === 'ran' && toolOutcome.ok) {
    const { toolkit, tool } = subTask.toolCall!;
    blocks.push(
      `Output of tool ${toolkit}.${tool}:\n${truncate(JSON.stringify(toolOutcome.output), MAX_TOOL_CONTEXT_CHARS)}`
    );
    toolDerived = true;
  }

  return { blocks, toolDerived };
}

async function runModel(
  ctx: ExecuteContext,
  subTask: SubTask,
  model: ModelCandidate,
  hopId: string,
  escalatedFrom: string | undefined,
  toolOutcome: ToolOutcome | undefined
): Promise<{ hop: Hop; content: string; toolDerived: boolean }> {
  const started = Date.now();
  const maxTokens = maxTokensFor(ctx.policy, model, subTask.kind);
  const { blocks, toolDerived } = contextBlocks(ctx, subTask, toolOutcome);
  const messages = buildMessages(subTask, blocks);
  const cacheParams = {
    modelId: model.id,
    prompt: messages.map((m) => `${m.role}:${m.content}`).join('\n'),
    temperature: 0,
    maxTokens,
    seed: 42,
  };
  // §8 scoping rule: the global L1 tier must never store model output derived
  // from tool output (directly, or transitively via a dependency's output).
  // The user-scoped run cache still amortizes these calls.
  const l1Allowed = !toolDerived;

  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheHit: Hop['cacheHit'] = 'none';
  let verdict: Verdict;

  try {
    const exactHit = l1Allowed
      ? await getExact<{ content: string; promptTokens: number; completionTokens: number }>(ctx.db, cacheParams)
      : null;
    if (exactHit) {
      ({ content, promptTokens, completionTokens } = exactHit);
      cacheHit = 'exact';
    } else {
      const result = await callFeatherless(ctx.env, { modelId: model.id, messages, maxTokens });
      ({ content, promptTokens, completionTokens } = result);
      if (l1Allowed) await putExact(ctx.db, cacheParams, { content, promptTokens, completionTokens });
    }
    verdict = verify({
      kind: subTask.kind,
      output: content,
      needsTools: subTask.needsTools,
      // 'skipped' leaves toolOk undefined on purpose: a deliberately skipped
      // tool is not a tool failure, the model just answers without tool data.
      ...(toolOutcome?.status === 'ran' ? { toolOk: toolOutcome.ok } : {}),
      ...(toolOutcome?.status === 'no_connection' ? { toolOk: false } : {}),
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
  return { hop, content, toolDerived };
}
