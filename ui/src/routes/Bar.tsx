import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import CommandBar from '../components/CommandBar';
import ConversationTurn from '../components/ConversationTurn';
import Orbs from '../components/Orbs';
import { ToastStack, useToasts } from '../components/Toast';
import AuthNav from '../components/AuthNav';
import { MOCK, startRun, type RunHandle } from '../api';
import { conversationReducer, initialConversationState } from '../lib/traceReducer';
import { layoutFlow, layoutFlowReduced } from '../lib/motion';
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

  function handleSubmit(
    text: string,
    opts: { bypassCache: boolean; source: 'text' | 'voice'; attachments: RunAttachment[] },
  ) {
    runHandleRef.current?.close();
    stickToBottomRef.current = true;
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
    <div className="relative flex h-screen w-full flex-col overflow-hidden px-6">
      {/* pinned top nav */}
      <div className="absolute inset-x-0 top-0 z-10 px-6 pt-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between text-[11px] text-white/30">
          <span>understudy</span>
          <div className="flex items-center gap-4">
            {MOCK && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent-bright">
                MOCK
              </span>
            )}
            <Link to="/roster" className="transition-colors hover:text-white/70">
              roster
            </Link>
            <Link to="/benchmark" className="transition-colors hover:text-white/70">
              benchmark
            </Link>
            <AuthNav />
          </div>
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
            />
          </div>
          <div className="sm:pt-1.5">
            <Orbs
              githubConnected
              gmailConnected
              liveToolkit={liveToolkit}
              policyVersion="v3"
              currentUser={currentUser}
              onToggleUser={() => setUserIdx((i) => (i + 1) % USERS.length)}
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
          className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto pb-8"
        >
          {turns.map((turn) => (
            <ConversationTurn key={turn.id} turn={turn} />
          ))}
        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}
