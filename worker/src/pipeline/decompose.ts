// Stage 1 — decompose. Turns normalized text into a Plan of SubTasks with a real
// routed model call, checking the L3 plan cache first (SPEC.md §8: exact match on
// normalized text, global, plan-only — never stores tool or model output).
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
import { getPlan, putPlan } from '../cache/plan';
import { callFeatherless } from '../providers/featherless';
import type { Plan, Policy, SubTask, TaskKind } from '../types';

const MAX_SUBTASKS = 4;
const MAX_TOKENS = 384;

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
  toolkit: z.enum(['github', 'gmail']).nullish(),
  sensitive: z.boolean().optional().default(false),
});
type SubTaskDraft = z.infer<typeof SubTaskDraft>;
const PlanDraft = z.array(SubTaskDraft).min(1).max(MAX_SUBTASKS);

const SYSTEM_PROMPT = [
  'You are a task planner for an agent. Break the user request into an ordered list',
  `of 1 to ${MAX_SUBTASKS} sub-tasks. Each sub-task kind is one of: classify, extract_fields,`,
  'summarize, normalize. Reply with ONLY a JSON array, no prose and no code fences.',
  'Each element: {"kind": <kind>, "instruction": <imperative string>, "needsTools": <bool>,',
  '"toolkit": <"github"|"gmail"|null>, "sensitive": <bool>}. Set needsTools=true and toolkit',
  'when the step must read from GitHub or Gmail. Keep instructions concise and self-contained.',
].join(' ');

export async function decompose(
  env: Env,
  db: D1Database,
  policy: Policy,
  normalizedText: string
): Promise<{ plan: Plan; cacheHit: boolean }> {
  const cached = await getPlan(db, normalizedText);
  if (cached) return { plan: cached, cacheHit: true };

  const plan = (await modelPlan(env, policy, normalizedText)) ?? heuristicPlan(normalizedText);
  await putPlan(db, normalizedText, plan);
  return { plan, cacheHit: false };
}

// Returns null (not throws) on any failure so the caller falls back to the
// heuristic. A planning misfire must never take down the whole run.
async function modelPlan(env: Env, policy: Policy, text: string): Promise<Plan | null> {
  const modelId = policy.baselines.frontier;
  if (!modelId) return null;

  let content: string;
  try {
    const res = await callFeatherless(env, {
      modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      maxTokens: MAX_TOKENS,
    });
    content = res.content;
  } catch {
    return null; // cold/backpressure/capacity — heuristic covers the demo path
  }

  return planFromContent(content);
}

// Pure: model text -> validated Plan, or null on invalid/empty output. Exported
// for unit testing without a network round-trip.
export function planFromContent(content: string): Plan | null {
  const drafts = parseDrafts(content);
  if (!drafts) return null;

  const withIds = drafts.map((d) => ({ draft: d, id: crypto.randomUUID() }));
  const subTasks: SubTask[] = withIds.map(({ draft, id }, idx) => buildSubTask(draft, idx, id));
  // Sequential dependency chain — the DO executes sub-tasks in order and later
  // steps commonly consume earlier output; express that truthfully in the plan.
  for (let i = 1; i < subTasks.length; i++) {
    const cur = subTasks[i];
    const prev = subTasks[i - 1];
    if (cur && prev) cur.dependsOn = [prev.id];
  }
  return { subTasks };
}

function buildSubTask(d: SubTaskDraft, idx: number, id: string): SubTask {
  const tool = resolveTool(d.instruction, d.needsTools ? (d.toolkit ?? null) : null);
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

function resolveTool(instruction: string, toolkitHint: 'github' | 'gmail' | null) {
  const byText = TOOL_HINTS.find((h) => h.pattern.test(instruction));
  if (byText) return { toolkit: byText.toolkit, tool: byText.tool };
  if (toolkitHint) return DEFAULT_TOOL[toolkitHint];
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
