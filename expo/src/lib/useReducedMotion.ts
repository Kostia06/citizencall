import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** RN equivalent of ui/src/lib/motion's framer-motion `useReducedMotion` —
 * wraps AccessibilityInfo's reduce-motion query + change listener. Used to
 * skip the suggestion-list fade-in and ghost-chip transition when the user
 * has Reduce Motion enabled (DESIGN.md §3's per-class reduced-motion table). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
