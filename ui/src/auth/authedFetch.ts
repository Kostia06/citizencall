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
}

export function createAuthedFetch({ getAccessToken, onSession }: AuthedFetchDeps) {
  return async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
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
