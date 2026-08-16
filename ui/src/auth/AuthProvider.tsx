import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../api';
import type { Requires2fa } from '../api';
import { createAuthedFetch } from './authedFetch';
import type { AuthStatus, AuthUser } from './types';

export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  /** Resolves to a `Requires2fa` challenge (caller shows the code step and
   * calls `verify2fa`) instead of establishing a session when the account
   * has 2FA enabled; otherwise resolves to void with the session already
   * set. */
  login(email: string, password: string): Promise<Requires2fa | void>;
  /** Creates the account and immediately establishes an authed session —
   * there is no email-confirmation step to wait on. A 2FA challenge
   * immediately after signup (fresh account, mock demo) is auto-verified
   * via its dev code rather than surfaced, since the browser that just
   * created the account is trivially the owner. */
  /** `pending2fa` is set only when the post-signup login raised a challenge
   * that couldn't be auto-verified (production email flow) — the caller
   * routes to the login code-entry step with it. */
  signup(email: string, password: string): Promise<{ userId: string; pending2fa?: Requires2fa }>;
  /** Completes a challenge returned by `login` and establishes the session. */
  verify2fa(challengeId: string, code: string): Promise<void>;
  /** Re-sends the code for an in-flight challenge; returns the resend
   * cooldown in seconds for the caller's countdown. */
  resend2fa(challengeId: string): Promise<{ retryAfterSec: number }>;
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
  // Deferred that settles when the mount-time silent refresh completes, so
  // authedFetch never races the bootstrap and fires token-less requests
  // (see authedFetch.ts `whenReady`). Created during render — authedFetch
  // is built before the effect runs.
  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!readyRef.current) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    readyRef.current = { promise, resolve };
  }

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
      })
      .finally(() => readyRef.current?.resolve());
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  const authedFetch = useRef(
    createAuthedFetch({
      getAccessToken: () => tokenRef.current,
      onSession: setSession,
      whenReady: () => readyRef.current?.promise ?? Promise.resolve(),
    }),
  ).current;

  const login = useCallback(
    async (email: string, password: string): Promise<Requires2fa | void> => {
      const result = await authApi.login(email, password);
      if ('requires2fa' in result) return result; // caller shows the code step
      setSession(result.accessToken, result.user);
    },
    [setSession],
  );

  const verify2fa = useCallback(
    async (challengeId: string, code: string) => {
      const result = await authApi.verify2fa(challengeId, code);
      setSession(result.accessToken, result.user);
    },
    [setSession],
  );

  const resend2fa = useCallback(async (challengeId: string) => {
    return authApi.resend2fa(challengeId);
  }, []);

  const signup = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.signup(email, password);
      // No email-confirmation gate anymore — signup lands the user straight
      // in an authed session, so log in immediately behind the scenes. When
      // that login raises a 2FA challenge: with a devCode (dev builds / no
      // email provider) auto-verify so a just-created user isn't bounced to
      // a code screen; WITHOUT one (production, real email) auto-verify is
      // impossible — surface the challenge so the caller can route into the
      // normal code-entry step instead of throwing on a bad verify.
      const loginResult = await authApi.login(email, password);
      if ('requires2fa' in loginResult) {
        if (!loginResult.devCode) return { ...result, pending2fa: loginResult };
        const session = await authApi.verify2fa(loginResult.challengeId, loginResult.devCode);
        setSession(session.accessToken, session.user);
        return result;
      }
      setSession(loginResult.accessToken, loginResult.user);
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

  const value: AuthContextValue = { user, accessToken, status, login, signup, verify2fa, resend2fa, logout, authedFetch };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
