import { useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CommandBar from '../components/CommandBar';
import Orbs from '../components/Orbs';
import TracePipeline from '../components/TracePipeline';
import { ToastStack, useToasts } from '../components/Toast';
import { MOCK, startRun, type RunHandle } from '../api';
import { initialTraceState, traceReducer } from '../lib/traceReducer';
import type { RunAttachment } from '../types';

const USERS = ['demo_kos', 'demo_teammate'];

/** The primary screen — SPEC.md §6. Bar pinned at top, trace expands
 * downward as TraceEvents arrive (live SSE, or the scripted mock replay). */
export default function Bar() {
  const [trace, dispatch] = useReducer(traceReducer, undefined, initialTraceState);
  const [userIdx, setUserIdx] = useState(0);
  const [liveToolkit, setLiveToolkit] = useState<'github' | 'gmail' | null>(null);
  const { toasts, push } = useToasts();
  const runHandleRef = useRef<RunHandle | null>(null);
  const liveTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      runHandleRef.current?.close();
      if (liveTimeoutRef.current) window.clearTimeout(liveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!trace.lastToolCall) return;
    setLiveToolkit(trace.lastToolCall.toolkit === 'gmail' ? 'gmail' : 'github');
    if (liveTimeoutRef.current) window.clearTimeout(liveTimeoutRef.current);
    liveTimeoutRef.current = window.setTimeout(() => setLiveToolkit(null), 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace.lastToolCall]);

  const currentUser = USERS[userIdx];
  const running = trace.status === 'running';

  function handleSubmit(
    text: string,
    opts: { bypassCache: boolean; source: 'text' | 'voice'; attachments: RunAttachment[] },
  ) {
    runHandleRef.current?.close();
    runHandleRef.current = startRun({
      userId: currentUser,
      text,
      source: opts.source,
      noCache: opts.bypassCache,
      attachments: opts.attachments,
      onEvent: dispatch,
      onError: () => push('Run stream dropped — reconnecting…'),
    });
  }

  return (
    <div className="min-h-screen w-full px-6 pb-32 pt-14">
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
        </div>
      </div>

      <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3">
        <div className="flex-1">
          <CommandBar
            running={running}
            escalateTick={trace.escalateTick}
            onSubmit={handleSubmit}
            onFilesDropped={(files) => push(`${files.length} file${files.length === 1 ? '' : 's'} attached`)}
            onToast={push}
          />
        </div>
        <div className="pt-1.5">
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

      <TracePipeline state={trace} />

      <ToastStack toasts={toasts} />
    </div>
  );
}
