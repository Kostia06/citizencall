import { motion, useReducedMotion } from 'framer-motion';
import { entranceStandard, entranceStandardReduced } from '../../lib/motion';
import AnswerBubble from '../chat/AnswerBubble';

/** The stored fields a past run is restored from — a subset of the D1 run
 * row (GET /api/run/:id) or, in MOCK mode, of an in-memory turn. Rendered
 * read-only: prompt bubble + a compact summary card. Full trace replay is
 * deliberately not attempted — hops/tool calls stay collapsed into totals. */
export interface RestoredRun {
  id: string;
  requestText: string;
  source: 'text' | 'voice';
  createdAt: number;
  status: string;
  totalCostUsd: number;
  totalMs: number | null;
  answerText?: string;
}

function formatWhen(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCost(usd: number): string {
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

const STATUS_TINT: Record<string, string> = {
  done: 'text-emerald-400/70',
  error: 'text-red-400/70',
  running: 'text-accent/70',
};

/** A past session restored into the transcript from the history drawer:
 * the original prompt as the familiar right-aligned "you" bubble, then the
 * same answer-first presentation as a live turn (AnswerBubble, but
 * `instant` — no typewriter, this already happened) with the run's meta
 * (status/cost/time) collapsed to one small line underneath. Mirrors
 * ConversationTurn's layout language so restored turns read as part of the
 * same conversation, just visibly historical. Runs with no stored answer
 * (still running when captured, or errored before one landed) fall back to
 * the plain meta card — there's nothing answer-first to show yet. */
export default function RestoredTurn({ run }: { run: RestoredRun }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? entranceStandardReduced : entranceStandard}
      className="mb-8"
    >
      <div className="mb-1.5 flex justify-end px-1 text-[10px] uppercase tracking-wide text-white/25">
        restored · {formatWhen(run.createdAt)}
        {run.source === 'voice' ? ' · voice' : ''}
      </div>
      <div className="flex justify-end px-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] leading-snug text-white/85">
          {run.requestText}
        </div>
      </div>
      {run.answerText ? (
        <>
          <AnswerBubble text={run.answerText} instant />
          <div className="mx-auto mt-1 w-full max-w-2xl px-2 text-[11px] text-white/35">
            <span className={STATUS_TINT[run.status] ?? 'text-white/50'}>{run.status}</span>
            <span className="mx-2 text-white/15">·</span>
            <span>{formatCost(run.totalCostUsd)}</span>
            {run.totalMs != null && run.totalMs > 0 && (
              <>
                <span className="mx-2 text-white/15">·</span>
                <span>{(run.totalMs / 1000).toFixed(1)}s</span>
              </>
            )}
            <span className="mx-2 text-white/15">·</span>
            <span className="text-white/25">read-only — resubmit from the bar to run again</span>
          </div>
        </>
      ) : (
        <div className="mx-auto mt-4 w-full max-w-2xl px-1">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/40">
              <span className={STATUS_TINT[run.status] ?? 'text-white/50'}>{run.status}</span>
              <span>{formatCost(run.totalCostUsd)}</span>
              {run.totalMs != null && run.totalMs > 0 && <span>{(run.totalMs / 1000).toFixed(1)}s</span>}
              <span className="text-white/25">read-only — resubmit from the bar to run again</span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
