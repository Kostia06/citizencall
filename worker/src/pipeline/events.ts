// Trace events the pipeline emits beyond the SPEC.md §4 TraceEvent union.
//
// `cache_hit` — a whole-run cache hit: the stored trace is replayed instead of
// re-running the pipeline (the UI ring/hop cards render the replayed events;
// this event lets the bar badge the run as served-from-cache).
// `tool_skipped` — a tool call that was deliberately not made: the user
// disabled the tool, the toolkit isn't available to this user, or the MCP
// transport isn't implemented yet.
//
// These belong in types.ts's TraceEvent union, but types.ts is the shared
// contract owned outside this change set — the exact diff to add them is in
// the worker-b report. Until it lands, `asTraceEvent` is the single, contained
// cast that keeps the pipeline compiling; the UI's traceReducer routes unknown
// event kinds through its `default` no-op case, so replaying/streaming these
// to an older UI is safe.
import type { TraceEvent } from '../types';

export type PipelineTraceEvent =
  | TraceEvent
  | { t: 'cache_hit'; runId: string; cachedAt: number; ageMs: number }
  | { t: 'tool_skipped'; toolkit: string; tool: string; reason: string };

export function asTraceEvent(e: PipelineTraceEvent): TraceEvent {
  return e as TraceEvent; // remove once the types.ts diff from the report lands
}
