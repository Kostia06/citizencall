import type { Transition } from 'framer-motion';

// Spring configs — DESIGN.md §3. Shared so every component reaches for the
// same three feels instead of hand-tuning transitions ad hoc.
export const entranceStandard: Transition = { type: 'spring', stiffness: 210, damping: 26, mass: 1 };
export const magneticSnappy: Transition = { type: 'spring', stiffness: 420, damping: 18, mass: 0.9 };
export const layoutFlow: Transition = { type: 'spring', stiffness: 300, damping: 32, mass: 1 };

// Reduced-motion equivalents — DESIGN.md §3 fallback table. Each caller picks
// the reduced variant via framer-motion's own `useReducedMotion()` hook.
export const entranceStandardReduced: Transition = { duration: 0.15, ease: 'linear' };
export const layoutFlowReduced: Transition = { duration: 0 };

// Mesh gradient stops — DESIGN.md §2, background only, never used as
// foreground UI color.
export const MESH_COLORS = [
  '#0B0F2E', // mesh-1 deep indigo-navy
  '#1B1464', // mesh-2 violet-indigo
  '#5B8CFF', // mesh-3 signal blue
  '#22D3EE', // mesh-4 cyan
  '#7C3AED', // mesh-5 violet
  '#FF4D8D', // mesh-6 magenta
] as const;

/** Line-break-preserving variants for the Roster headline reveal —
 * DESIGN.md §5 Roster: translateY(24px) blur(8px) opacity:0 → settled,
 * staggerChildren 0.06. framer-motion's `animate`/`transition` never goes
 * through the CSS cascade, so the blanket `prefers-reduced-motion` rule in
 * index.css can't touch it — callers must pass the resolved
 * `useReducedMotion()` value in explicitly. DESIGN.md §3 fallback table:
 * opacity fade only, 150ms linear, no transform/blur; stagger removed. */
export function headlineVariants(reduceMotion: boolean) {
  return {
    parent: {
      hidden: {},
      show: { transition: { staggerChildren: reduceMotion ? 0 : 0.06 } },
    },
    line: reduceMotion
      ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: entranceStandardReduced } }
      : {
          hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
          show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: entranceStandard },
        },
  };
}
