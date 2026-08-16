// Ported from ui/src/components/CommandBar.tsx's next-action ghost logic:
// fetch once right after a run completes with an empty bar, or after
// SUGGEST_IDLE_MS of no typing while focused+empty. A sequence counter
// drops any response superseded by a newer fetch — same idea as the trace
// stream's reconnect guard — so a slow request never clobbers fresher state.
import { useEffect, useRef, useState } from 'react';
import { debounce } from '../../lib/debounce';
import { storeApi, type AuthedFetch } from '../../api/storeClient';

const SUGGEST_IDLE_MS = 900;

export interface UseNextActionOpts {
  /** Settings toggle — when off, never fetches or shows a suggestion. */
  enabled: boolean;
  running: boolean;
  focused: boolean;
  value: string;
  /** Last few user prompts, most recent last — sent as suggest() context. */
  recentPrompts: string[];
  authedFetch: AuthedFetch;
}

export interface UseNextAction {
  /** The suggestion text, or null when there's none to show. Already gated
   * on `enabled` and the input being empty — callers don't need to re-check. */
  nextAction: string | null;
  /** Accepting the ghost (the "use" chip) fills the input and clears it. */
  dismiss(): void;
}

export function useNextAction(opts: UseNextActionOpts): UseNextAction {
  const { enabled, running, focused, value, recentPrompts, authedFetch } = opts;
  const [nextAction, setNextAction] = useState<string | null>(null);
  const seqRef = useRef(0);
  const authedFetchRef = useRef(authedFetch);
  const recentPromptsRef = useRef(recentPrompts);
  authedFetchRef.current = authedFetch;
  recentPromptsRef.current = recentPrompts;

  const fetchNextAction = useRef(() => {
    const seq = ++seqRef.current;
    storeApi
      .suggest(authedFetchRef.current, recentPromptsRef.current)
      .then(({ suggestion }) => {
        // Stale (superseded by a newer fetch) — drop it silently.
        if (seq !== seqRef.current || !suggestion) return;
        setNextAction(suggestion);
      })
      .catch(() => undefined); // fail silent — no suggestion shown
  }).current;

  const debounced = useRef(debounce(fetchNextAction, SUGGEST_IDLE_MS)).current;

  // Fetch right after a turn completes, so the ghost is ready the instant
  // the bar clears — not gated on focus, since a completed run often leaves
  // the bar unfocused.
  const wasRunningRef = useRef(running);
  useEffect(() => {
    if (wasRunningRef.current && !running && enabled && value.trim().length === 0) {
      fetchNextAction();
    }
    wasRunningRef.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, enabled]);

  // Debounced idle fetch while focused and empty — cancelled the moment any
  // dependency changes, so new input never queues a stale request behind it.
  useEffect(() => {
    if (!enabled || running || !focused || value.trim().length > 0) {
      debounced.cancel();
      return;
    }
    debounced.call();
    return () => debounced.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, running, focused, value]);

  // Toggled off in Settings mid-session — clear whatever's showing.
  useEffect(() => {
    if (!enabled) setNextAction(null);
  }, [enabled]);

  return {
    nextAction: enabled && !running && value.length === 0 ? nextAction : null,
    dismiss: () => setNextAction(null),
  };
}
