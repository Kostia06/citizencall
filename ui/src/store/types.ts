// Prefs/connection types mirrored from the per-user store spec —
// docs/superpowers/specs/2026-08-14-per-user-store-design.md §4/§5.
export interface UserPrefsButton {
  id: string;
  action: string;
  icon?: string;
  label?: string;
}

export interface UserPrefs {
  version: 1;
  keybindings: Record<string, string>; // action -> key combo, e.g. { run: 'Enter' }
  buttons: UserPrefsButton[];
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

/** The fixed keybinding actions the editor exposes — spec §5. */
export const KEYBINDING_ACTIONS = ['run', 'newline', 'bypassCache', 'focus', 'clear'] as const;

/** Fixed action list bar buttons can be assigned to — web UI spec §5. No
 * add/remove/reorder; the four button slots (github/gmail/policy/user) are
 * fixed, only their action + label are editable. */
export const FIXED_BUTTON_ACTIONS = [
  'connect:github',
  'connect:gmail',
  'open:roster',
  'toggle:user',
  'run',
  'bypassCache',
] as const;
export type FixedButtonAction = (typeof FIXED_BUTTON_ACTIONS)[number];

export interface Connection {
  toolkit: string;
  status: 'active' | 'revoked' | 'error';
  connectedAt: number;
}
