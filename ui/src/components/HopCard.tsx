import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { RungState } from '../lib/traceReducer';
import { KIND_LABEL, formatMs, formatUsd, useCountUp } from '../lib/format';
import { layoutFlow, layoutFlowReduced } from '../lib/motion';
import type { Hop, SubTask, Verdict } from '../types';

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: 'passed',
  fail_schema: 'failed · bad schema',
  fail_grounding: 'failed · ungrounded',
  fail_empty: 'failed · empty output',
  fail_tool: 'failed · tool error',
  fail_cold: 'failed · model cold',
};

const CACHE_LABEL: Record<Hop['cacheHit'], string> = {
  none: '',
  exact: 'exact cache hit',
  plan: 'plan cache hit',
  tool: 'tool cache hit',
};

interface HopCardProps {
  rung: RungState;
  subTask?: SubTask;
  index: number;
}

/** One escalation rung, collapsed to a single line by default — `<dot>
 * modelId · kind · cost · verdict` — so a multi-turn chat transcript stays
 * scannable instead of one tall card per hop. Click the line to expand the
 * full routing reasons + hop detail. A failed hop shakes once on arrival
 * and auto-expands (once) so the escalation beat still reads on camera
 * without an extra click, but stays user-collapsible after that — the
 * escalation arrow that follows a failed hop still lives in
 * TracePipeline. */
export default function HopCard({ rung, subTask, index }: HopCardProps) {
  const { decision, hopStart, hop } = rung;
  const isFailed = !!hop && hop.verdict !== 'pass';
  const isRunning = !!hopStart && !hop;
  const cost = useCountUp(hop?.costUsd ?? 0, 700);
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const autoExpandedOnFailRef = useRef(false);

  useEffect(() => {
    if (isFailed && !autoExpandedOnFailRef.current) {
      autoExpandedOnFailRef.current = true;
      setExpanded(true);
    }
  }, [isFailed]);

  const modelId = decision?.modelId ?? hopStart?.modelId ?? '…';
  const kindLabel = subTask ? (KIND_LABEL[subTask.kind] ?? subTask.kind) : undefined;
  const statusLabel = hop ? VERDICT_LABEL[hop.verdict] : isRunning ? 'running…' : decision ? 'queued' : '…';
  const hasDetail = !!(subTask || (decision && decision.reasons.length > 0) || hop);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 ${isFailed ? 'animate-shake-glow' : 'animate-hop-in'}`}
      style={{ animationDelay: isFailed ? undefined : `${index * 70}ms` }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((e) => !e)}
        aria-expanded={expanded}
        disabled={!hasDetail}
        className="flex w-full min-w-0 items-center gap-2 text-left disabled:cursor-default"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isRunning ? 'bg-accent animate-pulse' : hop?.verdict === 'pass' ? 'bg-emerald-400' : hop ? 'bg-red-400' : 'bg-white/25'
          }`}
        />
        <span className="truncate font-mono text-[13px] text-white/90">{modelId}</span>
        {(decision?.ladderPosition ?? 0) > 0 && (
          <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-bright">
            escalation
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-2 text-[11px]">
          {kindLabel && <span className="hidden text-white/40 sm:inline">{kindLabel}</span>}
          {(hop || decision) && (
            <span className="font-mono tabular-nums text-white/60">{hop ? formatUsd(cost) : '…'}</span>
          )}
          <span className={hop ? (hop.verdict === 'pass' ? 'text-emerald-400/80' : 'text-red-400/80') : 'text-white/40'}>
            {statusLabel}
          </span>
          {hasDetail && (
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`shrink-0 text-white/30 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>

      {isRunning && (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && hasDetail && (
          <motion.div
            key="detail"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduceMotion ? layoutFlowReduced : layoutFlow}
            className="overflow-hidden"
          >
            <div className="pt-3">
              {subTask && <p className="truncate text-[12px] text-white/45">{subTask.instruction}</p>}

              {decision && decision.reasons.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {decision.reasons.map((r) => (
                    <li key={r} className="text-[11px] leading-snug text-white/50">
                      {r}
                    </li>
                  ))}
                </ul>
              )}

              {hop && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
                  <span className={hop.verdict === 'pass' ? 'text-emerald-400/80' : 'text-red-400/80'}>
                    {VERDICT_LABEL[hop.verdict]}
                  </span>
                  <span>{formatMs(hop.latencyMs)}</span>
                  <span>
                    {hop.promptTokens}→{hop.completionTokens} tok
                  </span>
                  {hop.cacheHit !== 'none' && <span className="text-accent-bright">{CACHE_LABEL[hop.cacheHit]}</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
