// SPEC.md §13 SSE fixes: (a) append-only buffer replayed on connect so
// run_start/plan are never lost, (b) Last-Event-ID resumes without
// duplicating. These are pure framing functions, tested without a DO.
import { describe, expect, it } from 'vitest';
import { formatSseEvent, replayFrom, SSE_HEARTBEAT } from '../src/sse';
import type { TraceEvent } from '../src/types';

const events: TraceEvent[] = [
  { t: 'run_start', runId: 'r1', userId: 'demo_kos', text: 'hi', source: 'text' },
  { t: 'plan', plan: { subTasks: [] }, cacheHit: false, ms: 5 },
  { t: 'error', message: 'boom' },
];

describe('replayFrom — fix (a): late-attaching clients still get everything', () => {
  it('with no Last-Event-ID, replays the full buffer from the start', () => {
    const { fromIndex, events: replayed } = replayFrom(events, null);
    expect(fromIndex).toBe(0);
    expect(replayed).toEqual(events);
    // run_start and plan, fired before any client could have connected, are
    // still present in the replay — the exact failure mode fix (a) targets.
    expect(replayed[0]!.t).toBe('run_start');
    expect(replayed[1]!.t).toBe('plan');
  });

  it('a client that connects after run_start/plan already fired via push() still sees them', () => {
    // Simulates: events pushed to the buffer BEFORE any stream ever attaches.
    const buffer: TraceEvent[] = [];
    buffer.push(...events.slice(0, 2)); // run_start, plan pushed with no listener
    const { events: replayed } = replayFrom(buffer, null);
    expect(replayed.map((e) => e.t)).toEqual(['run_start', 'plan']);
  });
});

describe('replayFrom — fix (b): Last-Event-ID resumes without duplicating', () => {
  it('resumes strictly after the given id', () => {
    const { fromIndex, events: replayed } = replayFrom(events, '0');
    expect(fromIndex).toBe(1);
    expect(replayed).toEqual(events.slice(1));
  });

  it('returns nothing new when the client is already fully caught up', () => {
    const { events: replayed } = replayFrom(events, String(events.length - 1));
    expect(replayed).toEqual([]);
  });

  it('clamps an out-of-range id rather than throwing', () => {
    const { fromIndex, events: replayed } = replayFrom(events, '999');
    expect(fromIndex).toBe(events.length);
    expect(replayed).toEqual([]);
  });
});

describe('formatSseEvent / heartbeat framing', () => {
  it('includes a monotonic id: line and a data: line with the JSON event', () => {
    const chunk = formatSseEvent(3, events[0]!);
    expect(chunk).toMatch(/^id: 3\n/);
    expect(chunk).toContain(`data: ${JSON.stringify(events[0])}`);
    expect(chunk.endsWith('\n\n')).toBe(true);
  });

  it('heartbeat is a comment line, invisible to EventSource onmessage', () => {
    expect(SSE_HEARTBEAT.startsWith(':')).toBe(true);
  });
});
