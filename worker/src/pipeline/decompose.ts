// Stage 1 — decompose. Turns normalized text into a Plan of SubTasks with a real
// routed model call, checking the L3 plan cache first (SPEC.md §8: global,
// plan-only — never stores tool or model output). L3 is two-tier: exact match
// on the normalized key (fast path, unchanged), then on exact miss a bounded
// semantic near-match over recent plan-cache rows (cache/planSemantic.ts) —
// the SPEC.md §8 "semantic L3" future work, done lexically since this stack
// has no embedding provider.
//
// The planner runs on the frontier baseline: planning is a single small-output
// call where correctness matters most, and it's amortized by the L3 cache — a
// repeated request never reaches the model. The plan call is intentionally NOT
// counted as a hop (same as the normalize stage), so it doesn't distort the
// per-sub-task routing economics the benchmark reports.
//
// If no key is set (stub), the model output isn't valid JSON, or the policy has
// no frontier model, we fall back to the heuristic single-sub-task splitter so
// the worker still produces a usable plan deterministically.
import { z } from 'zod';
import type { Env } from '../env';
import { getPlan, normalizePlanKey } from '../cache/plan';
import { findNearPlan, putPlanIndexed } from '../cache/planSemantic';
import { callFeatherless } from '../providers/featherless';
import type { Plan, Policy, SubTask, TaskKind } from '../types';

const MAX_SUBTASKS = 4;
// The planner runs on the frontier baseline, which is a reasoning model
// (GLM-5.2): it emits a `reasoning` block before `content`, and a tight cap
// yields finish_reason=length with EMPTY content — measured live 2026-08-15
// (256 → empty; ~1000 reasoning tokens observed on a short prompt). A cut-off
// planner falls back to the heuristic, but the headroom makes the real
// planner actually run. max_tokens is a cap; cost follows actual usage.
const MAX_TOKENS = 2048;

const TOOL_HINTS: ReadonlyArray<{ pattern: RegExp; toolkit: string; tool: string }> = [
  { pattern: /\b(commit|repo|repository|pull request|\bpr\b)\b/i, toolkit: 'github', tool: 'list_commits' },
  { pattern: /\b(email|gmail|inbox)\b/i, toolkit: 'gmail', tool: 'fetch_emails' },
];

// Default read tool per toolkit when the model flags a tool need but the
// instruction text doesn't match a more specific hint.
const DEFAULT_TOOL: Record<string, { toolkit: string; tool: string }> = {
  github: { toolkit: 'github', tool: 'list_commits' },
  gmail: { toolkit: 'gmail', tool: 'fetch_emails' },
};

const SubTaskDraft = z.object({
  kind: z.enum(['classify', 'extract_fields', 'summarize', 'normalize']),
  instruction: z.string().trim().min(1),
  needsTools: z.boolean().optional().default(false),
  // A free string, not an enum: the allowed set is dynamic (github/gmail plus
  // the user's enabled MCP toolkits). Unknown toolkits are dropped per
  // sub-task in resolveTool rather than nulling the whole plan — one
  // hallucinated toolkit name shouldn't discard an otherwise-good plan.
  toolkit: z.string().nullish(),
  sensitive: z.boolean().optional().default(false),
});
type SubTaskDraft = z.infer<typeof SubTaskDraft>;
const PlanDraft = z.array(SubTaskDraft).min(1).max(MAX_SUBTASKS);

const BUILTIN_TOOLKITS = ['github', 'gmail'] as const;

function systemPrompt(extraToolkits: string[]): string {
  const toolkits = [...BUILTIN_TOOLKITS, ...extraToolkits];
  const list = toolkits.map((t) => `"${t}"`).join('|');
  return [
    'You are a task planner for an agent. Break the user request into an ordered list',
    `of 1 to ${MAX_SUBTASKS} sub-tasks. Each sub-task kind is one of: classify, extract_fields,`,
    'summarize, normalize. Reply with ONLY a JSON array, no prose and no code fences.',
    'Each element: {"kind": <kind>, "instruction": <imperative string>, "needsTools": <bool>,',
    `"toolkit": <${list}|null>, "sensitive": <bool>}. Set needsTools=true and toolkit`,
    'when the step must read from one of those tools. Keep instructions concise and self-contained.',
  ].join(' ');
}

export interface DecomposeResult {
  plan: Plan;
  cacheHit: boolean;
  // How the hit was found. Additive: run.ts only reads plan/cacheHit, and the
  // wire `plan` event's cacheHit stays a boolean (types.ts is out of scope).
  cacheKind?: 'exact' | 'semantic';
}

export async function decompose(
  env: Env,
  db: D1Database,
  policy: Policy,
  normalizedText: string,
  extraToolkits: string[] = []
): Promise<DecomposeResult> {
  // A cached plan carries the sub-task ids of the run that minted it —
  // sub_tasks.id is a global PK, so EVERY cache hit (exact or semantic) must
  // re-key the plan (fresh ids, dependsOn remapped) before inserting its rows.
  const cached = await getPlan(db, normalizedText);
  if (cached) return { plan: rekeyPlan(cached), cacheHit: true, cacheKind: 'exact' };

  const key = normalizePlanKey(normalizedText);
  const near = await findNearPlan(db, key);
  if (near) {
    // Promote the borrow to an exact row under the new key (provenance in
    // borrowed_from), so the next identical prompt takes the fast path.
    await putPlanIndexed(db, key, near.plan, near.matchedKey);
    return { plan: rekeyPlan(near.plan), cacheHit: true, cacheKind: 'semantic' };
  }

  const plan = (await modelPlan(env, policy, normalizedText, extraToolkits)) ?? heuristicPlan(normalizedText);
  await putPlanIndexed(db, key, plan);
  return { plan, cacheHit: false };
}

