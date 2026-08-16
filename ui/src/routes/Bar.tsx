import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import CommandBar from '../components/CommandBar';
import ConversationTurn from '../components/ConversationTurn';
import Orbs from '../components/Orbs';
import { ToastStack, useToasts } from '../components/Toast';
import TopNav from '../components/TopNav';
import HistoryDrawer from '../components/history/HistoryDrawer';
import RestoredTurn, { type RestoredRun } from '../components/history/RestoredTurn';
import { DEFAULT_PREFS, MOCK, startRun, storeApi, type Connection, type Routine, type RunHandle, type SessionSummary, type UserPrefsButton } from '../api';
import { conversationReducer, initialConversationState } from '../lib/traceReducer';
import { layoutFlow, layoutFlowReduced } from '../lib/motion';
import { useAuth } from '../auth/useAuth';
import type { RunAttachment } from '../types';

const USERS = ['demo_kos', 'demo_teammate'];

let turnSeq = 0;
function nextTurnId(): string {
  turnSeq += 1;
  return `turn-${Date.now().toString(36)}-${turnSeq}`;
}

/** The primary screen — now a chat. The command bar is ALWAYS horizontally
 * centered and vertically stable: empty state, it sits dead-centre in the
 * viewport; the moment a conversation exists, it settles (once, via a
 * spring) to a fixed spot near the top and never moves again. Each submit
 * appends a TURN to the transcript below it, which scrolls in its own
 * region — the bar never drifts as output grows. On narrow screens the
 * orbs stack BELOW the bar instead of beside it. */
