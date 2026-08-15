import type { RungState } from '../lib/traceReducer';
import { formatMs, formatUsd, useCountUp } from '../lib/format';
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

/** Renders one escalation rung: routing reasons, live/settled hop, and a
 * cubic-ease cost count-up. A failed hop shakes once on arrival — the
 * escalation arrow that follows it lives in TracePipeline. */
export default function HopCard({ rung, subTask, index }: HopCardProps) {
  const { decision, hopStart, hop } = rung;
  const isFailed = hop && hop.verdict !== 'pass';
  const isRunning = !!hopStart && !hop;
  const cost = useCountUp(hop?.costUsd ?? 0, 700);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${isFailed ? 'animate-shake' : 'animate-hop-in'}`}
      style={{ animationDelay: isFailed ? undefined : `${index * 70}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isRunning ? 'bg-accent animate-pulse' : hop?.verdict === 'pass' ? 'bg-emerald-400' : hop ? 'bg-red-400' : 'bg-white/25'
            }`}
          />
          <span className="truncate font-mono text-[13px] text-white/90">
            {decision?.modelId ?? hopStart?.modelId ?? '…'}
          </span>
          {(decision?.ladderPosition ?? 0) > 0 && (
            <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-bright">
              escalation
            </span>
          )}
        </div>
        <div className="shrink-0 font-mono text-[13px] tabular-nums text-white/70">
          {hop ? formatUsd(cost) : decision ? '…' : ''}
        </div>
      </div>

      {subTask && (
        <p className="mt-1.5 truncate text-[12px] text-white/45">{subTask.instruction}</p>
      )}

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

      {isRunning && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
        </div>
      )}
    </div>
  );
}