// Returns null (not throws) on any failure so the caller falls back to the
// heuristic. A planning misfire must never take down the whole run.
async function modelPlan(env: Env, policy: Policy, text: string, extraToolkits: string[]): Promise<Plan | null> {
  const modelId = policy.baselines.frontier;
  if (!modelId) return null;

  let content: string;
  try {
    const res = await callFeatherless(env, {
      modelId,
      messages: [
        { role: 'system', content: systemPrompt(extraToolkits) },
        { role: 'user', content: text },
      ],
      maxTokens: MAX_TOKENS,
    });
    content = res.content;
  } catch {
    return null; // cold/backpressure/capacity — heuristic covers the demo path
  }

  return planFromContent(content, extraToolkits);
}

// Pure: model text -> validated Plan, or null on invalid/empty output. Exported
// for unit testing without a network round-trip.
export function planFromContent(content: string, extraToolkits: string[] = []): Plan | null {
  const drafts = parseDrafts(content);
  if (!drafts) return null;

  const allowedToolkits = new Set<string>([...BUILTIN_TOOLKITS, ...extraToolkits]);
  const withIds = drafts.map((d) => ({ draft: d, id: crypto.randomUUID() }));
  const subTasks: SubTask[] = withIds.map(({ draft, id }, idx) => buildSubTask(draft, idx, id, allowedToolkits));
  // Sequential dependency chain — the DO executes sub-tasks in order and later
  // steps commonly consume earlier output; express that truthfully in the plan.
  for (let i = 1; i < subTasks.length; i++) {
    const cur = subTasks[i];
    const prev = subTasks[i - 1];
    if (cur && prev) cur.dependsOn = [prev.id];
  }
  return { subTasks };
}

function buildSubTask(d: SubTaskDraft, idx: number, id: string, allowedToolkits: ReadonlySet<string>): SubTask {
  const hint = d.needsTools && d.toolkit && allowedToolkits.has(d.toolkit) ? d.toolkit : null;
  const tool = resolveTool(d.instruction, hint);
  return {
    id,
    idx,
    kind: d.kind as TaskKind,
    instruction: d.instruction,
    ctxNeeded: Math.max(512, Math.ceil(d.instruction.length / 3)),
    needsTools: Boolean(tool),
    ...(tool ? { toolCall: { toolkit: tool.toolkit, tool: tool.tool, args: {} } } : {}),
    dependsOn: [],
    sensitive: d.sensitive ?? false,
  };
}

function resolveTool(instruction: string, toolkitHint: string | null) {
  const byText = TOOL_HINTS.find((h) => h.pattern.test(instruction));
  if (byText) return { toolkit: byText.toolkit, tool: byText.tool };
  // MCP toolkits have no per-tool catalog yet — 'call' is the single generic
  // tool name the MCP transport (pipeline/mcp.ts) will dispatch on.
  if (toolkitHint) return DEFAULT_TOOL[toolkitHint] ?? { toolkit: toolkitHint, tool: 'call' };
  return undefined;
}

// Tolerant of code fences and of the model wrapping the array in {subTasks|plan}.
function parseDrafts(raw: string): SubTaskDraft[] | null {
  const json = extractJson(raw);
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const arr = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.subTasks)
      ? value.subTasks
      : isRecord(value) && Array.isArray(value.plan)
        ? value.plan
        : null;
  if (!arr) return null;
  const parsed = PlanDraft.safeParse(arr);
  return parsed.success ? parsed.data : null;
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

function rekeyPlan(plan: Plan): Plan {
  const idMap = new Map(plan.subTasks.map((s) => [s.id, crypto.randomUUID()]));
  return {
    subTasks: plan.subTasks.map((s) => ({
      ...s,
      id: idMap.get(s.id)!,
      dependsOn: s.dependsOn.map((d) => idMap.get(d) ?? d),
    })),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// Heuristic fallback — the original single-sub-task splitter. Kept so the worker
// degrades gracefully with no key, on invalid model output, or on planner error.
function heuristicPlan(text: string): Plan {
  const tool = TOOL_HINTS.find((h) => h.pattern.test(text));
  const subTask: SubTask = {
    id: crypto.randomUUID(),
    idx: 0,
    kind: classifyKind(text),
    instruction: text,
    ctxNeeded: Math.max(512, Math.ceil(text.length / 3)),
    needsTools: Boolean(tool),
    ...(tool ? { toolCall: { toolkit: tool.toolkit, tool: tool.tool, args: {} } } : {}),
    dependsOn: [],
    sensitive: false,
  };
  return { subTasks: [subTask] };
}

function classifyKind(text: string): TaskKind {
  if (/\b(classify|category|categorize|label)\b/i.test(text)) return 'classify';
  if (/\b(extract|field|pull out|structured)\b/i.test(text)) return 'extract_fields';
  return 'summarize';
}
