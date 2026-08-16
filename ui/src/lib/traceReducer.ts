import type { Hop, RouteDecision, RunAttachment, SubTask, TraceEvent } from '../types';

/** One rung of the escalation ladder for a sub-task: route decision, the
 * hop that started (optimistic) and the hop that ended (settled). */
export interface RungState {
  subTaskId: string;
  decision?: RouteDecision;
  hopStart?: Pick<Hop, 'id' | 'subTaskId' | 'modelId' | 'paramsB'>;
  hop?: Hop;
  escalatedFrom?: string;
}

/** Connection-required pause state for the active turn — set by
 * `connection_required`, settled by `run_resumed`. ConversationTurn renders
 * the "Connect <App> to continue" card while `status === 'waiting'` and a
 * collapsed one-line note once resumed. */
export interface ConnectionGate {
  toolkit: string;
  subTaskId: string;
  status: 'waiting' | 'resumed';
  skipped?: boolean;
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
  /** The final sub-task's model output — the user-visible reply bubble.
   * On live runs this accumulates from `answer_delta` chunks, then the
   * final `answer` event replaces it wholesale with the authoritative full
   * text (so a dropped/duplicated delta can never corrupt the reply). */
  answerText?: string;
  /** True once any `answer_delta` arrived — the answer painted live, so
   * AnswerBubble must render it raw (caret while running) instead of
   * replaying the client-side typewriter over already-seen text. */
  answerStreamed?: boolean;
  /** Set by `memory_saved` — the agent stored a memory after this run.
   * Rendered (if at all) as a small "memory saved" note linking to /memory;
   * ConversationTurn may ignore it, the default case already tolerated it. */
  memorySaved?: { memoryId: string; title: string };
  connectionGate?: ConnectionGate;
  runEnd?: { totalCostUsd: number; totalMs: number; baselineCostUsd: number; savingsPct: number };
  error?: string;
  /** Bumped on every `escalate` event — CommandBar watches this to spike
   * the conic border's spin speed for 400ms. DESIGN.md §5 Command bar. */
  escalateTick: number;
  /** The model a rung is escalating TO, paired with `escalateTick` — the
   * `escalate` TraceEvent carries `to` but nothing else stored it. Chat
   * redesign's StatusLine reads this for "escalating to <model>…". */
  escalateTarget?: string;
  /** Set by the UI-only `stop_turn` conversation action (never a wire
   * TraceEvent) when the user hits Stop mid-run — status flips to 'done'
   * with whatever arrived. TraceSummaryRow renders "· stopped" instead of
   * cost/savings when this is set and `runEnd` never landed. */
  stoppedByUser?: boolean;
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
  // `subTaskId` spread LAST so it stays a definite string even when the
  // Partial patch carries an (undefined) one — keeps the file compiling
  // under exactOptionalPropertyTypes (worker tests import this reducer).
  if (idx === -1) {
    nextRungs.push({ ...patch, subTaskId });
  } else {
    nextRungs[idx] = { ...nextRungs[idx], ...patch, subTaskId };
  }
  return {
    ...state,
    rungsBySubTask: { ...state.rungsBySubTask, [subTaskId]: nextRungs },
  };
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
      return {
        ...state,
        normalize: {
          from: event.from,
          to: event.to,
          ms: event.ms,
          modelId: event.modelId,
          revealed: false,
        },
      };

    case 'plan':
      return {
        ...state,
        plan: { subTasks: event.plan.subTasks, cacheHit: event.cacheHit, ms: event.ms },
        subTaskOrder: event.plan.subTasks.map((s) => s.id),
        normalize: state.normalize ? { ...state.normalize, revealed: true } : state.normalize,
      };

    case 'route':
      return upsertRung(
        state,
        event.decision.subTaskId,
        { decision: event.decision },
        (rungs) => rungs.findIndex((r) => !r.decision),
      );

    case 'hop_start':
      return upsertRung(
        state,
        event.hop.subTaskId,
        { hopStart: event.hop },
        (rungs) => rungs.findIndex((r) => r.decision && !r.hopStart),
      );

    case 'hop_end':
      return upsertRung(
        state,
        event.hop.subTaskId,
        { hop: event.hop },
        (rungs) => rungs.findIndex((r) => r.hopStart?.id === event.hop.id),
      );

