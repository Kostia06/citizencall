// Ported from ui/src/lib/traceReducer.ts — pure state-machine logic, no DOM
// dependency, so this is a straight port. Keep in sync with the web version;
// see that file's comments for the design rationale behind each case.
import type { Hop, RouteDecision, RunAttachment, SubTask, TraceEvent } from '../types/contract';

export interface RungState {
  subTaskId: string;
  decision?: RouteDecision;
  hopStart?: Pick<Hop, 'id' | 'subTaskId' | 'modelId' | 'paramsB'>;
  hop?: Hop;
  escalatedFrom?: string;
}

export interface TraceState {
  status: 'idle' | 'running' | 'done' | 'error';
  runId?: string;
  source: 'text' | 'voice';
  requestText: string;
  attachments: RunAttachment[];
  transcript?: { raw: string; final: boolean };
  normalize?: { from: string; to: string; ms: number; modelId: string; revealed: boolean };
  plan?: { subTasks: SubTask[]; cacheHit: boolean; ms: number };
  subTaskOrder: string[];
  rungsBySubTask: Record<string, RungState[]>;
  lastToolCall?: { toolkit: string; tool: string; at: number };
  runEnd?: { totalCostUsd: number; totalMs: number; baselineCostUsd: number; savingsPct: number };
  error?: string;
  escalateTick: number;
}

export function initialTraceState(): TraceState {
  return {
    status: 'idle',
    source: 'text',
    requestText: '',
    attachments: [],
    subTaskOrder: [],
    rungsBySubTask: {},
    escalateTick: 0,
  };
}

function upsertRung(
  state: TraceState,
  subTaskId: string,
  patch: Partial<RungState>,
  matchRungIndex: (rungs: RungState[]) => number,
): TraceState {
  const rungs = state.rungsBySubTask[subTaskId] ?? [];
  const idx = matchRungIndex(rungs);
  const nextRungs = [...rungs];
  if (idx === -1) {
    nextRungs.push({ subTaskId, ...patch });
  } else {
    nextRungs[idx] = { ...nextRungs[idx], ...patch };
  }
  return { ...state, rungsBySubTask: { ...state.rungsBySubTask, [subTaskId]: nextRungs } };
}

export function traceReducer(state: TraceState, event: TraceEvent): TraceState {
  switch (event.t) {
    case 'run_start':
      return {
        ...initialTraceState(),
        status: 'running',
        runId: event.runId,
        source: event.source,
        requestText: event.text,
        attachments: event.attachments ?? [],
      };

    case 'transcript':
      return { ...state, transcript: { raw: event.raw, final: event.final } };

    case 'normalized':
      return { ...state, normalize: { from: event.from, to: event.to, ms: event.ms, modelId: event.modelId, revealed: false } };

    case 'plan':
      return {
        ...state,
        plan: { subTasks: event.plan.subTasks, cacheHit: event.cacheHit, ms: event.ms },
        subTaskOrder: event.plan.subTasks.map((s) => s.id),
        normalize: state.normalize ? { ...state.normalize, revealed: true } : state.normalize,
      };

    case 'route':
      return upsertRung(state, event.decision.subTaskId, { decision: event.decision }, (rungs) =>
        rungs.findIndex((r) => !r.decision),
      );

    case 'hop_start':
      return upsertRung(state, event.hop.subTaskId, { hopStart: event.hop }, (rungs) =>
        rungs.findIndex((r) => r.decision && !r.hopStart),
      );

    case 'hop_end':
      return upsertRung(state, event.hop.subTaskId, { hop: event.hop }, (rungs) =>
        rungs.findIndex((r) => r.hopStart?.id === event.hop.id),
      );

    case 'tool_call':
      return { ...state, lastToolCall: { toolkit: event.toolkit, tool: event.tool, at: Date.now() } };

    case 'escalate': {
      const subTaskId = Object.keys(state.rungsBySubTask).find((id) =>
        state.rungsBySubTask[id].some((r) => r.hop?.modelId === event.from),
      );
      if (!subTaskId) return state;
      const rungs = state.rungsBySubTask[subTaskId];
      const failedRung = rungs.find((r) => r.hop?.modelId === event.from);
      return {
        ...state,
        rungsBySubTask: { ...state.rungsBySubTask, [subTaskId]: [...rungs, { subTaskId, escalatedFrom: failedRung?.hop?.id }] },
        escalateTick: state.escalateTick + 1,
      };
    }

    case 'run_end':
      return {
        ...state,
        status: 'done',
        runEnd: {
          totalCostUsd: event.totalCostUsd,
          totalMs: event.totalMs,
          baselineCostUsd: event.baselineCostUsd,
          savingsPct: event.savingsPct,
        },
      };

    case 'error':
      return { ...state, status: 'error', error: event.message };

    default:
      return state;
  }
}
