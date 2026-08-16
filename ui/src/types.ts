// CitizenCall — shared contract, mirrored from worker/src/types.ts.
// ui and worker are separate packages, so this is a COPY — keep it identical
// to worker/src/types.ts. See SPEC.md §4.

export type TaskKind = 'classify' | 'extract_fields' | 'summarize' | 'normalize';
// normalize is voice-only and OPTIONAL — see SPEC.md §7.4

export interface TaskInstance {
  id: string;
  kind: TaskKind;
  instruction: string;
  input: string;
  gold: unknown; // label | reference JSON | must-contain facts
  split: 'held_in' | 'held_out';
}

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

export interface ModelCandidate {
  id: string;
  modelClass: string;
  contextLength: number;
  paramsB: number;
  pricePerMTokIn: number; // PULL LIVE — see SPEC.md §5.2
  pricePerMTokOut: number;
  concurrencyCost: number; // from API, never inferred
  availability: 'warm' | 'loading' | 'cold' | 'offline' | 'unknown';
  isHotLive: boolean;
  toolUse: boolean;
  availableOnPlan: boolean;
  hfDownloads?: number;
}

export interface RouteDecision {
  subTaskId: string;
  modelId: string;
  score: number;
  reasons: string[]; // rendered in the UI — write for humans
  ladderPosition: number; // 0 primary, 1 escalation (max 1)
  candidatesConsidered: number;
}

export type Verdict =
  | 'pass'
  | 'fail_schema'
  | 'fail_grounding'
  | 'fail_empty'
  | 'fail_tool'
  | 'fail_cold';

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

export type TraceEvent =
  | {
      t: 'run_start';
      runId: string;
      userId: string;
      text: string;
      source: 'text' | 'voice';
      // ui-only addition — attachments picked up in CommandBar (drag-drop +
      // clipboard). Not yet in worker/src/types.ts; optional so live-mode
      // payloads without it still validate. See DropZone.tsx / CommandBar.tsx.
      attachments?: RunAttachment[];
    }
  | { t: 'transcript'; raw: string; final: boolean } // ← S2T
  | { t: 'normalized'; from: string; to: string; ms: number; modelId: string }
  | { t: 'plan'; plan: Plan; cacheHit: boolean; cacheKind?: 'exact' | 'semantic'; ms: number }
  | { t: 'route'; decision: RouteDecision }
  | { t: 'hop_start'; hop: Pick<Hop, 'id' | 'subTaskId' | 'modelId' | 'paramsB'> }
  | { t: 'hop_end'; hop: Hop }
  | { t: 'tool_call'; toolkit: string; tool: string; cacheHit: boolean; ms: number }
  | { t: 'escalate'; from: string; to: string; reason: Verdict }
  // A streamed chunk of the FINAL sub-task's answer (live runs only; mirrors
  // worker/src/types.ts). The `answer` event that follows carries the FULL
  // text and the reducer reconciles to it, so deltas can never desync.
  | { t: 'answer_delta'; subTaskId: string; text: string }
  | { t: 'answer'; subTaskId: string; text: string }
  // Agent auto-wrote a user memory after this run (worker memory-hook.ts);
  // arrives just before run_end. Rendered as a small note, viewable at /memory.
  | { t: 'memory_saved'; memoryId: string; title: string }
  // Connection-required pause: the run is waiting for the user to connect a
  // toolkit (or skip). Status stays 'running'; run_resumed always follows.
  | { t: 'connection_required'; toolkit: string; subTaskId: string }
  | { t: 'run_resumed'; toolkit: string; skipped: boolean }
  | {
      t: 'run_end';
      runId: string;
      totalCostUsd: number;
      totalMs: number;
      baselineCostUsd: number;
      savingsPct: number;
    }
  | { t: 'error'; message: string };

export interface Policy {
  version: string;
  generatedAt: string;
  weights: { quality: number; cost: number }; // latency dropped — SPEC.md §9
  ladders: Record<TaskKind, string[]>; // length ≤ 2
  quality: Record<string, Partial<Record<TaskKind, number>>>; // keyed by MODEL_ID
  qualityCI: Record<string, Partial<Record<TaskKind, [number, number]>>>; // Wilson
  baselines: { frontier: string; cheapDefault: string };
  margin: Record<TaskKind, number>; // δ, set BY sample size
}

// ---- UI-only types (not part of the worker contract) ----

/** A per-user memory row served by /api/memories (worker memory/routes.ts).
 * `contentMd` may reference other memories as [[title-or-id]] and tools as
 * @toolkit — the /memory page renders those as clickable jumps. */
export interface UserMemory {
  id: string;
  title: string;
  contentMd: string;
  source: 'agent' | 'user';
  createdAt: number;
  updatedAt: number;
}

/** GET /api/memories/:id — the memory plus its cycle-safely resolved links. */
export interface UserMemoryDetail extends UserMemory {
  links: {
    memories: Array<{ id: string; title: string }>;
    tools: string[];
    unresolved: string[];
    truncated: boolean;
  };
}

export type AttachmentKind = 'file' | 'clipboard-image' | 'clipboard-text';

/** A file or clipboard blob attached to the command bar before a run starts
 * — CommandBar.tsx (drag-drop + clipboard read) and mock/scenario.ts. Only
 * metadata crosses the wire; raw bytes stay client-side for this demo. */
export interface RunAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  size?: number;
  mimeType?: string;
}

export interface RosterEntry {
  taskKind: TaskKind;
  modelId: string;
  modelClass: string;
  promotedAt: number;
  accuracy: number;
  ciLo: number;
  ciHi: number;
  costPer1k: number;
  displacedModelId: string;
  hfDownloads: number;
}

export interface BenchmarkBar {
  label: string;
  accuracy: number;
  costPer1k: number;
}

export interface BenchmarkResult {
  generatedAt: string;
  baselines: {
    glm_only: BenchmarkBar;
    glm_verify: BenchmarkBar;
    cheap_default: BenchmarkBar;
    understudy: BenchmarkBar;
  };
  perKind: Array<{
    kind: TaskKind;
    promoted: string;
    accuracy: number;
    ci: [number, number];
    validity: number;
    incumbent: string;
    incumbentAccuracy: number;
    heldInAccuracy: number;
    heldOutAccuracy: number;
    costEffectiveRatio: number;
    n: number;
  }>;
  note?: string;
}
