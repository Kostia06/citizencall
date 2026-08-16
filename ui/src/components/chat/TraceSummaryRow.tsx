import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import TracePipeline from '../TracePipeline';
import { formatMs, formatPct, formatUsd } from '../../lib/format';
import { layoutFlow, layoutFlowReduced } from '../../lib/motion';
import type { TraceState } from '../../lib/traceReducer';

function shortModel(id: string): string {
  const idx = id.lastIndexOf('/');
  return idx === -1 ? id : id.slice(idx + 1);
}

/** Collapsed one-line "thought process" summary shown under a finished
 * turn's answer — ChatGPT's collapsed-reasoning-trace pattern. Click to
 * expand the full existing TracePipeline, reused unmodified. Handles the
 * stopped-mid-run case too (no `runEnd` yet — see `stop_turn` in
 * traceReducer.ts): shows what completed, no cost line. */
export default function TraceSummaryRow({
  trace,
  className = 'mx-auto mt-3 w-full max-w-2xl',
}: {
  trace: TraceState;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();

  const hops = Object.values(trace.rungsBySubTask)
    .flat()
    .filter((r) => r.hop);
  const stepCount = hops.length;
  const models = Array.from(
    new Set(hops.filter((r) => r.hop!.verdict === 'pass').map((r) => shortModel(r.hop!.modelId))),
  );
  const modelsLabel = models.join(', ') || '—';

  const summary = trace.runEnd
    ? `${stepCount} step${stepCount === 1 ? '' : 's'} · ${modelsLabel} · ${formatUsd(
        trace.runEnd.totalCostUsd,
      )} · ${formatPct(trace.runEnd.savingsPct)} saved · ${formatMs(trace.runEnd.totalMs)}`
    : `${stepCount} step${stepCount === 1 ? '' : 's'} · ${modelsLabel}${trace.stoppedByUser ? ' · stopped' : ''}`;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[11px] text-white/35 transition-colors hover:text-white/60"
      >
        <span aria-hidden>⚙</span>
        <span className="truncate">{summary}</span>
        <svg
          viewBox="0 0 24 24"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`ml-auto shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded-trace"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduceMotion ? layoutFlowReduced : layoutFlow}
            className="overflow-hidden"
          >
            <TracePipeline state={trace} className="mx-auto mt-2 w-full pb-2" animate={false} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