export default function Bar() {
  const [conversation, dispatch] = useReducer(conversationReducer, undefined, initialConversationState);
  const [userIdx, setUserIdx] = useState(0);
  const [liveToolkit, setLiveToolkit] = useState<'github' | 'gmail' | null>(null);
  const { toasts, push } = useToasts();
  const { authedFetch, status, accessToken } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>([]);
  /** Past runs re-opened from the history drawer, rendered read-only in the
   * transcript. `afterTurnId` anchors each one after the live turn that was
   * last when it was restored, so "go back and forth" keeps chat order. */
  const [restored, setRestored] = useState<Array<{ key: string; afterTurnId: string | null; run: RestoredRun }>>([]);
  const [contextPrompt, setContextPrompt] = useState('');
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [barButtons, setBarButtons] = useState<UserPrefsButton[]>(() => {
    try {
      const stored = localStorage.getItem('understudy:bar-buttons');
      if (stored) {
        const parsed = JSON.parse(stored) as UserPrefsButton[];
        if (Array.isArray(parsed) && parsed.every((b) => b && typeof b.id === 'string' && typeof b.action === 'string')) {
          return parsed;
        }
      }
    } catch {
      /* corrupt/absent — defaults */
    }
    return DEFAULT_PREFS.buttons;
  });
  // localStorage is the anon/instant path (Settings writes it on selection);
  // server prefs override once loaded so the choice follows the account.
  const [barAlignment, setBarAlignment] = useState<'left' | 'center' | 'right'>(() => {
    const stored = localStorage.getItem('understudy:bar-alignment');
    return stored === 'left' || stored === 'right' ? stored : 'center';
  });
  const reorderSaveRef = useRef<number | undefined>(undefined);
  // /oauth/done can return the browser HERE (returnTo:'/' — pause-card and
  // orb connects) with ?connected=<toolkit>&status=… — greet, refresh
  // connections (the paused run self-resumes worker-side), strip params.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const toolkit = searchParams.get('connected');
    if (!toolkit) return;
    const status = searchParams.get('status');
    push(status === 'success' ? `${toolkit} connected — resuming` : `Connecting ${toolkit} did not complete`);
    storeApi
      .listConnections(authedFetch)
      .then((list) => setConnections(list))
      .catch(() => undefined);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const runHandleRef = useRef<RunHandle | null>(null);
  const liveTimeoutRef = useRef<number | undefined>(undefined);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const reduceMotion = useReducedMotion();

  const turns = conversation.turns;
  const hasTurns = turns.length > 0;
  const hasContent = hasTurns || restored.length > 0;
  const lastTurn = turns[turns.length - 1];
  const running = lastTurn?.trace.status === 'running';

  useEffect(() => {
    return () => {
      runHandleRef.current?.close();
      if (liveTimeoutRef.current) window.clearTimeout(liveTimeoutRef.current);
    };
  }, []);

  // Live prefs, lightly wired (task spec §5/§6): real connection state for
  // the orbs, and the default context prompt to prepend to runs. Keybinding
  // remapping is deliberately NOT applied here — CommandBar owns its own
  // keyboard handling and remapping it cleanly is deferred, see report.
  //
  // Re-runs on auth `status` changes (not just mount): logging in or out
  // changes WHOSE connections/settings the store returns (bearer vs anon
  // cookie), and `authedFetch` is a stable ref that never retriggers this on
  // its own. Skipped while the initial silent refresh is still 'loading' so
  // the first fetch already carries the restored bearer instead of racing it
  // as anon and then showing stale anon state.
  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    storeApi
      .listConnections(authedFetch)
      .then((list) => {
        if (!cancelled) setConnections(list);
      })
      .catch(() => undefined);
    storeApi
      .getSettings(authedFetch)
      .then((prefs) => {
        if (!cancelled) {
          setContextPrompt(prefs.contextPrompt);
          setSuggestionsEnabled(prefs.suggestions);
          if (prefs.buttons.length > 0) {
            setBarButtons(prefs.buttons);
            localStorage.setItem('understudy:bar-buttons', JSON.stringify(prefs.buttons));
          }
          if (prefs.barAlignment) {
            setBarAlignment(prefs.barAlignment);
            localStorage.setItem('understudy:bar-alignment', prefs.barAlignment);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authedFetch, status]);

  useEffect(() => {
    const toolCall = lastTurn?.trace.lastToolCall;
    if (!toolCall) return;
    setLiveToolkit(toolCall.toolkit === 'gmail' ? 'gmail' : 'github');
    if (liveTimeoutRef.current) window.clearTimeout(liveTimeoutRef.current);
    liveTimeoutRef.current = window.setTimeout(() => setLiveToolkit(null), 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTurn?.trace.lastToolCall]);

  // Auto-scroll the transcript to the newest content as turns are added or
  // a live trace streams in — but only while the user is already at (or
  // near) the bottom, so scrolling up to reread an earlier turn is never
  // hijacked by new events arriving underneath.
  useLayoutEffect(() => {
    const el = transcriptRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [conversation, restored]);

  function handleTranscriptScroll() {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  // The typewriter answer reveal (chat/TypewriterText.tsx) and the trace
  // collapse/expand toggle both grow/shrink the transcript's content WITHOUT
  // dispatching a conversation action, so the effect above (keyed on
  // `[conversation, restored]`) never re-fires for them. A ResizeObserver on
  // the content wrapper catches every such reflow generically and re-applies
  // the same stick-to-bottom rule, so reveals never fight a user who's
  // scrolled up to reread an earlier turn.
  useEffect(() => {
    const content = transcriptContentRef.current;
    const container = transcriptRef.current;
    if (!content || !container) return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) container.scrollTop = container.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [hasContent]);

  // Stop button (ConversationTurn/StatusLine/AnswerBubble) — closes the
  // in-flight SSE/mock RunHandle and freezes the last turn's trace via the
  // additive `stop_turn` conversation action (traceReducer.ts), whatever
  // arrived stays.
  function handleStop() {
    runHandleRef.current?.close();
    dispatch({ type: 'stop_turn' });
  }

  const currentUser = USERS[userIdx];
  // "Always connected" demo look is MOCK-ONLY. In live mode the orbs must
  // reflect the REAL connection state for whoever is acting — including an
  // anonymous `__Host-anon` session — or an anon visitor sees github/gmail
  // lit up that they never connected, and their actual connections appear
  // to "reset" the moment that pretense is compared with reality.
  const mockConnectedFallback = MOCK;
  const connectedSlugs = (() => {
    const set = new Set(connections.filter((c) => c.status === 'active').map((c) => c.toolkit));
    if (mockConnectedFallback) {
      set.add('github');
      set.add('gmail');
    }
    return set;
  })();

  // Hold-drag reorder on the live orbs — mirror to state immediately (Reorder
  // streams the new order during the drag), persist once it settles. Same
  // prefs.buttons the settings arranger writes; anonymous save just no-ops
  // server-side and keeps the order for this session.
  function handleReorderButtons(next: UserPrefsButton[]) {
    setBarButtons(next);
    // Instant local persistence — the account save below is best-effort
    // (silently failing PUTs made reorders vanish on reload, reported live).
    localStorage.setItem('understudy:bar-buttons', JSON.stringify(next));
    if (reorderSaveRef.current) window.clearTimeout(reorderSaveRef.current);
    reorderSaveRef.current = window.setTimeout(() => {
      storeApi
        .putSettings(authedFetch, { buttons: next })
        .catch(() => push('Order saved on this device — log in to sync it to your account'));
    }, 800);
  }

  // Orb click on an unconnected toolkit — same flow as the settings grid:
  // POST /api/connect, open the returned Composio OAuth URL. MOCK mode fakes
  // the connect and just refreshes the list.
  function handleOrbConnect(slug: string) {
    storeApi
      .connect(authedFetch, slug, '/')
      .then(({ url }) => {
        // Never open a stub-mode link (worker without a Composio key) — the
        // domain doesn't exist; the connect is already faked server-side.
        if (url && !MOCK && !url.includes('composio.stub')) window.open(url, '_blank', 'noopener');
        return storeApi.listConnections(authedFetch);
      })
      .then((list) => setConnections(list))
      .catch(() => push(`Could not start connecting ${slug}`));
  }

  // ---- Chat history ("persistent sessions"). Live: GET /api/sessions is
  // the actor's own persisted runs (works anonymously via the cookie
  // session). MOCK: the in-memory list of THIS session's turns. Selecting
  // one restores it read-only into the transcript as a RestoredTurn —
  // prompt + compact summary card from the stored run row; full trace
  // replay is intentionally not attempted.
  function openHistory() {
    setHistoryOpen(true);
    if (MOCK) return;
    setHistoryLoading(true);
    storeApi
      .listSessions(authedFetch)
      .then(setLiveSessions)
      .catch(() => push('Could not load history'))
      .finally(() => setHistoryLoading(false));
  }

  const mockSessions: SessionSummary[] = [...turns]
    .reverse()
    .map((t) => ({
      id: t.id,
      requestText: t.prompt,
      createdAt: 0,
      totalCostUsd: t.trace.runEnd?.totalCostUsd ?? 0,
      status: t.trace.status === 'idle' ? 'running' : t.trace.status,
    }));
  const sessions = MOCK ? mockSessions : liveSessions;

  function appendRestored(run: RestoredRun) {
    const afterTurnId = turns.length > 0 ? turns[turns.length - 1].id : null;
    stickToBottomRef.current = true;
    setRestored((prev) => [...prev, { key: `restored-${prev.length}-${run.id}`, afterTurnId, run }]);
    setHistoryOpen(false);
  }

  // A restored run that is still RUNNING (e.g. paused on a connection while
  // the user was off in the OAuth tab) keeps polling until it settles, so
  // the restored card finishes in place — status flips and the answer
  // appears — instead of freezing at "running" forever.
  useEffect(() => {
    if (MOCK) return;
    const runningIds = restored.filter((r) => r.run.status === 'running').map((r) => r.run.id);
    if (runningIds.length === 0) return;
    const id = window.setInterval(() => {
      for (const runId of runningIds) {
        storeApi
          .getRunDetail(runId)
          .then(({ run }) => {
            if (run.status === 'running') return;
            setRestored((prev) =>
              prev.map((r) =>
                r.run.id === runId
                  ? {
                      ...r,
                      run: {
                        ...r.run,
                        status: run.status,
                        totalCostUsd: run.total_cost_usd ?? r.run.totalCostUsd,
                        totalMs: run.total_ms,
                        ...(run.answer_text ? { answerText: run.answer_text } : {}),
                      },
                    }
                  : r,
              ),
            );
          })
          .catch(() => undefined);
      }
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored.map((r) => `${r.run.id}:${r.run.status}`).join(',')]);

  function handleSelectSession(id: string) {
    if (MOCK) {
      const turn = turns.find((t) => t.id === id);
      if (!turn) return;
      appendRestored({
        id,
        requestText: turn.prompt,
        source: turn.source,
        createdAt: 0,
        status: turn.trace.status === 'idle' ? 'running' : turn.trace.status,
        totalCostUsd: turn.trace.runEnd?.totalCostUsd ?? 0,
        totalMs: turn.trace.runEnd?.totalMs ?? null,
        answerText: turn.trace.answerText,
      });
      return;
    }
    storeApi
      .getRunDetail(id)
      .then(({ run }) =>
        appendRestored({
          id: run.id,
          requestText: run.request_text,
          source: run.source === 'voice' ? 'voice' : 'text',
          createdAt: run.created_at,
          status: run.status,
          totalCostUsd: run.total_cost_usd ?? 0,
          totalMs: run.total_ms,
          ...(run.answer_text ? { answerText: run.answer_text } : {}),
        }),
      )
      .catch(() => push('Could not load that session'));
  }

  function handleSubmit(
    text: string,
    opts: { bypassCache: boolean; source: 'text' | 'voice'; attachments: RunAttachment[] },
  ) {
    runHandleRef.current?.close();
    stickToBottomRef.current = true;
    dispatch({ type: 'start_turn', id: nextTurnId(), prompt: text, source: opts.source });
    // The transcript shows the user's raw text; the default context prompt
    // (settings §5) is prepended only to what's sent to the run, not to the
    // displayed turn.
    const sendText = contextPrompt.trim() ? `${contextPrompt.trim()}\n\n${text}` : text;
    runHandleRef.current = startRun({
      userId: currentUser,
      accessToken,
      text: sendText,
      source: opts.source,
      noCache: opts.bypassCache,
      attachments: opts.attachments,
      onEvent: (event) => dispatch({ type: 'trace_event', event }),
      onError: () => push('Run stream dropped — reconnecting…'),
    });
  }

  // `routine:<id>` orb click — fires the routine's saved prompt through the
  // exact same submit path as typing it. Routines list refreshes with auth
  // (a login can claim/expose different routines).
  useEffect(() => {
    let cancelled = false;
    storeApi
      .listRoutines(authedFetch)
      .then((list) => {
        if (!cancelled) setRoutines(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authedFetch, status]);

  function handleRunRoutine(routineId: string) {
    const routine = routines.find((r) => r.id === routineId);
    if (!routine) {
      push('That routine no longer exists — check Settings.');
      return;
    }
    handleSubmit(routine.prompt, { bypassCache: false, source: 'text', attachments: [] });
  }

  // "Bar placement" (settings) — the input cluster + transcript sit left,
  // middle, or right of the screen. max-w stays; only the margins move.
  const alignClass = barAlignment === 'left' ? 'mr-auto ml-0' : barAlignment === 'right' ? 'ml-auto mr-0' : 'mx-auto';

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden px-6">
      {/* pinned top nav */}
      <div className="absolute inset-x-0 top-0 z-10 px-6 pt-6">
        <div className="mx-auto max-w-2xl">
          <TopNav />
        </div>
      </div>

      {/* Command bar — centered horizontally always; empty state centers it
          in the full viewport, once turns exist it settles near the top via
          a spring (framer-motion `layout` on this wrapper interpolates the
          flex-position change) and then never moves again. */}
      <motion.div
        layout
        transition={reduceMotion ? layoutFlowReduced : layoutFlow}
        className={`${alignClass} flex w-full max-w-2xl shrink-0 flex-col ${
          hasContent ? 'pt-24 pb-4' : 'flex-1 items-center justify-center'
        }`}
      >
        {/* orbs sit beside the bar on wide screens, BELOW it on narrow ones */}
        <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="w-full flex-1">
            <CommandBar
              running={running}
              escalateTick={lastTurn?.trace.escalateTick ?? 0}
              onSubmit={handleSubmit}
              onFilesDropped={(files) => push(`${files.length} file${files.length === 1 ? '' : 's'} attached`)}
              onToast={push}
              suggestionsEnabled={suggestionsEnabled}
              recentPrompts={turns.slice(-5).map((t) => t.prompt)}
              authedFetch={authedFetch}
            />
          </div>
          <div className="sm:pt-1.5">
            <Orbs
              buttons={barButtons}
              connectedSlugs={connectedSlugs}
              liveToolkit={liveToolkit}
              policyVersion="v3"
              currentUser={currentUser}
              onToggleUser={() => setUserIdx((i) => (i + 1) % USERS.length)}
              onConnect={handleOrbConnect}
              onReorder={handleReorderButtons}
              routines={routines}
              onRunRoutine={handleRunRoutine}
              onPollConnections={() => {
                storeApi
                  .listConnections(authedFetch)
                  .then((list) => setConnections(list))
                  .catch(() => undefined);
              }}
            />
          </div>
          {/* History — opens the past-sessions drawer. Sits with the orbs so
              the centered-bar layout is untouched. */}
          <div className="sm:pt-1.5">
            <button
              type="button"
              onClick={openHistory}
              aria-label="Session history"
              title="Session history"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white/80"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Transcript — its own vertically-scrollable region, so old turns
          scroll out of view while the bar above stays put. */}
      {hasContent && (
        <div
          ref={transcriptRef}
          onScroll={handleTranscriptScroll}
          className={`transcript-scroll ${alignClass} min-h-0 w-full max-w-2xl flex-1 overflow-y-auto pb-8`}
        >
          <div ref={transcriptContentRef}>
            {restored
              .filter((r) => r.afterTurnId === null)
              .map((r) => (
                <RestoredTurn key={r.key} run={r.run} />
              ))}
            {turns.map((turn) => (
              <div key={turn.id}>
                <ConversationTurn
                  turn={turn}
                  animate={turn.id === lastTurn?.id && running}
                  authedFetch={authedFetch}
                  onStop={turn.id === lastTurn?.id && running ? handleStop : undefined}
                />
                {restored
                  .filter((r) => r.afterTurnId === turn.id)
                  .map((r) => (
                    <RestoredTurn key={r.key} run={r.run} />
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <HistoryDrawer
        open={historyOpen}
        sessions={sessions}
        loading={historyLoading}
        onSelect={handleSelectSession}
        onClose={() => setHistoryOpen(false)}
      />

      <ToastStack toasts={toasts} />
    </div>
  );
}
