// CitizenCall — shared contract. Write this first; both worker and UI depend on it.
// Mirrors SPEC.md §4. The UI imports the trace/hop/route types from here.

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
  | { t: 'run_start'; runId: string; userId: string; text: string; source: 'text' | 'voice' }
  | { t: 'transcript'; raw: string; final: boolean } // ← S2T
  | { t: 'normalized'; from: string; to: string; ms: number; modelId: string }
  | { t: 'plan'; plan: Plan; cacheHit: boolean; cacheKind?: 'exact' | 'semantic'; ms: number }
  | { t: 'route'; decision: RouteDecision }
  | { t: 'hop_start'; hop: Pick<Hop, 'id' | 'subTaskId' | 'modelId' | 'paramsB'> }
  | { t: 'hop_end'; hop: Hop }
  | { t: 'tool_call'; toolkit: string; tool: string; cacheHit: boolean; ms: number }
  | { t: 'escalate'; from: string; to: string; reason: Verdict }
  | { t: 'cache_hit'; runId: string; cachedAt: number; ageMs: number }
  | { t: 'tool_skipped'; toolkit: string; tool: string; reason: string }
  // A streamed chunk of the FINAL sub-task's model output — live runs only.
  // Coalesced to ~10 events/sec worker-side; never recorded into the run
  // cache (replays emit only the final `answer`). The `answer` event that
  // always follows carries the FULL text and the UI reconciles to it, so a
  // dropped or duplicated delta can never corrupt the displayed reply.
  | { t: 'answer_delta'; subTaskId: string; text: string }
  // The final sub-task's model output — the user-visible reply bubble.
  | { t: 'answer'; subTaskId: string; text: string }
  // Agent auto-wrote a user memory after this run (memory/*, memory-hook.ts).
  // Emitted before run_end (the stream closes on run_end) and never recorded
  // into the run cache, so replays don't re-announce a stale save.
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
