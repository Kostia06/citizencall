import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import CommandBar from '../components/CommandBar';
import ConversationTurn from '../components/ConversationTurn';
import Orbs from '../components/Orbs';
import { ToastStack, useToasts } from '../components/Toast';
import { DEFAULT_PREFS, startRun, type RunHandle, type UserPrefsButton } from '../api';
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

  // Esc closes the overlay. CommandBar already uses Esc to clear its own
  // input, so this only fires once the field is empty — clear first, then
  // dismiss, which is exactly Spotlight's behaviour.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Command"]');
      if (!field || field.value.length === 0) window.understudy?.hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleSubmit(
    text: string,
    opts: { bypassCache: boolean; source: 'text' | 'voice'; attachments: RunAttachment[] },
  ) {
    runHandleRef.current?.close();
    dispatch({ type: 'start_turn', id: nextTurnId(), prompt: text, source: opts.source });
    runHandleRef.current = startRun({
      userId: currentUser,
      text,
      source: opts.source,
      noCache: opts.bypassCache,
      attachments: opts.attachments,
      onEvent: (event) => dispatch({ type: 'trace_event', event }),
      onError: () => push('Run stream dropped — reconnecting…'),
    });
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

      {turns.length > 0 && (
        <div className="mt-5">
          {turns.map((turn) => (
            <ConversationTurn key={turn.id} turn={turn} animate={turn.id === lastTurn?.id && running} />
          ))}
        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}
