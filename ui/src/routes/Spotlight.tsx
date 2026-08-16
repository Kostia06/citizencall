import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import CommandBar from '../components/CommandBar';
import Orbs from '../components/Orbs';
import { ToastStack, useToasts } from '../components/Toast';
import { renderMarkdownLite } from '../components/chat/MarkdownLite';
import { DEFAULT_PREFS, MOCK, startRun, storeApi, type Connection, type HistoryTurn, type RunHandle, type UserPrefsButton } from '../api';
import { ensureInputButton } from '../store/types';
import { conversationReducer, initialConversationState } from '../lib/traceReducer';
import { syncThemeFromPrefs } from '../lib/theme';
import { useAuth } from '../auth/useAuth';
import type { RunAttachment } from '../types';

const USERS = ['demo_kos', 'demo_teammate'];

let turnSeq = 0;
function nextTurnId(): string {
  turnSeq += 1;
  return `spot-${Date.now().toString(36)}-${turnSeq}`;
}

/** Spotlight surface — the bar and nothing else. Same components as Bar.tsx,
 * minus every piece of page chrome (TopNav, MOCK badge, page padding), on a
 * transparent background so the Electron overlay reads as a floating control
 * rather than a window.
 *
 * A SEPARATE route rather than a prop on Bar.tsx, so the browser layout stays
 * untouched. desktop/main.js loads this at /spotlight. */
