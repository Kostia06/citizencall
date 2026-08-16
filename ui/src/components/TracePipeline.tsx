import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import HopCard from './HopCard';
import { KIND_LABEL, formatMs, formatPct, formatUsd, useCountUp } from '../lib/format';
import { layoutFlow, layoutFlowReduced } from '../lib/motion';
import type { TraceState } from '../lib/traceReducer';

/** Tracks the trace column's measured content height so the left-edge
 * "current" spine (DESIGN.md §1/§5) can grow in sync with it. */
function useContentHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, height] as const;
}

/** The trace that expands DOWNWARD from the pinned bar — SPEC.md §6. Reads
 * live off TraceState; every sub-section only renders once its event has
 * arrived, so the reveal paces itself with the run. `className` lets a
 * turn in the chat transcript (ConversationTurn.tsx) use tighter spacing
 * than the default standalone layout.
 *
 * `animate` gates every `layout` prop in this tree. framer-motion
 * re-measures the bounding box of EVERY `layout` element on screen whenever
 * ANY of them changes size — so with one TracePipeline per chat turn, a
 * `layout` block on a completed turn keeps paying that re-measure cost on
 * every new event in the CURRENT turn, and the cost compounds turn over
 * turn. Only the active (currently-running, last) turn passes `animate`;
 * once a turn finishes it renders statically and stops being measured. */
export default function TracePipeline({
  state,
  className = 'mx-auto mt-6 w-full max-w-2xl pb-24',
  animate = true,
}: {
  state: TraceState;
  className?: string;
  animate?: boolean;
}) {
  const [contentRef, contentHeight] = useContentHeight();
  const reduceMotion = useReducedMotion();
  const layoutOn = animate && !reduceMotion;

  if (state.status === 'idle') return null;

  return (
    <div className={`relative ${className}`}>
      {/* "Current" spine — a circuit trace being etched as the run executes,
          DESIGN.md §1. Reduced motion: appears at full height instantly. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex w-5 justify-center" aria-hidden>
        <motion.div
          className="trace-line relative w-[2px] rounded-full"
          initial={false}
          animate={{ height: contentHeight }}
          transition={reduceMotion ? layoutFlowReduced : layoutFlow}
        >
          {contentHeight > 0 && (
            <span className="trace-line-dot absolute -bottom-[3px] left-1/2 h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-accent animate-breathe" />
          )}
        </motion.div>
      </div>

      <motion.div layout={layoutOn} transition={layoutFlow} ref={contentRef} className="space-y-5 pl-5">
        <AnimatePresence>
          {state.normalize && (
            <motion.div
              key="normalize"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? layoutFlowReduced : layoutFlow}
            >
              <NormalizeBlock normalize={state.normalize} />
            </motion.div>
          )}

          {state.plan && (
            <motion.div
              key="plan-summary"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? layoutFlowReduced : layoutFlow}
              className="flex items-center justify-between px-1 text-[11px] text-white/40"
            >
              <span>
                {state.plan.subTasks.length} sub-task{state.plan.subTasks.length === 1 ? '' : 's'} planned ·{' '}
                {formatMs(state.plan.ms)}
                {state.attachments.length > 0 &&
                  ` · ${state.attachments.length} attachment${state.attachments.length === 1 ? '' : 's'}`}
              </span>
              <span className={state.plan.cacheHit ? 'font-medium text-emerald-400/80' : 'text-white/30'}>
                plan: {state.plan.cacheHit ? 'GLOBAL HIT' : 'MISS'}
              </span>
            </motion.div>
          )}

          {state.plan?.subTasks.map((subTask) => {
            const rungs = state.rungsBySubTask[subTask.id] ?? [];
            if (rungs.length === 0) return null;
            return (
              <motion.div
                key={subTask.id}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduceMotion ? layoutFlowReduced : layoutFlow}
                className="space-y-2"
              >
                <div className="flex items-center gap-2 px-1">
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50">
                    {KIND_LABEL[subTask.kind] ?? subTask.kind}
                  </span>
                  {subTask.toolCall && (
                    <span className="text-[11px] text-white/35">
                      {subTask.toolCall.toolkit}.{subTask.toolCall.tool}
                    </span>
                  )}
                </div>
                {rungs.map((rung, i) => (
                  <div key={`${subTask.id}-${i}`}>
                    {rung.escalatedFrom && (
                      <div className="mb-2 flex items-center gap-2 pl-2 text-[11px] text-accent-bright animate-hop-in">
                        <span aria-hidden>↓</span>
                        <span>catching the failure — stepping up one rung</span>
                      </div>
                    )}
                    <HopCard rung={rung} subTask={subTask} index={i} />
                  </div>
                ))}
              </motion.div>
            );
          })}

          {state.runEnd && (
            <motion.div
              key="run-end"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? layoutFlowReduced : layoutFlow}
            >
              <RunEndSummary runEnd={state.runEnd} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function NormalizeBlock({ normalize }: { normalize: NonNullable<TraceState['normalize']> }) {
  const [showClean, setShowClean] = useState(normalize.revealed);
  useEffect(() => {
    if (normalize.revealed) setShowClean(true);
  }, [normalize.revealed]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 animate-hop-in">
      <div className="relative min-h-[1.5rem]">
        <p className={`text-[13px] text-white/35 ${showClean ? 'crossfade-out absolute inset-0' : ''}`}>
          {normalize.from}
        </p>
        {showClean && <p className="crossfade-in text-[13px] text-white/90">{normalize.to}</p>}
      </div>
      <p className="mt-2 text-[11px] text-white/35">
        {normalize.modelId} · {formatMs(normalize.ms)} · {formatUsd(0.000012)} — cleaned before planning
      </p>
    </div>
  );
}

function RunEndSummary({ runEnd }: { runEnd: NonNullable<TraceState['runEnd']> }) {
  const cost = useCountUp(runEnd.totalCostUsd, 900);
  const savings = useCountUp(runEnd.savingsPct, 900);
  const [settled, setSettled] = useState(false);

  // Settle pulse fires once, timed to the count-up's completion — DESIGN.md
  // §5 Cost count-up.
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 900);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      className={`animate-hop-in rounded-2xl border border-accent/30 bg-accent/[0.06] p-5 ${
        settled ? 'animate-count-settle' : ''
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-white/40">total cost</span>
        <span className="font-mono text-lg tabular-nums text-white">{formatUsd(cost)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-white/40">
        <span className="text-[11px]">vs. frontier-only baseline</span>
        <span className="font-mono text-[12px] tabular-nums line-through decoration-white/20">
          {formatUsd(runEnd.baselineCostUsd)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-white/40">{formatMs(runEnd.totalMs)} total</span>
        <span className="rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-paper">
          {formatPct(savings)} saved
        </span>
      </div>
    </div>
  );
}
