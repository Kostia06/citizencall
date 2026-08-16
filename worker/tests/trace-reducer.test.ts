// UI trace reducer contract for streamed answers (ui/src/lib/traceReducer.ts —
// pure TS, imported across the package boundary because the ui package has no
// test runner): answer_delta appends, `escalate` discards the failed rung's
// streamed text, and the final `answer` reconciles to the authoritative
// whole text.
import { describe, expect, it } from 'vitest';
import { initialTraceState, traceReducer, type TraceState } from '../../ui/src/lib/traceReducer';
import type { TraceEvent as UiTraceEvent, Hop as UiHop } from '../../ui/src/types';

const apply = (state: TraceState, ...events: UiTraceEvent[]): TraceState => events.reduce(traceReducer, state);

const running = (): TraceState =>
  traceReducer(initialTraceState(), { t: 'run_start', runId: 'r1', userId: 'u1', text: 'hi', source: 'text' });

describe('traceReducer — answer streaming', () => {
  it('appends answer_delta chunks and marks the answer as streamed', () => {
    const s = apply(
      running(),
      { t: 'answer_delta', subTaskId: 'st1', text: 'Red ' },
      { t: 'answer_delta', subTaskId: 'st1', text: 'pandas.' },
    );
    expect(s.answerText).toBe('Red pandas.');
    expect(s.answerStreamed).toBe(true);
  });

  it('reconciles to the full text on the answer event', () => {
    const s = apply(
      running(),
      { t: 'answer_delta', subTaskId: 'st1', text: 'Red pand' }, // tail delta lost, e.g.
      { t: 'answer', subTaskId: 'st1', text: 'Red pandas are great.' },
    );
    expect(s.answerText).toBe('Red pandas are great.');
    expect(s.answerStreamed).toBe(true); // still raw-rendered, no typewriter replay
  });

  it('clears streamed text when the rung escalates', () => {
    // Build a rung whose hop settled with the failing model so the escalate
    // handler can find it (it matches on hop.modelId === event.from).
    const hop = {
      id: 'h1',
      subTaskId: 'st1',
      modelId: 'small-model',
      modelClass: 'test',
      paramsB: 4,
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0,
      latencyMs: 1,
      availability: 'warm',
      verdict: 'fail_empty',
      cacheHit: 'none',
    } as UiHop;
    const s = apply(
      running(),
      { t: 'hop_start', hop: { id: 'h1', subTaskId: 'st1', modelId: 'small-model', paramsB: 4 } },
      { t: 'answer_delta', subTaskId: 'st1', text: 'half an ans' },
      { t: 'hop_end', hop },
      { t: 'escalate', from: 'small-model', to: 'big-model', reason: 'fail_empty' },
    );
    expect(s.answerText).toBeUndefined(); // discarded — rung 1 streams fresh
    // …and the escalation rung's deltas rebuild it from scratch.
    const after = apply(s, { t: 'answer_delta', subTaskId: 'st1', text: 'A better answer.' });
    expect(after.answerText).toBe('A better answer.');
  });
});
