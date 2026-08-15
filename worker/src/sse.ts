// Pure SSE framing helpers, kept separate from RunDO so the replay/heartbeat
// logic (SPEC.md §13 fixes a/b/c) is unit-testable without spinning up a
// Durable Object.
import type { TraceEvent } from './types';

export const SSE_HEARTBEAT = ': ping\n\n';

export function formatSseEvent(id: number, event: TraceEvent): string {
  return `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
}

// Fix (a): the DO keeps an append-only event buffer and replays on connect —
// so run_start/plan fired before a client attached are never lost.
// Fix (b): honors Last-Event-ID so a reconnect resumes after what the client
// already has instead of re-sending (and instead of skipping ahead).
export function replayFrom(
  events: readonly TraceEvent[],
  lastEventId: string | null
): { fromIndex: number; events: TraceEvent[] } {
  if (lastEventId === null) return { fromIndex: 0, events: [...events] };
  const parsed = Number.parseInt(lastEventId, 10);
  const fromIndex = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed + 1, events.length) : 0;
  return { fromIndex, events: events.slice(fromIndex) };
}
