// Understudy — shared contract, mirrored from worker/src/types.ts (via
// ui/src/types.ts). worker, ui, and expo are separate packages, so this is a
// COPY — keep it identical in shape to the others. See SPEC.md §4.

export type TaskKind = 'classify' | 'extract_fields' | 'summarize' | 'normalize';

export interface SubTask {
  id: string;
  idx: number;
  kind: TaskKind;
  instruction: string;
  ctxNeeded: number;
  needsTools: boolean;
  toolCall?: { toolkit: string; tool: string; args: Record<string, unknown> };
  dependsOn: string[];
  sensitive: boolean;
}

export interface Plan {
  subTasks: SubTask[];
}

export interface RouteDecision {
  subTaskId: string;
  modelId: string;
  score: number;
  reasons: string[];
  ladderPosition: number;
  candidatesConsidered: number;
}

export type Verdict = 'pass' | 'fail_schema' | 'fail_grounding' | 'fail_empty' | 'fail_tool' | 'fail_cold';

export interface Hop {
  id: string;
  subTaskId: string;
  modelId: string;
  modelClass: string;
  paramsB: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  availability: string;
  verdict: Verdict;
  escalatedFrom?: string;
  cacheHit: 'none' | 'exact' | 'plan' | 'tool';
}

export type AttachmentKind = 'file' | 'clipboard-image' | 'clipboard-text';

export interface RunAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  size?: number;
  mimeType?: string;
}

export type TraceEvent =
  | { t: 'run_start'; runId: string; userId: string; text: string; source: 'text' | 'voice'; attachments?: RunAttachment[] }
  | { t: 'transcript'; raw: string; final: boolean }
  | { t: 'normalized'; from: string; to: string; ms: number; modelId: string }
  | { t: 'plan'; plan: Plan; cacheHit: boolean; ms: number }
  | { t: 'route'; decision: RouteDecision }
  | { t: 'hop_start'; hop: Pick<Hop, 'id' | 'subTaskId' | 'modelId' | 'paramsB'> }
  | { t: 'hop_end'; hop: Hop }
  | { t: 'tool_call'; toolkit: string; tool: string; cacheHit: boolean; ms: number }
  | { t: 'escalate'; from: string; to: string; reason: Verdict }
  | { t: 'run_end'; runId: string; totalCostUsd: number; totalMs: number; baselineCostUsd: number; savingsPct: number }
  | { t: 'error'; message: string };
