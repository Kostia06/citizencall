// Ported from ui/src/api.ts's `storeApi` — /api/* store client, shapes in
// docs/superpowers/specs/2026-08-14-per-user-store-design.md §4/§5. Every
// call needs the bearer access token, threaded through as `authedFetch`
// (AuthContext's version — attaches the token and retries once on 401).
import { API_BASE, MOCK } from './config';
import { AuthError } from './authClient';
import { mockStoreStore } from './mockStore';
import { APPS } from '../store/apps';
import type { ToolkitApp } from '../store/apps';
import type { Connection, UserPrefs } from '../types/store';

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

async function readJsonError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `request failed: ${res.status}`;
  } catch {
    return `request failed: ${res.status}`;
  }
}

async function withMockFallback<T>(live: () => Promise<T>, mock: () => Promise<T>): Promise<T> {
  if (MOCK) return mock();
  try {
    return await live();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.warn('[store] backend unreachable, falling back to mock store', err);
    return mock();
  }
}

export const storeApi = {
  async getSettings(authedFetch: AuthedFetch): Promise<UserPrefs> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/settings');
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.getSettings(),
    );
  },

  async putSettings(authedFetch: AuthedFetch, patch: Partial<UserPrefs>): Promise<UserPrefs> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.putSettings(patch),
    );
  },

  async listConnections(authedFetch: AuthedFetch): Promise<Connection[]> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/connections');
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.listConnections(),
    );
  },

  async connect(authedFetch: AuthedFetch, toolkit: string): Promise<{ url: string }> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/connect', { method: 'POST', body: JSON.stringify({ toolkit }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.connect(toolkit),
    );
  },

  async disconnect(authedFetch: AuthedFetch, toolkit: string): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authedFetch(`/api/connections/${encodeURIComponent(toolkit)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockStoreStore.disconnect(toolkit),
    );
  },

  /** Public catalog browse — no auth needed. Falls back to the bundled
   * ~1,201-app Composio catalog in MOCK mode or whenever the live call
   * fails, mirroring ui/src/api.ts's `toolkits()`. */
  async toolkits(): Promise<{ toolkits: ToolkitApp[]; source: 'live' | 'mock' }> {
    if (MOCK) return { toolkits: APPS, source: 'mock' };
    try {
      const res = await fetch(`${API_BASE}/api/toolkits`);
      if (!res.ok) throw new Error(`GET /api/toolkits failed: ${res.status}`);
      const body = (await res.json()) as { toolkits: ToolkitApp[]; source?: string };
      return { toolkits: body.toolkits, source: body.source === 'mock' ? 'mock' : 'live' };
    } catch (err) {
      console.warn('[toolkits] backend unreachable, falling back to bundled app catalog', err);
      return { toolkits: APPS, source: 'mock' };
    }
  },
};
