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
    suggestions: patch.suggestions ?? base.suggestions,
  };
}

// Canned context-aware "next action" suggestions — MOCK stand-in for a real
// model call, keyed off the most recent prompt so the demo still feels
// context-aware with zero backend. First matching rule wins; no match falls
// back to a generic next step.
const SUGGESTION_RULES: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /pull request|\bpr\b/i, suggestion: 'Check CI status on those pull requests and flag any failures.' },
  { pattern: /email|inbox|gmail/i, suggestion: 'Draft replies to the flagged emails from this week.' },
  { pattern: /summar/i, suggestion: 'Post that summary as a comment on the tracking issue.' },
  { pattern: /issue|bug/i, suggestion: 'Triage the newest open issues by severity.' },
];
const DEFAULT_SUGGESTION = 'Summarize what changed since your last run.';

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
  async suggest(context: string[]): Promise<{ suggestion: string }> {
    const last = context[context.length - 1] ?? '';
    const rule = SUGGESTION_RULES.find((r) => r.pattern.test(last));
    return { suggestion: rule?.suggestion ?? DEFAULT_SUGGESTION };
  },
};
