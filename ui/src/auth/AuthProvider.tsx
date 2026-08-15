import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../api';
import { createAuthedFetch } from './authedFetch';
import type { AuthStatus, AuthUser } from './types';

export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  login(email: string, password: string): Promise<void>;
  /** Creates the account and immediately establishes an authed session —
   * there is no email-confirmation step to wait on. */
  signup(email: string, password: string): Promise<{ userId: string }>;
  logout(): Promise<void>;
  /** Attaches the bearer token; on a 401 does one silent refresh + retry,
   * else drops to anon. `credentials: 'include'` rides the refresh cookie. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Holds `{ user, accessToken, status }` — design spec §3. On mount,
 * attempts a silent `/auth/refresh` to restore a session from the
 * `__Host-refresh` cookie (or the mock store); failure is a normal "anon"
 * outcome, never a thrown error that blocks the app. The access token lives
 * only in this component's state/ref — never localStorage. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  // authedFetch needs the *current* token synchronously (it can fire
  // between renders); state alone would read a stale closure value.
  const tokenRef = useRef<string | null>(null);

  const setSession = useCallback((token: string | null, nextUser: AuthUser | null) => {
    tokenRef.current = token;
    setAccessToken(token);
    setUser(nextUser);
    setStatus(token && nextUser ? 'authed' : 'anon');
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .refresh()
      .then((result) => {
        if (cancelled) return;
        setSession(result?.accessToken ?? null, result?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setSession(null, null);
      });
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  const authedFetch = useRef(
    createAuthedFetch({
      getAccessToken: () => tokenRef.current,
      onSession: setSession,
    }),
  ).current;

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login(email, password);
      setSession(result.accessToken, result.user);
    },
    [setSession],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.signup(email, password);
      // No email-confirmation gate anymore — signup lands the user straight
      // in an authed session, so log in immediately behind the scenes.
      const session = await authApi.login(email, password);
      setSession(session.accessToken, session.user);
      return result;
    },
    [setSession],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setSession(null, null);
    }
  }, [setSession]);

  const value: AuthContextValue = { user, accessToken, status, login, signup, logout, authedFetch };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
