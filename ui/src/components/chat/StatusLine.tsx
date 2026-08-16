import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { TraceState } from '../../lib/traceReducer';

function shortModel(id: string): string {
  const idx = id.lastIndexOf('/');
  return idx === -1 ? id : id.slice(idx + 1);
}

// Recency window for "using <toolkit>…" — short enough that even the mock
// scenario's tight tool_call→hop_end gap has time to hand off to
// "verifying…" before the hop settles. Mirrors Bar.tsx's liveToolkit glow
// (900ms), tuned shorter since this drives text, not a lingering visual.
const TOOL_ACTIVE_MS = 500;

/** Perplexity-style one-line progress narration, derived entirely from the
 * live TraceState — no new wire events, just reading what's already there.
 * Returns null once the run isn't 'running' or the answer has landed (the
 * answer bubble takes over as the focal point). */
function deriveStatusLabel(trace: TraceState, toolActive: boolean): string | null {
  if (trace.status !== 'running' || trace.answerText) return null;
  if (trace.connectionGate?.status === 'waiting') {
    return `waiting for ${trace.connectionGate.toolkit} connection…`;
  }

  for (const subTaskId of trace.subTaskOrder) {
    const rungs = trace.rungsBySubTask[subTaskId] ?? [];
    if (rungs.some((r) => r.escalatedFrom && !r.decision)) {
      return trace.escalateTarget ? `escalating to ${shortModel(trace.escalateTarget)}…` : 'escalating…';
    }
  }

  if (toolActive && trace.lastToolCall) {
    return `using ${trace.lastToolCall.toolkit}…`;
  }

  for (const subTaskId of trace.subTaskOrder) {
    const rungs = trace.rungsBySubTask[subTaskId] ?? [];
    const runningRung = [...rungs].reverse().find((r) => r.hopStart && !r.hop);
    if (runningRung) {
      const subTask = trace.plan?.subTasks.find((s) => s.id === subTaskId);
      const toolAlreadyRan = subTask?.toolCall && trace.lastToolCall?.toolkit === subTask.toolCall.toolkit;
      if (toolAlreadyRan && !toolActive) return 'verifying…';
      return `running ${shortModel(runningRung.hopStart!.modelId)}…`;
    }
  }

  if (trace.plan) return 'routing…';
  return 'planning…';
}

export default function StatusLine({ trace, onStop }: { trace: TraceState; onStop?: () => void }) {
  const reduceMotion = useReducedMotion();
  const [toolActive, setToolActive] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!trace.lastToolCall) return;
    setToolActive(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setToolActive(false), TOOL_ACTIVE_MS);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [trace.lastToolCall]);

  const label = deriveStatusLabel(trace, toolActive);
  if (!label) return null;

  return (
    <div className="mx-auto mt-4 flex w-full max-w-2xl items-center justify-between px-2 text-[11px] text-white/40">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 pl-3 text-white/30 transition-colors hover:text-white/70"
        >
          stop
        </button>
      )}
    </div>
  );
}
