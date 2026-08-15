// App-wide auth state: access token in memory, refresh token in
// expo-secure-store, silent refresh on boot and on a 401 from any
// `authedFetch` call. Anonymous mode is the default/fallback status — the
// app stays fully usable logged out (MOCK data, SPEC.md §13's
// `withMockFallback` idea) rather than gating the whole UI behind login.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_BASE } from '../api/config';
import { authApi } from '../api/authClient';
import { tokenStorage } from './tokenStorage';
import type { AuthStatus, AuthUser } from '../types/auth';
import type { AuthedFetch } from '../api/storeClient';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  login(email: string, password: string): Promise<void>;
  signup(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  authedFetch: AuthedFetch;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  const applySession = useCallback(async (session: { accessToken: string; refreshToken: string; user: AuthUser }) => {
    accessTokenRef.current = session.accessToken;
    refreshTokenRef.current = session.refreshToken;
    await tokenStorage.set(session.refreshToken);
    setUser(session.user);
    setStatus('authed');
  }, []);

  const clearSession = useCallback(async () => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    await tokenStorage.clear();
    setUser(null);
    setStatus('anon');
  }, []);

  // Boot: try to restore a session from the stored refresh token. No token,
  // or an expired one, is a normal outcome — not an error — so it just
  // lands on 'anon'.
  useEffect(() => {
    (async () => {
      const stored = await tokenStorage.get();
      const session = await authApi.refresh(stored).catch(() => null);
      if (session) await applySession(session);
      else setStatus('anon');
    })();
  }, [applySession]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const session = await authApi.login(email, password);
        await applySession(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed');
        throw err;
      }
    },
    [applySession],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        await authApi.signup(email, password);
        await login(email, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Signup failed');
        throw err;
      }
    },
    [login],
  );

  const logout = useCallback(async () => {
    await authApi.logout(refreshTokenRef.current).catch(() => undefined);
    await clearSession();
  }, [clearSession]);

  // Attaches the bearer token and retries once on 401 via silent refresh —
  // callers (storeApi) just see a normal Response or an AuthError.
  const authedFetch = useCallback<AuthedFetch>(
    async (path, init) => {
      const doFetch = () =>
        fetch(`${API_BASE}${path}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            'x-client': 'native',
            ...(accessTokenRef.current ? { authorization: `Bearer ${accessTokenRef.current}` } : {}),
            ...init?.headers,
          },
        });

      const res = await doFetch();
      if (res.status !== 401) return res;

      const session = await authApi.refresh(refreshTokenRef.current).catch(() => null);
      if (!session) {
        await clearSession();
        return res;
      }
      await applySession(session);
      return doFetch();
    },
    [applySession, clearSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, error, login, signup, logout, authedFetch }),
    [status, user, error, login, signup, logout, authedFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