export default function Spotlight() {
  const [conversation, dispatch] = useReducer(conversationReducer, undefined, initialConversationState);
  const [userIdx, setUserIdx] = useState(0);
  const [liveToolkit, setLiveToolkit] = useState<'github' | 'gmail' | null>(null);
  const { toasts, push } = useToasts();
  const { authedFetch, status: authStatus } = useAuth();
  const runHandleRef = useRef<RunHandle | null>(null);
  const liveTimeoutRef = useRef<number | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);
  // Esc collapses the answer without forgetting the turns — the session keeps
  // threading, the overlay just returns to bare-bar Spotlight posture.
  const [panelHidden, setPanelHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  const turns = conversation.turns;
  const lastTurn = turns[turns.length - 1];
  const running = lastTurn?.trace.status === 'running';
  const currentUser = USERS[userIdx];

  // Same bootstrap as Bar.tsx: localStorage is the instant/anon path, server
  // prefs override once loaded — so the overlay shows the ACCOUNT's saved
  // orb arrangement and real connections, not a hardcoded default set.
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
  const [connections, setConnections] = useState<Connection[]>([]);
  useEffect(() => {
    if (authStatus === 'loading') return;
    let cancelled = false;
    storeApi
      .getSettings(authedFetch)
      .then((prefs) => {
        if (cancelled) return;
        if (prefs.buttons.length > 0) {
          setBarButtons(prefs.buttons);
          localStorage.setItem('understudy:bar-buttons', JSON.stringify(prefs.buttons));
        }
        // Adopt the account's theme on a fresh session (no-op once the user
        // has toggled locally — the explicit choice wins).
        syncThemeFromPrefs(prefs.theme);
      })
      .catch(() => undefined);
    storeApi
      .listConnections(authedFetch)
      .then((list) => {
        if (!cancelled) setConnections(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);
  const connectedSlugs = useMemo(() => {
    const set = new Set(connections.filter((c) => c.status === 'active').map((c) => c.toolkit));
    if (MOCK) {
      set.add('github');
      set.add('gmail');
    }
    return set;
  }, [connections]);

  // Same split as Bar.tsx: the input pseudo-button's slot decides which orbs
  // sit left vs right of the field.
  const orderedButtons = ensureInputButton(barButtons);
  const inputIdx = orderedButtons.findIndex((b) => b.id === 'input');
  const orbsBefore = orderedButtons.slice(0, inputIdx);
  const orbsAfter = orderedButtons.slice(inputIdx + 1);

  // ⌥Space must land keystrokes in the field with no click: focus it on
  // mount and again every time the overlay is summoned.
  useEffect(() => {
    const focusField = () =>
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Command"]')?.focus();
    focusField();
    return window.understudy?.onShown(focusField);
  }, []);

  useEffect(() => {
    return () => {
      runHandleRef.current?.close();
      if (liveTimeoutRef.current) window.clearTimeout(liveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const toolCall = lastTurn?.trace.lastToolCall;
    if (!toolCall) return;
    setLiveToolkit(toolCall.toolkit === 'gmail' ? 'gmail' : 'github');
    if (liveTimeoutRef.current) window.clearTimeout(liveTimeoutRef.current);
    liveTimeoutRef.current = window.setTimeout(() => setLiveToolkit(null), 900);
  }, [lastTurn?.trace.lastToolCall]);

  // The window grows and shrinks with its content, the way Spotlight does.
  // ResizeObserver reports the real rendered height to the Electron main
  // process; in a plain browser tab `understudy` is undefined and this is a
  // no-op, so the route still works at /spotlight in the dev server.
  useEffect(() => {
    const el = shellRef.current;
    if (!el || !window.understudy) return;
    const report = () => window.understudy?.setHeight(Math.ceil(el.getBoundingClientRect().height));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Esc walks back one layer at a time, the way Spotlight does: CommandBar
  // clears its own input first; with the field empty the next Esc collapses
  // the answer panel (stopping a live run); only then does Esc dismiss the
  // overlay.
  const panelOpen = turns.length > 0 && !panelHidden;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Command"]');
      if (field && field.value.length > 0) return;
      if (panelOpen) {
        runHandleRef.current?.close();
        if (running) dispatch({ type: 'stop_turn' });
        setPanelHidden(true);
      } else {
        window.understudy?.hide();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, running]);

  function handleSubmit(
    text: string,
    opts: { bypassCache: boolean; source: 'text' | 'voice'; attachments: RunAttachment[] },
  ) {
    // Captured BEFORE start_turn dispatches, so it holds only prior turns —
    // consecutive spotlight prompts thread as one session (same shape as
    // Bar.tsx's collectHistory, minus the restored-runs interleaving).
    const history: HistoryTurn[] = [];
    for (const t of turns.slice(-6)) {
      history.push({ role: 'user', text: t.prompt });
      if (t.trace.answerText) history.push({ role: 'assistant', text: t.trace.answerText });
    }
    runHandleRef.current?.close();
    setPanelHidden(false);
    dispatch({ type: 'start_turn', id: nextTurnId(), prompt: text, source: opts.source });
    runHandleRef.current = startRun({
      userId: currentUser,
      text,
      source: opts.source,
      noCache: opts.bypassCache,
      attachments: opts.attachments,
      ...(history.length > 0 ? { history } : {}),
      onEvent: (event) => dispatch({ type: 'trace_event', event }),
      onError: () => push('Run stream dropped — reconnecting…'),
    });
  }

  function handleCopy(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  const orbProps = {
    connectedSlugs,
    liveToolkit,
    policyVersion: 'v3',
    currentUser,
    onToggleUser: () => setUserIdx((i) => (i + 1) % USERS.length),
    onConnect: () => push('Connect apps from the main window'),
    // Reordering happens in the web app's settings arranger; a drag here
    // would silently overwrite the saved arrangement.
    onReorder: () => undefined,
    onOpenRoute: (path: string) => window.understudy?.openExternal(path),
  };

  return (
    <div ref={shellRef} className="spotlight-surface w-full px-5 pb-5 pt-5">
      {/* The pill sits exactly on the display's horizontal midline, the way
          macOS Spotlight centers its field: the Electron window is wider than
          the pill (desktop/main.js WIDTH) and centered, the pill is centered
          inside it, and the orb cluster hangs off the pill's right edge as
          its own floating element instead of pushing the pill off-center.
          Header height is fixed — only the answer card below changes size.
          All orbs go on the right (the web bar's before/after arrangement
          lives in prefs, which the overlay deliberately doesn't load). */}
      <div className="relative">
        <div className="mx-auto w-full max-w-[620px]">
          <CommandBar
            variant="spotlight"
            running={running}
            escalateTick={lastTurn?.trace.escalateTick ?? 0}
            onSubmit={handleSubmit}
            onFilesDropped={(files) => push(`${files.length} file${files.length === 1 ? '' : 's'} attached`)}
            onToast={push}
            // The overlay has no settings UI, so the context-aware suggestion is
            // off here — it would render nothing and cost a request per idle.
            suggestionsEnabled={false}
            recentPrompts={turns.slice(-5).map((t) => t.prompt)}
            authedFetch={authedFetch}
          />
        </div>
        {/* 50% + half the pill (310px) + a 12px gap, one cluster per side of
            the input slot so the saved arrangement reads the same as on the
            web bar. */}
        {orbsBefore.length > 0 && (
          <div className="spotlight-orbs absolute right-[calc(50%+322px)] top-1.5">
            <Orbs {...orbProps} buttons={orbsBefore} />
          </div>
        )}
        {orbsAfter.length > 0 && (
          <div className="spotlight-orbs absolute left-[calc(50%+322px)] top-1.5">
            <Orbs {...orbProps} buttons={orbsAfter} />
          </div>
        )}
      </div>

      {/* The overlay's session is Electron's own cookie jar, not the
          browser's — until the user signs in here once, runs and prefs are
          anonymous. Kept subtle: one text link, only when actually anon. */}
      {authStatus === 'anon' && window.understudy && (
        <div className="mx-auto mt-2 w-full max-w-[620px] px-1 text-right">
          <button
            type="button"
            onClick={() => window.understudy?.openAuth()}
            className="text-[11px] text-ink/35 transition-colors hover:text-ink/70"
          >
            Sign in to use your account
          </button>
        </div>
      )}

      {/* Result-only surface: the overlay shows the final answer and nothing
          else — no hop cards, no trace. The steps are persisted server-side
          per run, so "View steps on web" hands off to the full app instead of
          rendering the pipeline here. Only the LAST turn shows; prior turns
          live on in state purely as threading history. */}
      {panelOpen && lastTurn && (
        <div className="mx-auto mt-4 w-full max-w-[620px]">
          {/* A paused run (connection_required) looked like a hang in the
              result-only panel — the web app shows a connect card, here a
              compact chip opens OAuth in the system browser (window.open is
              routed there by desktop/main.js's window-open handler) and the
              worker's 5s self-poll resumes the run once linked. */}
          {running && !lastTurn.trace.answerText && lastTurn.trace.connectionGate?.status === 'waiting' ? (
            <div className="flex items-center gap-2.5 px-1 text-[12px] text-ink/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
              Needs {lastTurn.trace.connectionGate.toolkit} —
              <button
                type="button"
                onClick={() => {
                  const toolkit = lastTurn.trace.connectionGate?.toolkit;
                  if (!toolkit) return;
                  storeApi
                    .connect(authedFetch, toolkit, '/')
                    .then(({ url }) => {
                      if (url && url !== '#' && !url.includes('composio.stub')) window.open(url, '_blank', 'noopener');
                    })
                    .catch(() => push(`Could not start connecting ${toolkit}`));
                }}
                className="rounded-full border border-accent/40 px-2.5 py-0.5 text-accent-bright transition-colors hover:bg-accent/10"
              >
                Connect ↗
              </button>
              <span className="text-ink/35">then it resumes on its own</span>
            </div>
          ) : (
            running &&
            !lastTurn.trace.answerText && (
              <div className="flex items-center gap-2 px-1 text-[12px] text-ink/50">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                Working…
              </div>
            )
          )}
          {lastTurn.trace.answerText && (
            <>
              <div className="max-h-64 w-full overflow-y-auto whitespace-pre-wrap rounded-2xl border border-accent/20 bg-accent/[0.05] px-4 py-3 text-[13px] leading-relaxed text-ink/90">
                {renderMarkdownLite(lastTurn.trace.answerText)}
                {running && (
                  <span
                    className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle"
                    aria-hidden
                  />
                )}
              </div>
              {!running && (
                <div className="mt-1.5 flex items-center gap-3 px-1 text-[11px] text-ink/35">
                  <button
                    type="button"
                    onClick={() => handleCopy(lastTurn.trace.answerText ?? '')}
                    className="transition-colors hover:text-ink/70"
                  >
                    {copied ? 'copied ✓' : 'copy'}
                  </button>
                  {/* Plain <a> so the link still works at /spotlight in a
                      browser tab; inside Electron the bridge opens the real
                      browser instead of navigating the overlay. */}
                  <a
                    href="/"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (!window.understudy) return;
                      e.preventDefault();
                      window.understudy.openExternal('/');
                    }}
                    className="transition-colors hover:text-ink/70"
                  >
                    View steps on web ↗
                  </a>
                </div>
              )}
            </>
          )}
          {lastTurn.trace.status === 'error' && (
            <div className="mt-1.5 px-1 text-[12px] text-red-300/80">
              {lastTurn.trace.error ?? 'Run failed'}
            </div>
          )}
        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}
