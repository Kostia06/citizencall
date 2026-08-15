// Ported from ui/src/store/mockStore.ts (trimmed to the fields this client
// uses — see src/types/store.ts). In-memory only; state lives for the app's
// process lifetime, matching the web mock's behavior.
import { DEFAULT_PREFS } from '../types/store';
import type { Connection, UserPrefs } from '../types/store';

let prefs: UserPrefs = { ...DEFAULT_PREFS };
const connections = new Map<string, Connection>();

function mergePrefs(base: UserPrefs, patch: Partial<UserPrefs>): UserPrefs {
  return {
    version: 1,
    contextPrompt: patch.contextPrompt ?? base.contextPrompt,
    suggestions: patch.suggestions ?? base.suggestions,
  };
}

export const mockStoreStore = {
  async getSettings(): Promise<UserPrefs> {
    return { ...prefs };
  },
  async putSettings(patch: Partial<UserPrefs>): Promise<UserPrefs> {
    prefs = mergePrefs(prefs, patch);
    return { ...prefs };
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
