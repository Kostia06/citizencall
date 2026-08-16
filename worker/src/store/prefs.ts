export interface UserPrefs {
  version: 1;
  keybindings: Record<string, string>;
  buttons: Array<{ id: string; action: string; icon?: string; label?: string }>;
  contextPrompt: string;
  /** Next-action ghost suggestions in the command bar (Settings toggle). */
  suggestions: boolean;
  /** UI theme; absent = follow prefers-color-scheme (UI-side default dark). */
  theme?: 'dark' | 'light';
  /** Horizontal placement of the command-bar cluster (input + orbs). */
  barAlignment?: 'left' | 'center' | 'right';
}

export const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  keybindings: { run: 'Enter', newline: 'Shift+Enter', bypassCache: 'Mod+Enter', focus: 'Mod+K', clear: 'Escape' },
  buttons: [
    { id: 'github', action: 'connect:github' },
    { id: 'gmail', action: 'connect:gmail' },
    { id: 'policy', action: 'open:roster' },
    { id: 'theme', action: 'toggle:theme' },
  ],
  contextPrompt: '',
  suggestions: true,
};

// The UI's Save sends the FULL draft, so every field the UI can hold must be
// allowed here — an unknown key 400s the whole PUT (found in review: the
// suggestions toggle and theme choice silently failed to persist live).
const ALLOWED_KEYS = new Set(['version', 'keybindings', 'buttons', 'contextPrompt', 'suggestions', 'theme', 'barAlignment']);

export function validatePrefsPatch(patch: unknown): { ok: true; value: Partial<UserPrefs> } | { ok: false; reason: string } {
  if (typeof patch !== 'object' || patch === null) return { ok: false, reason: 'Body must be an object.' };
  for (const k of Object.keys(patch)) if (!ALLOWED_KEYS.has(k)) return { ok: false, reason: `Unknown pref key: ${k}` };
  const p = patch as Record<string, unknown>;
  if ('keybindings' in p && (typeof p.keybindings !== 'object' || p.keybindings === null)) return { ok: false, reason: 'keybindings must be an object.' };
  if ('buttons' in p && !Array.isArray(p.buttons)) return { ok: false, reason: 'buttons must be an array.' };
  if ('contextPrompt' in p && typeof p.contextPrompt !== 'string') return { ok: false, reason: 'contextPrompt must be a string.' };
  if ('suggestions' in p && typeof p.suggestions !== 'boolean') return { ok: false, reason: 'suggestions must be a boolean.' };
  if ('theme' in p && p.theme !== 'dark' && p.theme !== 'light') return { ok: false, reason: "theme must be 'dark' or 'light'." };
  if ('barAlignment' in p && !['left', 'center', 'right'].includes(p.barAlignment as string)) return { ok: false, reason: "barAlignment must be 'left', 'center' or 'right'." };
  return { ok: true, value: p as Partial<UserPrefs> };
}

// Top-level keys shallow-merged; keybindings shallow-merged; arrays replaced.
export function mergePrefs(base: UserPrefs, patch: Partial<UserPrefs>): UserPrefs {
  return {
    version: 1,
    keybindings: { ...base.keybindings, ...(patch.keybindings ?? {}) },
    buttons: patch.buttons ?? base.buttons,
    contextPrompt: patch.contextPrompt ?? base.contextPrompt,
    suggestions: patch.suggestions ?? base.suggestions ?? true,
    ...(patch.theme ?? base.theme ? { theme: patch.theme ?? base.theme } : {}),
    ...(patch.barAlignment ?? base.barAlignment ? { barAlignment: patch.barAlignment ?? base.barAlignment } : {}),
  };
}
