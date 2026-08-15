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

/** The primary screen — SPEC.md §6. The command bar sits in the complete
 * centre of the viewport; as TraceEvents arrive the bar+trace group re-centres
 * (the bar drifts up to make room). On narrow screens the orbs stack BELOW the
 * bar instead of beside it. */
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
    <div className="relative min-h-screen w-full px-6">
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
          </div>
        </div>
      </div>

      {/* command bar centred in the complete viewport; the bar+trace group
          re-centres as the trace grows (bar drifts up to make room). */}
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 pb-24 pt-24">
        {/* orbs sit beside the bar on wide screens, BELOW it on narrow ones */}
        <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="w-full flex-1">
            <CommandBar
              running={running}
              escalateTick={trace.escalateTick}
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

        <div className="w-full">
          <TracePipeline state={trace} />
        </div>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
