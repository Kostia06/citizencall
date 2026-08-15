// Trailing-edge debounce — used by the command bar's idle "next action"
// suggest fetch (900ms after the user stops typing while the bar is empty
// and focused, mirroring ui/src/components/CommandBar.tsx's SUGGEST_IDLE_MS).
// Framework-free so it's unit-testable without rendering a component; the
// React wiring (useEffect calling/cancelling it) lives in useNextAction.ts.
export interface Debounced<Args extends unknown[]> {
  call(...args: Args): void;
  cancel(): void;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call(...args: Args) {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn(...args);
      }, ms);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
