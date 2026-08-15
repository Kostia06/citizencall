import { useCallback, useRef, useState } from 'react';

/** One-shot CSS-animation trigger: `fire()` flips a boolean on, then off
 * again after `durationMs`, so a className can be toggled to replay a
 * keyframe animation from the start every time (unlike a static class,
 * which only plays once on mount). Used for the command bar's confirm
 * pulse, bypass-cache ember flash, and focus glow — DESIGN.md §5/§6. */
export function useBurst(durationMs: number): [boolean, () => void] {
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  const fire = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    // Force a reflow-driven restart: turn off, then on next frame.
    setActive(false);
    requestAnimationFrame(() => {
      setActive(true);
      timeoutRef.current = window.setTimeout(() => setActive(false), durationMs);
    });
  }, [durationMs]);

  return [active, fire];
}
