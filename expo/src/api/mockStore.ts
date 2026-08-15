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

// Mirrors ui/src/store/mockStore.ts's SUGGESTION_RULES — canned
// context-aware "next action" suggestions keyed off the most recent prompt,
// so the demo still feels context-aware with zero backend.
const SUGGESTION_RULES: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /pull request|\bpr\b/i, suggestion: 'Check CI status on those pull requests and flag any failures.' },
  { pattern: /email|inbox|gmail/i, suggestion: 'Draft replies to the flagged emails from this week.' },
  { pattern: /summar/i, suggestion: 'Post that summary as a comment on the tracking issue.' },
  { pattern: /issue|bug/i, suggestion: 'Triage the newest open issues by severity.' },
];
const DEFAULT_SUGGESTION = 'Summarize what changed since your last run.';

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
  async suggest(context: string[]): Promise<{ suggestion: string }> {
    const last = context[context.length - 1] ?? '';
    const rule = SUGGESTION_RULES.find((r) => r.pattern.test(last));
    return { suggestion: rule?.suggestion ?? DEFAULT_SUGGESTION };
  },
};
