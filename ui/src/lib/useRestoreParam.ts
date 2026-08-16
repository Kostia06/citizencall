import { useEffect, useRef } from 'react';

/** Deep-link contract for the notifications drawer: it navigates to
 * `/?restore=<runId>`, and the home route (Bar.tsx) calls this hook with its
 * existing handleSelectSession to jump into that run as a restored session.
 *
 * On mount, reads `?restore=` once, strips it via history.replaceState
 * BEFORE invoking the callback (so a re-render or back-nav never replays the
 * restore), then calls `onRestore(runId)`. No-op when the param is absent. */
export function useRestoreParam(onRestore: (runId: string) => void): void {
  // Ref, not effect deps: callers pass inline closures, and the restore must
  // fire exactly once per page load regardless of identity churn.
  const fired = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const params = new URLSearchParams(window.location.search);
    const runId = params.get('restore');
    if (!runId) return;
    params.delete('restore');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    onRestoreRef.current(runId);
  }, []);
}
