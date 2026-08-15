import { useEffect, useReducer, useRef, useState } from 'react';
import CommandBar from '../components/CommandBar';
import Orbs from '../components/Orbs';
import TracePipeline from '../components/TracePipeline';
import { ToastStack, useToasts } from '../components/Toast';
import { startRun, type RunHandle } from '../api';
import { initialTraceState, traceReducer } from '../lib/traceReducer';

const USERS = ['demo_kos', 'demo_teammate'];

/** Spotlight surface — the bar and nothing else. Same components as Bar.tsx,
 * minus every piece of page chrome (nav links, MOCK badge, page padding), and
 * on a transparent background so the Electron shell's vibrancy shows through.
 *
 * This route is what desktop/main.js loads. It is deliberately a SEPARATE
 * route rather than a prop on Bar.tsx so the browser build keeps its own
 * layout untouched. */
export default function Spotlight() {
  const [trace, dispatch] = useReducer(traceReducer, undefined, initialTraceState);
  const [userIdx, setUserIdx] = useState(0);
  const [liveToolkit, setLiveToolkit] = useState<'github' | 'gmail' | null>(null);
  const { toasts, push } = useToasts();
  const runHandleRef = useRef<RunHandle | null>(null);
  const liveTimeoutRef = useRef<number | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);

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
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Command"]');
      if (!input || input.value.length === 0) window.understudy?.hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentUser = USERS[userIdx];
  const running = trace.status === 'running';

  function handleSubmit(text: string, opts: { bypassCache: boolean; source: 'text' | 'voice' }) {
    runHandleRef.current?.close();
    runHandleRef.current = startRun({
      userId: currentUser,
      text,
      source: opts.source,
      noCache: opts.bypassCache,
      onEvent: dispatch,
      onError: () => push('Run stream dropped — reconnecting…'),
    });
  }

  return (
    <div ref={shellRef} className="spotlight-surface w-full px-5 pb-5 pt-5">
      <CommandBar
        variant="spotlight"
        running={running}
        escalateTick={trace.escalateTick}
        onSubmit={handleSubmit}
        onFilesDropped={(files) => push(`${files.length} file${files.length === 1 ? '' : 's'} attached`)}
        onToast={push}
      />

      {/* The orbs are controls, not content — they sit under the field at low
          contrast and come up to full strength on hover, so the resting state
          is just the search field. */}
      <div className="spotlight-orbs mt-3 flex justify-center">
        <Orbs
          githubConnected
          gmailConnected
          liveToolkit={liveToolkit}
          policyVersion="v3"
          currentUser={currentUser}
          onToggleUser={() => setUserIdx((i) => (i + 1) % USERS.length)}
          onOpenPolicy={() => window.understudy?.openExternal('/roster')}
        />
      </div>

      <TracePipeline state={trace} />

      <ToastStack toasts={toasts} />
    </div>
  );
}
