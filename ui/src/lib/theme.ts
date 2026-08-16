// Dark/light theme controller — web UI design spec, dark/light mode slice.
// Source of truth is layered: localStorage (explicit user choice, wins
// forever once set) > prefs.theme (account-level, adopted only when this
// browser has no explicit choice yet) > prefers-color-scheme > 'dark'.
//
// Applied via a `data-theme` attribute on <html> — index.css defines the
// dark palette on :root and light overrides under `[data-theme='light']`.
// `applyTheme` also runs once at module load (before any component mounts)
// so there's never a flash of the wrong theme on first paint.
import { useCallback, useEffect, useState } from 'react';
import { storeApi } from '../api';
import type { AuthedFetch } from '../api';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'understudy:theme';

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedTheme(): Theme | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return isTheme(raw) ? raw : null;
}

function resolveInitialTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

applyTheme(resolveInitialTheme());

/** Adopts an account's saved theme into this browser — called once Settings
 * (or anywhere else) loads `UserPrefs` from the server. No-ops if the user
 * has already made an explicit local choice, so it can never fight a live
 * toggle; only fills in a fresh browser/session. */
export function syncThemeFromPrefs(prefsTheme: Theme | undefined) {
  if (!prefsTheme || storedTheme()) return;
  localStorage.setItem(STORAGE_KEY, prefsTheme);
  applyTheme(prefsTheme);
}

const CHANGE_EVENT = 'understudy:theme-change';

/** Hook-free toggle for non-component callers (the bar's `toggle:theme`
 * orb). Applies + stores immediately and notifies every mounted useTheme
 * (TopNav's icon) via a window event so nothing shows a stale state. */
export function toggleThemeGlobal(): Theme {
  const next: Theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  return next;
}

/** The toggle's controller — TopNav is the only mounted consumer (one
 * instance per route, so there's never a stale-sibling sync problem). Saves
 * to localStorage synchronously and, when `authedFetch` is supplied, fires
 * `putSettings({ theme })` best-effort so the choice follows the account.
 * Failures (anon, offline) are swallowed — theme already lives in
 * localStorage regardless. */
export function useTheme(authedFetch?: AuthedFetch) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Stay in sync with out-of-hook toggles (the bar's theme orb).
  useEffect(() => {
    const onGlobal = (e: Event) => {
      const next = (e as CustomEvent).detail;
      if (isTheme(next)) setThemeState(next);
    };
    window.addEventListener(CHANGE_EVENT, onGlobal);
    return () => window.removeEventListener(CHANGE_EVENT, onGlobal);
  }, []);

  // Follow the OS preference live, but only until the user picks explicitly.
  useEffect(() => {
    if (storedTheme()) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setThemeState(systemTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      localStorage.setItem(STORAGE_KEY, next);
      if (authedFetch) {
        storeApi.putSettings(authedFetch, { theme: next }).catch(() => undefined);
      }
    },
    [authedFetch],
  );

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
