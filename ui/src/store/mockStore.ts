// In-memory store stub — mirrors auth/mockAuthStore.ts's pattern so
// /settings and app-connect are fully demoable with no backend (MOCK mode,
// or the real Worker being unreachable). State lives only for the page's
// lifetime. See docs/superpowers/specs/2026-08-14-web-ui-design.md §4.
import { DEFAULT_PREFS } from './types';
import type { Connection, UserPrefs } from './types';

let prefs: UserPrefs = clone(DEFAULT_PREFS);
const connections = new Map<string, Connection>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Mirrors the server's deep-merge rule (store spec §4): top-level keys
 * shallow-merged, `buttons` array replaced wholesale, `keybindings` merged
 * key-by-key. */
function mergePrefs(base: UserPrefs, patch: Partial<UserPrefs>): UserPrefs {
  return {
    version: 1,
    keybindings: { ...base.keybindings, ...(patch.keybindings ?? {}) },
    buttons: patch.buttons ?? base.buttons,
    contextPrompt: patch.contextPrompt ?? base.contextPrompt,
  };
}

export const mockStoreStore = {
  async getSettings(): Promise<UserPrefs> {
    return clone(prefs);
  },
  async putSettings(patch: Partial<UserPrefs>): Promise<UserPrefs> {
    prefs = mergePrefs(prefs, patch);
    return clone(prefs);
  },
  async listConnections(): Promise<Connection[]> {
    return [...connections.values()];
  },
  async connect(toolkit: string): Promise<{ url: string }> {
    connections.set(toolkit, { toolkit, status: 'active', connectedAt: Date.now() });
    return { url: '#' };
  },
  async disconnect(toolkit: string): Promise<void> {
    connections.delete(toolkit);
  },
};
