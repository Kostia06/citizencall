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
  /** Context-aware next-action ghost suggestion in the command bar —
   * on by default, toggled in /settings. */
  suggestions: boolean;
  /** Account-level dark/light choice — optional so older rows/anon drafts
   * omit it entirely (means "no saved preference", not "dark"). Mirrors
   * `Theme` in lib/theme.ts; kept as a literal here rather than imported to
   * avoid a store/types -> lib dependency. Written by the TopNav toggle via
   * `putSettings({ theme })`, read back by `syncThemeFromPrefs` on load. */
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
    { id: 'user', action: 'toggle:user' },
  ],
  contextPrompt: '',
  suggestions: true,
};

/** The command-bar input as a positionable pseudo-button — dragged in the
 * arranger exactly like an orb, so its slot in `buttons` decides whether the
 * text field sits left of, between, or right of the orbs. It has no action;
 * Bar.tsx splits the row around it and Orbs never renders it. */
export const INPUT_BUTTON: UserPrefsButton = { id: 'input', action: 'input' };

/** Saved prefs predate the input slot — older rows lack it, so normalize by
 * prepending (input-first matches the historical layout). */
export function ensureInputButton(buttons: UserPrefsButton[]): UserPrefsButton[] {
  return buttons.some((b) => b.id === 'input') ? buttons : [INPUT_BUTTON, ...buttons];
}

/** The fixed keybinding actions the editor exposes — spec §5. */
export const KEYBINDING_ACTIONS = ['run', 'newline', 'bypassCache', 'focus', 'clear'] as const;

/** Fixed action list bar buttons can be assigned to — web UI spec §5. No
 * add/remove/reorder; the four button slots (github/gmail/policy/user) are
 * fixed, only their action + label are editable. `suggest` triggers/toggles
 * the context-aware next-action suggestion (see CommandBar); like the other
 * actions here, wiring a slot's click to it is deferred the same way
 * keybinding remapping is (Bar.tsx) — the persistent Settings toggle is the
 * primary control for now.
 */
export const FIXED_BUTTON_ACTIONS = [
  'connect:github',
  'connect:gmail',
  'toggle:user',
  // 'toggle:theme' retired — dark-only (lib/theme.ts); stale saved buttons
  // with that action are hidden by Orbs and ignored here.
  'run',
  'bypassCache',
  'suggest',
] as const;
export type FixedButtonAction = (typeof FIXED_BUTTON_ACTIONS)[number];

export interface Connection {
  toolkit: string;
  status: 'active' | 'revoked' | 'error';
  connectedAt: number;
}

/** A user-added custom MCP server — worker table `user_mcps` (id/name/
 * enabled/createdAt persist; `url`/`headers` live inside `config_json` but
 * the list route only ever returns id/name/enabled/createdAt, so a live
 * (non-MOCK) reload can't recover them — callers keep their own optimistic
 * copy after create/edit. See CustomMcpsPanel.tsx. */
export interface UserMcp {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  url?: string;
  headers?: Record<string, string>;
}

/** Per-user tool enable/disable override — worker table `user_tools`.
 * `tool: '*'` is this UI's convention for "every tool in this toolkit" on
 * toolkits with no known static tool list (ToolCustomizePanel.tsx). */
export interface ToolOverride {
  toolkit: string;
  tool: string;
  enabled: boolean;
}

/** A user-defined scheduled/manual prompt — worker table `routines` (not yet
 * built; contract: GET/POST/PUT/DELETE `/api/routines(/:id)`, see api.ts's
 * `storeApi.listRoutines` etc). Bar orbs bind to one via the `routine:<id>`
 * action (Orbs.tsx / ButtonEditor.tsx); RoutinesPanel.tsx (Settings) owns
 * CRUD. `schedule: 'none'` means manual-trigger-only (orb click / bar). */
export const ROUTINE_SCHEDULES = ['none', 'hourly', 'daily', 'weekly'] as const;
export type RoutineSchedule = (typeof ROUTINE_SCHEDULES)[number];

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
}
