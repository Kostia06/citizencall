// Mirrored from ui/src/store/types.ts — docs/superpowers/specs/
// 2026-08-14-per-user-store-design.md §4/§5. Kept minimal: the Expo client
// only needs the context prompt + suggestions toggle from settings (SPEC
// scope §4 "Settings (light)") and the connections list.
export interface UserPrefs {
  version: 1;
  contextPrompt: string;
  suggestions: boolean;
}

export const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  contextPrompt: '',
  suggestions: true,
};

export interface Connection {
  toolkit: string;
  status: 'active' | 'revoked' | 'error';
  connectedAt: number;
}
