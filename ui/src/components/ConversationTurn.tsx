import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import TracePipeline from './TracePipeline';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';
import type { ConnectionGate, Turn } from '../lib/traceReducer';
import { storeApi, type AuthedFetch } from '../api';
import { MOCK } from '../api';
import { APPS } from '../store/apps';

/** One turn in the chat transcript: the submitted prompt as a right-aligned
 * bubble, followed by that run's TracePipeline output. Mounts once per turn
 * and never remounts — TracePipeline reads live off the turn's own
 * TraceState as events stream in, so re-renders (not remounts) drive the
 * trace forward. DESIGN.md's entrance-standard spring plays once when the
 * turn is appended to the transcript.
 *
 * `animate` is true only for the currently-running turn (see Bar.tsx) — it
 * gates TracePipeline's `layout` animations so a finished turn stops paying
 * framer-motion's re-measure cost on every event in the turn still running.
 * Finished turns also get `content-visibility: auto` so ones scrolled out
 * of view skip layout/paint entirely. */
export default function ConversationTurn({
  turn,
  animate = false,
  authedFetch,
}: {
  turn: Turn;
  animate?: boolean;
  authedFetch?: AuthedFetch;
}) {
  const reduceMotion = useReducedMotion();
  const gate = turn.trace.connectionGate;

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? entranceStandardReduced : entranceStandard}
      className={`mb-8 ${animate ? '' : 'turn-frozen'}`}
    >
      <div className="mb-1.5 flex justify-end px-1 text-[10px] uppercase tracking-wide text-white/25">
        {turn.source === 'voice' ? 'you · voice' : 'you'}
      </div>
      <div className="flex justify-end px-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] leading-snug text-white/85">
          {turn.prompt}
        </div>
      </div>
      <TracePipeline state={turn.trace} className="mx-auto mt-4 w-full max-w-2xl" animate={animate} />
      {gate && (
        <ConnectionGateCard gate={gate} runId={turn.trace.runId} authedFetch={authedFetch} />
      )}
      {turn.trace.answerText && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? entranceStandardReduced : entranceStandard}
          className="mx-auto mt-4 w-full max-w-2xl px-1"
        >
          {/* The actual reply — left-aligned assistant bubble, the thing the
              user came for; the trace above is the receipts. */}
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-white/25">understudy</div>
          <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-accent/20 bg-accent/[0.05] px-4 py-3 text-[13.5px] leading-relaxed text-white/90">
            {turn.trace.answerText}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/** Connection-required pause card ("Connect Discord to continue"): rendered
 * while the run's DO is paused waiting for the toolkit connection. Connect
 * opens the normal Composio OAuth flow IN A NEW TAB (this page keeps its SSE
 * stream); when the window regains focus we re-check connections and
 * auto-resume with `retry` if the toolkit is now active. Skip resumes
 * without tool data. After `run_resumed`, collapses to a one-line note. */
function ConnectionGateCard({
  gate,
  runId,
  authedFetch,
}: {
  gate: ConnectionGate;
  runId?: string;
  authedFetch?: AuthedFetch;
}) {
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState<'connect' | 'skip' | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const app = APPS.find((a) => a.slug === gate.toolkit);
  const name = app?.name ?? gate.toolkit;

  // Auto-retry on window focus while waiting — the user typically comes back
  // from the OAuth tab. The worker keeps the pause alive on a premature
  // retry, so a false positive here costs nothing.
  useEffect(() => {
    if (gate.status !== 'waiting' || !runId || !authedFetch) return;
    let cancelled = false;
    const checkAndRetry = () => {
      storeApi
        .listConnections(authedFetch)
        .then((list) => {
          if (cancelled) return null;
          const active = list.some((c) => c.toolkit === gate.toolkit && c.status === 'active');
          return active ? storeApi.resumeRun(runId, 'retry') : null;
        })
        .catch(() => undefined);
    };
    window.addEventListener('focus', checkAndRetry);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', checkAndRetry);
    };
  }, [gate.status, gate.toolkit, runId, authedFetch]);

  if (gate.status === 'resumed') {
    return (
      <div className="mx-auto mt-3 w-full max-w-2xl px-1 text-[11px] text-white/40">
        {gate.skipped ? (
          <>skipped {name.toLowerCase()}</>
        ) : (
          <span className="text-emerald-400/70">{name.toLowerCase()} connected — resumed</span>
        )}
      </div>
    );
  }

  function handleConnect() {
    if (!authedFetch || busy) return;
    setBusy('connect');
    storeApi
      .connect(authedFetch, gate.toolkit)
      .then(({ url }) => {
        // New tab so this page's SSE stream survives; never open a
        // stub-mode link (see Bar.tsx's orb connect).
        if (url && !MOCK && !url.includes('composio.stub')) window.open(url, '_blank', 'noopener');
      })
      .catch(() => undefined)
      .finally(() => setBusy(null));
  }

  function handleSkip() {
    if (!runId || busy) return;
    setBusy('skip');
    storeApi
      .resumeRun(runId, 'skip')
      .catch(() => undefined)
      .finally(() => setBusy(null));
  }

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? entranceStandardReduced : entranceStandard}
      className="mx-auto mt-4 w-full max-w-2xl rounded-2xl border border-accent/30 bg-accent/[0.06] p-5"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
          {app?.logo && !logoBroken ? (
            <img src={app.logo} alt="" className="h-6 w-6" onError={() => setLogoBroken(true)} />
          ) : (
            <span className="text-[13px] font-semibold uppercase text-white/60">{name.slice(0, 2)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white/90">Connect {name} to continue</div>
          <div className="mt-0.5 text-[11px] leading-snug text-white/40">
            This step needs {name} — the run is paused until you connect it, or skip to continue without it.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy !== null}
            className="rounded-full bg-accent px-4 py-1.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy !== null}
            className="rounded-full px-3 py-1.5 text-[12px] text-white/40 transition-colors hover:text-white/70 disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </div>
    </motion.div>
  );
}
