// Factory behind AuthProvider's `authedFetch` — attaches the in-memory
// bearer token, and on a 401 does exactly ONE silent /auth/refresh + retry
// before giving up and dropping the caller to anon. Design spec §3.
import { API_BASE, authApi } from '../api';
import type { AuthUser } from './types';

interface AuthedFetchDeps {
  /** Always reads the *current* token — a ref, not a stale closure value. */
  getAccessToken(): string | null;
  /** Called after a successful silent refresh, or with (null, null) to drop
   * to anon when the refresh itself fails. */
  onSession(accessToken: string | null, user: AuthUser | null): void;
  /** Resolves once the boot-time silent refresh has settled. Without this,
   * requests fired on mount race the bootstrap and go out with no bearer at
   * all — routes that also serve anonymous sessions (/api/routines,
   * /api/connections) then silently answer for the anon actor instead of
   * 401ing, so the logged-in user's data appears empty until a reload. */
  whenReady?(): Promise<unknown>;
}

export function createAuthedFetch({ getAccessToken, onSession, whenReady }: AuthedFetchDeps) {
  return async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (whenReady) await whenReady().catch(() => {});
    const request = (token: string | null) =>
      fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...init.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });

    let res = await request(getAccessToken());
    if (res.status !== 401) return res;

    try {
      const result = await authApi.refresh();
      if (!result) {
        onSession(null, null);
        return res;
      }
      onSession(result.accessToken, result.user);
      res = await request(result.accessToken);
    } catch {
      onSession(null, null);
    }
    return res;
  };
}
