import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import CommandBar from '../components/CommandBar';
import ConversationTurn from '../components/ConversationTurn';
import Orbs from '../components/Orbs';
import { ToastStack, useToasts } from '../components/Toast';
import TopNav from '../components/TopNav';
import { DEFAULT_PREFS, MOCK, startRun, storeApi, type Connection, type RunHandle, type UserPrefsButton } from '../api';
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
  const { authedFetch, status } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [contextPrompt, setContextPrompt] = useState('');
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [barButtons, setBarButtons] = useState<UserPrefsButton[]>(DEFAULT_PREFS.buttons);
  const reorderSaveRef = useRef<number | undefined>(undefined);
  const runHandleRef = useRef<RunHandle | null>(null);
  const liveTimeoutRef = useRef<number | undefined>(undefined);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const reduceMotion = useReducedMotion();

  const turns = conversation.turns;
  const hasTurns = turns.length > 0;
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
  useEffect(() => {
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
          if (prefs.buttons.length > 0) setBarButtons(prefs.buttons);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authedFetch]);

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
  }, [conversation]);

  function handleTranscriptScroll() {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  const currentUser = USERS[userIdx];
  // Preserves the existing "always connected" demo look in MOCK mode and
  // for anonymous visitors; once authed against a live backend the orbs
  // reflect real GET /api/connections state.
  const mockConnectedFallback = MOCK || status !== 'authed';
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
    if (reorderSaveRef.current) window.clearTimeout(reorderSaveRef.current);
    reorderSaveRef.current = window.setTimeout(() => {
      storeApi.putSettings(authedFetch, { buttons: next }).catch(() => undefined);
    }, 800);
  }

  // Orb click on an unconnected toolkit — same flow as the settings grid:
  // POST /api/connect, open the returned Composio OAuth URL. MOCK mode fakes
  // the connect and just refreshes the list.
  function handleOrbConnect(slug: string) {
    storeApi
      .connect(authedFetch, slug)
      .then(({ url }) => {
        // Never open a stub-mode link (worker without a Composio key) — the
        // domain doesn't exist; the connect is already faked server-side.
        if (url && !MOCK && !url.includes('composio.stub')) window.open(url, '_blank', 'noopener');
        return storeApi.listConnections(authedFetch);
      })
      .then((list) => setConnections(list))
      .catch(() => push(`Could not start connecting ${slug}`));
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
      text: sendText,
      source: opts.source,
      noCache: opts.bypassCache,
      attachments: opts.attachments,
      onEvent: (event) => dispatch({ type: 'trace_event', event }),
      onError: () => push('Run stream dropped — reconnecting…'),
    });
  }

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
        className={`mx-auto flex w-full max-w-2xl shrink-0 flex-col ${
          hasTurns ? 'pt-24 pb-4' : 'flex-1 items-center justify-center'
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
            />
          </div>
        </div>
      </motion.div>

      {/* Transcript — its own vertically-scrollable region, so old turns
          scroll out of view while the bar above stays put. */}
      {hasTurns && (
        <div
          ref={transcriptRef}
          onScroll={handleTranscriptScroll}
          className="transcript-scroll mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto pb-8"
        >
          {turns.map((turn) => (
            <ConversationTurn
              key={turn.id}
              turn={turn}
              animate={turn.id === lastTurn?.id && running}
              authedFetch={authedFetch}
            />
          ))}
        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}
