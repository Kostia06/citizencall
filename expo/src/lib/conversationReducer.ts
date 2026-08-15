// Ported from ui/src/lib/traceReducer.ts's multi-turn section — the chat
// transcript is an ordered list of turns, each driven by traceReducer. A
// submit starts a fresh turn; every TraceEvent after that targets the last
// turn until the next start_turn moves the target forward.
import type { TraceEvent } from '../types/contract';
import { initialTraceState, traceReducer, type TraceState } from './traceReducer';

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
  | { type: 'trace_event'; event: TraceEvent };

export function initialConversationState(): ConversationState {
  return { turns: [] };
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  if (action.type === 'start_turn') {
    const turn: Turn = { id: action.id, prompt: action.prompt, source: action.source, trace: initialTraceState() };
    return { turns: [...state.turns, turn] };
  }

  const lastIdx = state.turns.length - 1;
  if (lastIdx < 0) return state;
  const lastTurn = state.turns[lastIdx];
  const nextTurns = [...state.turns];
  nextTurns[lastIdx] = { ...lastTurn, trace: traceReducer(lastTurn.trace, action.event) };
  return { ...state, turns: nextTurns };
}
