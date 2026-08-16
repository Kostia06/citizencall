import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import CommandBar from '../components/CommandBar';
import Orbs from '../components/Orbs';
import { ToastStack, useToasts } from '../components/Toast';
import { renderMarkdownLite } from '../components/chat/MarkdownLite';
import { DEFAULT_PREFS, startRun, type HistoryTurn, type RunHandle, type UserPrefsButton } from '../api';
import { conversationReducer, initialConversationState } from '../lib/traceReducer';
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
  const { authedFetch } = useAuth();
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

  // The overlay is a launcher, not a settings surface, so it renders the
  // DEFAULT button set rather than loading per-user prefs — one less network
  // dependency on a window that must appear instantly.
  const barButtons = useMemo<UserPrefsButton[]>(() => DEFAULT_PREFS.buttons, []);
  const connectedSlugs = useMemo(() => new Set(['github', 'gmail']), []);

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

  return (
    <div ref={shellRef} className="spotlight-surface w-full px-5 pb-5 pt-5">
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

      {/* The orbs are controls, not content — they sit under the field at low
          contrast and come up to full strength on hover, so the resting state
          is just the search field. */}
      <div className="spotlight-orbs mt-3 flex justify-center">
        <Orbs
          buttons={barButtons}
          connectedSlugs={connectedSlugs}
          liveToolkit={liveToolkit}
          policyVersion="v3"
          currentUser={currentUser}
          onToggleUser={() => setUserIdx((i) => (i + 1) % USERS.length)}
          onConnect={() => push('Connect apps from the main window')}
          // Reordering persists to prefs, which the overlay deliberately
          // doesn't load — so it's a no-op here rather than a silent write.
          onReorder={() => undefined}
          onOpenRoute={(path) => window.understudy?.openExternal(path)}
        />
      </div>

      {/* Result-only surface: the overlay shows the final answer and nothing
          else — no hop cards, no trace. The steps are persisted server-side
          per run, so "View steps on web" hands off to the full app instead of
          rendering the pipeline here. Only the LAST turn shows; prior turns
          live on in state purely as threading history. */}
      {panelOpen && lastTurn && (
        <div className="mt-4">
          {running && !lastTurn.trace.answerText && (
            <div className="flex items-center gap-2 px-1 text-[12px] text-white/50">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
              Working…
            </div>
          )}
          {lastTurn.trace.answerText && (
            <>
              <div className="max-h-64 w-full overflow-y-auto whitespace-pre-wrap rounded-2xl border border-accent/20 bg-accent/[0.05] px-4 py-3 text-[13px] leading-relaxed text-white/90">
                {renderMarkdownLite(lastTurn.trace.answerText)}
                {running && (
                  <span
                    className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle"
                    aria-hidden
                  />
                )}
              </div>
              {!running && (
                <div className="mt-1.5 flex items-center gap-3 px-1 text-[11px] text-white/35">
                  <button
                    type="button"
                    onClick={() => handleCopy(lastTurn.trace.answerText ?? '')}
                    className="transition-colors hover:text-white/70"
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
                    className="transition-colors hover:text-white/70"
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
