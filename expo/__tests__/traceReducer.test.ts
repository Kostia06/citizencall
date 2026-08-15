import { initialTraceState, traceReducer } from '../src/lib/traceReducer';
import { conversationReducer, initialConversationState } from '../src/lib/conversationReducer';
import type { TraceEvent } from '../src/types/contract';

describe('traceReducer', () => {
  it('starts a run and records the request text', () => {
    const state = traceReducer(initialTraceState(), {
      t: 'run_start',
      runId: 'r1',
      userId: 'u1',
      text: 'summarize the repo',
      source: 'text',
    });
    expect(state.status).toBe('running');
    expect(state.runId).toBe('r1');
    expect(state.requestText).toBe('summarize the repo');
  });

  it('tracks plan -> route -> hop_start -> hop_end for a sub-task', () => {
    let state = initialTraceState();
    const events: TraceEvent[] = [
      { t: 'plan', plan: { subTasks: [{ id: 'st_0', idx: 0, kind: 'summarize', instruction: 'x', ctxNeeded: 100, needsTools: false, dependsOn: [], sensitive: false }] }, cacheHit: false, ms: 10 },
      { t: 'route', decision: { subTaskId: 'st_0', modelId: 'm1', score: 0.9, reasons: [], ladderPosition: 0, candidatesConsidered: 8 } },
      { t: 'hop_start', hop: { id: 'h1', subTaskId: 'st_0', modelId: 'm1', paramsB: 8 } },
      { t: 'hop_end', hop: { id: 'h1', subTaskId: 'st_0', modelId: 'm1', modelClass: 'x', paramsB: 8, promptTokens: 1, completionTokens: 1, costUsd: 0.001, latencyMs: 100, availability: 'warm', verdict: 'pass', cacheHit: 'none' } },
    ];
    for (const e of events) state = traceReducer(state, e);
    expect(state.subTaskOrder).toEqual(['st_0']);
    const rungs = state.rungsBySubTask['st_0'];
    expect(rungs).toHaveLength(1);
    expect(rungs[0].hop?.verdict).toBe('pass');
  });

  it('opens a new rung on escalate and bumps escalateTick', () => {
    let state = initialTraceState();
    state = traceReducer(state, {
      t: 'plan',
      plan: { subTasks: [{ id: 'st_0', idx: 0, kind: 'extract_fields', instruction: 'x', ctxNeeded: 100, needsTools: false, dependsOn: [], sensitive: false }] },
      cacheHit: false,
      ms: 10,
    });
    state = traceReducer(state, { t: 'route', decision: { subTaskId: 'st_0', modelId: 'small', score: 0.5, reasons: [], ladderPosition: 0, candidatesConsidered: 8 } });
    state = traceReducer(state, { t: 'hop_start', hop: { id: 'h1', subTaskId: 'st_0', modelId: 'small', paramsB: 4 } });
    state = traceReducer(state, {
      t: 'hop_end',
      hop: { id: 'h1', subTaskId: 'st_0', modelId: 'small', modelClass: 'x', paramsB: 4, promptTokens: 1, completionTokens: 0, costUsd: 0.0001, latencyMs: 50, availability: 'warm', verdict: 'fail_schema', cacheHit: 'none' },
    });
    state = traceReducer(state, { t: 'escalate', from: 'small', to: 'big', reason: 'fail_schema' });
    expect(state.escalateTick).toBe(1);
    expect(state.rungsBySubTask['st_0']).toHaveLength(2);
    expect(state.rungsBySubTask['st_0'][1].escalatedFrom).toBe('h1');
  });

  it('records run_end totals and marks status done', () => {
    const state = traceReducer(initialTraceState(), {
      t: 'run_end',
      runId: 'r1',
      totalCostUsd: 0.005,
      totalMs: 1200,
      baselineCostUsd: 0.05,
      savingsPct: 90,
    });
    expect(state.status).toBe('done');
    expect(state.runEnd?.savingsPct).toBe(90);
  });

  it('marks status error on an error event', () => {
    const state = traceReducer(initialTraceState(), { t: 'error', message: 'boom' });
    expect(state.status).toBe('error');
    expect(state.error).toBe('boom');
  });
});

describe('conversationReducer', () => {
  it('routes trace_event to the last turn only', () => {
    let state = initialConversationState();
    state = conversationReducer(state, { type: 'start_turn', id: 't1', prompt: 'first', source: 'text' });
    state = conversationReducer(state, { type: 'start_turn', id: 't2', prompt: 'second', source: 'text' });
    state = conversationReducer(state, { type: 'trace_event', event: { t: 'error', message: 'x' } });
    expect(state.turns).toHaveLength(2);
    expect(state.turns[0].trace.status).toBe('idle');
    expect(state.turns[1].trace.status).toBe('error');
  });

  it('drops a trace_event with no turn yet instead of throwing', () => {
    const state = conversationReducer(initialConversationState(), { type: 'trace_event', event: { t: 'error', message: 'x' } });
    expect(state.turns).toHaveLength(0);
  });
});
