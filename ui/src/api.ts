import type { BenchmarkResult, RosterEntry, RunAttachment, TraceEvent } from './types';
import { mockBenchmark, mockFunnel, mockRoster } from './mock/fixtures';
import { buildScenario } from './mock/scenario';
import { mockAuthStore } from './auth/mockAuthStore';
import type { AuthUser } from './auth/types';
import { mockStoreStore } from './store/mockStore';
import type { Connection, UserPrefs } from './store/types';

export { DEFAULT_PREFS } from './store/types';
export type { Connection, UserPrefs, UserPrefsButton, FixedButtonAction } from './store/types';

// MOCK is on by default so the UI is fully demoable with zero backend —
// flip VITE_MOCK=false to talk to a real Worker. See SPEC.md §13.
export const MOCK: boolean = import.meta.env.VITE_MOCK !== 'false';

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export interface RunHandle {
  runId: string;
  close(): void;
}

export interface StartRunOpts {
  userId: string;
  text: string;
  source: 'text' | 'voice';
  noCache?: boolean;
  attachments?: RunAttachment[];
  onEvent(event: TraceEvent): void;
  onError?(err: unknown): void;
}

/** Kicks off a run and streams TraceEvents back through onEvent. In MOCK
 * mode this replays a scripted sequence on a timer, no network involved. */
export function startRun(opts: StartRunOpts): RunHandle {
  if (MOCK) {
    return startMockRun(opts);
  }
  return startLiveRun(opts);
}

function startMockRun(opts: StartRunOpts): RunHandle {
  const runId = `mock-${Date.now().toString(36)}`;
  const steps = buildScenario({
    runId,
    userId: opts.userId,
    text: opts.text,
    source: opts.source,
    attachments: opts.attachments,
  });
  const timers: number[] = [];
  let elapsed = 0;

  for (const step of steps) {
    elapsed += step.delay;
    const id = window.setTimeout(() => opts.onEvent(step.event), elapsed);
    timers.push(id);
  }

  return {
    runId,
    close() {
      timers.forEach((id) => window.clearTimeout(id));
    },
  };
}

function startLiveRun(opts: StartRunOpts): RunHandle {
  let es: EventSource | undefined;
  let closed = false;
  // Placeholder id until POST /api/run resolves — callers only read runId
  // synchronously for mock mode; live mode should use the resolved id from
  // the run_start TraceEvent instead.
  const provisional = { runId: '', close: () => undefined };
  const handle: RunHandle = {
    get runId() {
      return provisional.runId;
    },
    close() {
      closed = true;
      es?.close();
    },
  };

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: opts.userId,
          text: opts.text,
          source: opts.source,
          noCache: opts.noCache,
          attachments: opts.attachments ?? [],
        }),
      });
      if (!res.ok) throw new Error(`POST /api/run failed: ${res.status}`);
      const { runId } = (await res.json()) as { runId: string };
      provisional.runId = runId;
      if (closed) return;

      // Native EventSource sends Last-Event-ID automatically on reconnect
      // (SPEC.md §13 fix (b)) as long as the server emits `id:` per event.
      es = new EventSource(`${API_BASE}/api/run/${runId}/stream`);
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as TraceEvent;
          opts.onEvent(event);
        } catch (err) {
          opts.onError?.(err);
        }
      };
      es.onerror = (err) => {
        // EventSource retries on its own; surface it but don't tear down —
        // a transient drop mid-run is expected and should self-heal.
        opts.onError?.(err);
      };
    } catch (err) {
      opts.onError?.(err);
    }
  })();

  return handle;
}

export async function fetchRoster(): Promise<RosterEntry[]> {
  if (MOCK) return mockRoster;
  const res = await fetch(`${API_BASE}/api/roster`);
  if (!res.ok) throw new Error(`GET /api/roster failed: ${res.status}`);
  return res.json();
}

