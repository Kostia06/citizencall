export interface UserPrefs {
  version: 1;
  keybindings: Record<string, string>;
  buttons: Array<{ id: string; action: string; icon?: string; label?: string }>;
  contextPrompt: string;
}

export const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  keybindings: { run: 'Enter', newline: 'Shift+Enter', bypassCache: 'Mod+Enter', focus: 'Mod+K', clear: 'Escape' },
  buttons: [
    { id: 'github', action: 'connect:github' },
    { id: 'gmail', action: 'connect:gmail' },
    { id: 'policy', action: 'open:roster' },
    { id: 'user', action: 'toggle:user' },
  ],
  contextPrompt: '',
};

const ALLOWED_KEYS = new Set(['version', 'keybindings', 'buttons', 'contextPrompt']);

export function validatePrefsPatch(patch: unknown): { ok: true; value: Partial<UserPrefs> } | { ok: false; reason: string } {
  if (typeof patch !== 'object' || patch === null) return { ok: false, reason: 'Body must be an object.' };
  for (const k of Object.keys(patch)) if (!ALLOWED_KEYS.has(k)) return { ok: false, reason: `Unknown pref key: ${k}` };
  const p = patch as Record<string, unknown>;
  if ('keybindings' in p && (typeof p.keybindings !== 'object' || p.keybindings === null)) return { ok: false, reason: 'keybindings must be an object.' };
  if ('buttons' in p && !Array.isArray(p.buttons)) return { ok: false, reason: 'buttons must be an array.' };
  if ('contextPrompt' in p && typeof p.contextPrompt !== 'string') return { ok: false, reason: 'contextPrompt must be a string.' };
  return { ok: true, value: p as Partial<UserPrefs> };
}

// Top-level keys shallow-merged; keybindings shallow-merged; arrays replaced.
export function mergePrefs(base: UserPrefs, patch: Partial<UserPrefs>): UserPrefs {
  return {
    version: 1,
    keybindings: { ...base.keybindings, ...(patch.keybindings ?? {}) },
    buttons: patch.buttons ?? base.buttons,
    contextPrompt: patch.contextPrompt ?? base.contextPrompt,
  };
}
