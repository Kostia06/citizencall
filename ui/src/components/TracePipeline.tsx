import { useEffect, useState } from 'react';
import HopCard from './HopCard';
import { formatMs, formatPct, formatUsd, useCountUp } from '../lib/format';
import type { TraceState } from '../lib/traceReducer';

const KIND_LABEL: Record<string, string> = {
  classify: 'classify',
  extract_fields: 'extract fields',
  summarize: 'summarize',
  normalize: 'normalize',
};

/** The trace that expands DOWNWARD from the pinned bar — SPEC.md §6. Reads
 * live off TraceState; every sub-section only renders once its event has
 * arrived, so the reveal paces itself with the run. */
export default function TracePipeline({ state }: { state: TraceState }) {
  if (state.status === 'idle') return null;

  return (
    <div className="mx-auto mt-6 w-full max-w-2xl space-y-5 pb-24">
      {state.normalize && <NormalizeBlock normalize={state.normalize} />}

      {state.plan && (
        <div className="flex items-center justify-between px-1 text-[11px] text-white/40">
          <span>
            {state.plan.subTasks.length} sub-task{state.plan.subTasks.length === 1 ? '' : 's'} planned ·{' '}
            {formatMs(state.plan.ms)}
          </span>
          <span
            className={
              state.plan.cacheHit ? 'font-medium text-emerald-400/80' : 'text-white/30'
            }
          >
            plan: {state.plan.cacheHit ? 'GLOBAL HIT' : 'MISS'}
          </span>
        </div>
      )}

      {state.plan?.subTasks.map((subTask) => {
        const rungs = state.rungsBySubTask[subTask.id] ?? [];
        if (rungs.length === 0) return null;
        return (
          <div key={subTask.id} className="space-y-2">
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
          </div>
        );
      })}

      {state.runEnd && <RunEndSummary runEnd={state.runEnd} />}
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

  return (
    <div className="animate-hop-in rounded-2xl border border-accent/30 bg-accent/[0.06] p-5">
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
        <span className="rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-black">
          {formatPct(savings)} saved
        </span>
      </div>
    </div>
  );
}