export async function fetchBenchmark(): Promise<BenchmarkResult> {
  if (MOCK) return mockBenchmark;
  const res = await fetch(`${API_BASE}/api/benchmark`);
  if (!res.ok) throw new Error(`GET /api/benchmark failed: ${res.status}`);
  return res.json();
}

export async function fetchFunnel(): Promise<typeof mockFunnel> {
  if (MOCK) return mockFunnel;
  const res = await fetch(`${API_BASE}/api/funnel`);
  if (!res.ok) throw new Error(`GET /api/funnel failed: ${res.status}`);
  return res.json();
}

export async function connectToolkit(userId: string, toolkit: 'github' | 'gmail'): Promise<{ url: string }> {
  if (MOCK) return { url: '#' };
  const res = await fetch(`${API_BASE}/api/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, toolkit }),
  });
  if (!res.ok) throw new Error(`POST /api/connect failed: ${res.status}`);
  return res.json();
}

// ---- /auth/* client — web SPA design §3/§4, endpoint contract in
// docs/superpowers/specs/2026-08-14-auth-foundation-design.md §6. ----

/** Thrown for a real (non-network) failure response from the auth API —
 * bad credentials, expired token, etc. Distinct from a network failure so
 * `withMockFallback` never masks a genuine rejection as "backend down". */
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
    credentials: 'include', // rides the __Host-refresh cookie for web
    headers: { 'content-type': 'application/json', ...init?.headers },
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

/** Runs `live` against the real Worker; falls back to the in-memory mock
 * store when MOCK is on, or transparently when `live` fails to reach the
 * network at all (fetch throw — not an AuthError, which is a genuine
 * response from a live backend and must propagate). This is what keeps the
 * SPA demoable with no Worker running. */
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

  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockAuthStore.login(email, password),
    );
  },

  /** Attempts to restore a session from the refresh cookie (web) or the
   * mock store. Resolves to null on no session — never throws for that
   * case, since "anon" is a normal outcome, not an error. */
  async refresh(): Promise<{ accessToken: string; user: AuthUser } | null> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/refresh', { method: 'POST' });
        if (res.status === 401) return null;
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        const body = (await res.json()) as { accessToken: string; user?: AuthUser };
        if (!body.user) {
          const meRes = await authFetch('/auth/me', { headers: { authorization: `Bearer ${body.accessToken}` } });
          if (!meRes.ok) return null;
          const { user } = (await meRes.json()) as { user: AuthUser };
          return { accessToken: body.accessToken, user };
        }
        return { accessToken: body.accessToken, user: body.user };
      },
      () => mockAuthStore.refresh(),
    );
  },

  async logout(): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/logout', { method: 'POST' });
        if (!res.ok && res.status !== 204) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockAuthStore.logout(),
    );
  },

  async verify(token: string): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockAuthStore.verify(token),
    );
  },

  async forgotPassword(email: string): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockAuthStore.forgotPassword(email),
    );
  },

  async resetPassword(token: string, password: string): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockAuthStore.resetPassword(token, password),
    );
  },
};

// ---- /api/* store client — web SPA design §4/§6, shapes in
// docs/superpowers/specs/2026-08-14-per-user-store-design.md §4/§5. Every
// call needs the bearer token, so it's threaded through as `authedFetch`
// (AuthProvider's version — attaches the token and retries once on 401)
// rather than the plain `authFetch` used above for the token-less /auth/*
// calls. A 401 surfaces as an AuthError the caller can catch to show the
// inline "log in" prompt instead of a hard error. */
export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

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

  /** Context-aware "next action" suggestion for the command bar's ghost
   * text — `context` is the last few user prompts, most recent last. Callers
   * (CommandBar) treat any rejection as "no suggestion" and fail silent;
   * `withMockFallback` already covers the no-backend case. */
  async suggest(authedFetch: AuthedFetch, context: string[]): Promise<{ suggestion: string }> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/suggest', { method: 'POST', body: JSON.stringify({ context }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.suggest(context),
    );
  },
};
