// Stage 1 — decompose. Turns normalized text into a Plan of SubTasks, checking
// the L3 plan cache first (SPEC.md §8: exact match on normalized text, global,
// plan-only — never stores tool or model output).
//
// This is a heuristic single-subtask splitter, not an LLM-based decomposer —
// multi-step planning is real scope the hackathon weekend didn't have. It's
// intentionally isolated behind this one function so swapping in a routed
// "decompose" LLM call later doesn't touch anything else in the pipeline.
import { getPlan, putPlan } from '../cache/plan';
import type { Plan, SubTask, TaskKind } from '../types';

const TOOL_HINTS: ReadonlyArray<{ pattern: RegExp; toolkit: string; tool: string }> = [
  { pattern: /\b(commit|repo|repository|pull request|\bpr\b)\b/i, toolkit: 'github', tool: 'list_commits' },
  { pattern: /\b(email|gmail|inbox)\b/i, toolkit: 'gmail', tool: 'fetch_emails' },
];

function classifyKind(text: string): TaskKind {
  if (/\b(classify|category|categorize|label)\b/i.test(text)) return 'classify';
  if (/\b(extract|field|pull out|structured)\b/i.test(text)) return 'extract_fields';
  return 'summarize';
}

function detectTool(text: string) {
  return TOOL_HINTS.find((h) => h.pattern.test(text));
}

export async function decompose(
  db: D1Database,
  normalizedText: string
): Promise<{ plan: Plan; cacheHit: boolean }> {
  const cached = await getPlan(db, normalizedText);
  if (cached) return { plan: cached, cacheHit: true };

  const kind = classifyKind(normalizedText);
  const tool = detectTool(normalizedText);
  const subTask: SubTask = {
    id: crypto.randomUUID(),
    idx: 0,
    kind,
    instruction: normalizedText,
    ctxNeeded: Math.max(512, Math.ceil(normalizedText.length / 3)),
    needsTools: Boolean(tool),
    ...(tool ? { toolCall: { toolkit: tool.toolkit, tool: tool.tool, args: {} } } : {}),
    dependsOn: [],
    sensitive: false,
  };

  const plan: Plan = { subTasks: [subTask] };
  await putPlan(db, normalizedText, plan);
  return { plan, cacheHit: false };
}