    case 'tool_call':
      return { ...state, lastToolCall: { toolkit: event.toolkit, tool: event.tool, at: Date.now() } };

    case 'escalate': {
      // The next route() for this sub-task will carry the new rung; stash
      // escalatedFrom on a fresh empty rung so HopCard can render the arrow
      // immediately, before the route decision arrives.
      const subTaskId = Object.keys(state.rungsBySubTask).find((id) =>
        (state.rungsBySubTask[id] ?? []).some((r) => r.hop?.modelId === event.from),
      );
      if (!subTaskId) return state;
      const rungs = state.rungsBySubTask[subTaskId] ?? [];
      const failedRung = rungs.find((r) => r.hop?.modelId === event.from);
      return {
        ...state,
        rungsBySubTask: {
          ...state.rungsBySubTask,
          [subTaskId]: [...rungs, { subTaskId, escalatedFrom: failedRung?.hop?.id }],
        },
        // The failed rung's streamed text is discarded — the escalation rung
        // streams fresh deltas (or delivers a whole `answer`).
        answerText: undefined,
        escalateTick: state.escalateTick + 1,
        escalateTarget: event.to,
      };
    }

    case 'answer_delta':
      return { ...state, answerText: (state.answerText ?? '') + event.text, answerStreamed: true };

    case 'answer':
      // Reconcile: the full authoritative text replaces accumulated deltas.
      return { ...state, answerText: event.text };

    case 'memory_saved':
      return { ...state, memorySaved: { memoryId: event.memoryId, title: event.title } };

    case 'connection_required':
      return {
        ...state,
        connectionGate: { toolkit: event.toolkit, subTaskId: event.subTaskId, status: 'waiting' },
      };

    case 'run_resumed':
      return {
        ...state,
        connectionGate: {
          toolkit: event.toolkit,
          subTaskId: state.connectionGate?.subTaskId ?? '',
          status: 'resumed',
          skipped: event.skipped,
        },
      };

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

// ---- Multi-turn conversation state ----
//
// The chat transcript is an ordered list of turns; each turn owns its own
// TraceState, driven by the same `traceReducer` above. A submit always
// starts a fresh turn (`start_turn`); every TraceEvent from that point on
// is routed to the LAST turn in the list (`trace_event`) until the next
// `start_turn` moves the target forward. This mirrors `startRun` being
// called once per submit — the reducer never needs to know which run an
// event belongs to, only that it belongs to "whatever is currently last".

export interface Turn {
  id: string;
  prompt: string;
  source: 'text' | 'voice';
  trace: TraceState;
}

export interface ConversationState {
  turns: Turn[];
}

export type ConversationAction =
  | { type: 'start_turn'; id: string; prompt: string; source: 'text' | 'voice' }
  | { type: 'trace_event'; event: TraceEvent }
  // UI-only action (never a wire TraceEvent — that union mirrors the worker
  // contract and stays untouched) — Bar.tsx's Stop button closes the
  // RunHandle and dispatches this to freeze the last turn's trace in place.
  | { type: 'stop_turn' };

export function initialConversationState(): ConversationState {
  return { turns: [] };
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  if (action.type === 'start_turn') {
    const turn: Turn = { id: action.id, prompt: action.prompt, source: action.source, trace: initialTraceState() };
    return { turns: [...state.turns, turn] };
  }

  const lastIdx = state.turns.length - 1;
  const lastTurn = state.turns[lastIdx];
  if (!lastTurn) return state;

  if (action.type === 'stop_turn') {
    if (lastTurn.trace.status !== 'running') return state;
    const nextTurns = [...state.turns];
    nextTurns[lastIdx] = { ...lastTurn, trace: { ...lastTurn.trace, status: 'done', stoppedByUser: true } };
    return { ...state, turns: nextTurns };
  }

  // trace_event — apply to the last turn only. Events arriving with no
  // turn yet (shouldn't happen — start_turn always precedes startRun) are
  // dropped rather than crashing the reducer.
  const nextTurns = [...state.turns];
  nextTurns[lastIdx] = { ...lastTurn, trace: traceReducer(lastTurn.trace, action.event) };
  return { ...state, turns: nextTurns };
}
