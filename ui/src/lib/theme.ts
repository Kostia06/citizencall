// Dark only — the light theme was cut by decision (2026-08-16): the product
// look IS the dark premium surface, and maintaining light parity cost more
// than it added. The Theme type and the exported no-op shims keep old
// callers (prefs.theme, saved `toggle:theme` buttons, useTheme consumers)
// compiling and harmless; the attribute is pinned before first paint so
// nothing ever flashes.
import { useCallback, useState } from 'react';
import type { AuthedFetch } from '../api';

export type Theme = 'dark' | 'light';

function applyDark() {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.style.colorScheme = 'dark';
}

applyDark();

/** Account theme adoption is retired with the light theme — kept as a shim
 * so Settings/Spotlight callers need no changes. */
export function syncThemeFromPrefs(_prefsTheme: Theme | undefined) {
  applyDark();
}

/** The bar's old `toggle:theme` orb action — now a no-op (the orb itself is
 * hidden in Orbs.tsx, this shim just guards any stale saved button). */
export function toggleThemeGlobal(): Theme {
  applyDark();
  return 'dark';
}

/** Always-dark controller — TopNav's toggle button is gone; any remaining
 * consumer sees a stable 'dark' and inert setters. `authedFetch` is accepted
 * (and ignored) for signature compatibility. */
export function useTheme(_authedFetch?: AuthedFetch) {
  const [theme] = useState<Theme>('dark');
  const setTheme = useCallback((_next: Theme) => applyDark(), []);
  const toggleTheme = useCallback(() => applyDark(), []);
  return { theme, setTheme, toggleTheme };
}
