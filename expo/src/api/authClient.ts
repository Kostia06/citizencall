// Native /auth/* client — endpoint contract in docs/superpowers/specs/
// 2026-08-14-auth-foundation-design.md §6, native transport in §4: both
// tokens travel in the JSON body (no cookies), and every request carries
// `X-Client: native` so the Worker knows to skip the cookie path.
import { API_BASE, MOCK } from './config';
import { mockAuthStore } from './mockAuthStore';
import type { AuthUser, NativeAuthResult } from '../types/auth';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', 'x-client': 'native', ...init?.headers },
    ...init,
  });
}

async function readJsonError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `request failed: ${res.status}`;
  } catch {
    return `request failed: ${res.status}`;
  }
}

/** Mirrors ui/src/api.ts's `withMockFallback` — runs `live` against the real
 * Worker, falling back to the in-memory mock when MOCK is on or `live`
 * can't reach the network at all. A genuine rejection from a live backend
 * (AuthError) always propagates. */
async function withMockFallback<T>(live: () => Promise<T>, mock: () => Promise<T>): Promise<T> {
  if (MOCK) return mock();
  try {
    return await live();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.warn('[auth] backend unreachable, falling back to mock auth', err);
    return mock();
  }
}

export const authApi = {
  async signup(email: string, password: string): Promise<{ userId: string }> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockAuthStore.signup(email, password),
    );
  },

  async login(email: string, password: string): Promise<NativeAuthResult> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockAuthStore.login(email, password),
    );
  },

  /** Resolves to null on no/expired session — never throws for that case,
   * since "not logged in" is a normal outcome on cold start. */
  async refresh(refreshToken: string | null): Promise<NativeAuthResult | null> {
    return withMockFallback(
      async () => {
        if (!refreshToken) return null;
        const res = await authFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
        if (res.status === 401) return null;
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockAuthStore.refresh(refreshToken),
    );
  },

  async logout(refreshToken: string | null): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
        if (!res.ok && res.status !== 204) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockAuthStore.logout(refreshToken),
    );
  },
};

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;
export type { AuthUser };
