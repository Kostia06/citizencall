import type { BenchmarkResult, RosterEntry, RunAttachment, TraceEvent } from './types';
import { mockBenchmark, mockFunnel, mockRoster } from './mock/fixtures';
import { buildScenario } from './mock/scenario';
import { mockAuthStore } from './auth/mockAuthStore';
import type { AuthUser } from './auth/types';
import { mockStoreStore } from './store/mockStore';
import type { Connection, ToolOverride, UserMcp, UserPrefs } from './store/types';
import { APPS } from './store/apps';
import type { ToolkitApp } from './store/apps';

export { DEFAULT_PREFS } from './store/types';
export type { Connection, UserPrefs, UserPrefsButton, FixedButtonAction, UserMcp, ToolOverride } from './store/types';
export type { ToolkitApp } from './store/apps';
export { CATEGORIES, TOP_CATEGORIES } from './store/apps';

// LIVE by default — the SPA talks to the real Worker unless explicitly told
// not to. `withMockFallback` (auth/store calls) and `startRun`'s own
// try/catch (the run stream) still fall back to the in-memory mock per-call
// whenever the backend is unreachable, so the app stays fully demoable with
// zero backend even in this mode. Set VITE_MOCK=true as an explicit
// force-mock escape hatch (e.g. filming a demo with no Worker running at
// all, or working offline). See SPEC.md §13.
export const MOCK: boolean = import.meta.env.VITE_MOCK === 'true';

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
  // Set once POST /api/run's initial request fails outright (network down,
  // Worker not running) — falls back to the scripted mock run so the bar
  // stays filmable/demoable with zero backend even when MOCK is off.
  let fallback: RunHandle | null = null;
  // Placeholder id until POST /api/run resolves — callers only read runId
  // synchronously for mock mode; live mode should use the resolved id from
  // the run_start TraceEvent instead.
  const provisional = { runId: '' };
  const handle: RunHandle = {
    get runId() {
      return fallback ? fallback.runId : provisional.runId;
    },
    close() {
      closed = true;
      es?.close();
      fallback?.close();
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
      let finished = false;
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as TraceEvent;
          opts.onEvent(event);
          // The DO closes the stream after the terminal event; without this,
          // EventSource treats that close as an error and reconnect-loops
          // (replay → close → reconnect) while toasting "stream dropped"
          // after every successful run.
          if (event.t === 'run_end' || event.t === 'error') {
            finished = true;
            es?.close();
          }
        } catch (err) {
          opts.onError?.(err);
        }
      };
      es.onerror = (err) => {
        if (finished) return; // normal post-completion close, not a drop
        // EventSource retries on its own; surface it but don't tear down —
        // a transient drop mid-run is expected and should self-heal.
        opts.onError?.(err);
      };
    } catch (err) {
      // Only the initial POST failing lands here (fetch throw, non-2xx, or
      // a malformed JSON body) — a stream that connects and later drops is
      // handled by es.onerror above and must NOT fall back mid-run, since
      // that would silently swap a real (if flaky) run for a scripted one.
      if (closed) return;
      console.warn('[run] backend unreachable, falling back to scripted demo run', err);
      fallback = startMockRun(opts);
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

/** Returned by `authApi.login` in place of a session when the account has
 * 2FA enabled — `devCode` only ever appears on dev builds of the auth worker
 * (never in prod), and MOCK mode always includes one ('000000') so the flow
 * is demoable with zero backend. */
export interface Requires2fa {
  requires2fa: true;
  challengeId: string;
  devCode?: string;
}

export type LoginResult = { accessToken: string; user: AuthUser } | Requires2fa;

// Shared by all authApi.refresh() callers — see the SINGLE-FLIGHT note there.
let inflightRefresh: Promise<{ accessToken: string; user: AuthUser } | null> | null = null;

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

  async login(email: string, password: string): Promise<LoginResult> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        const body = await res.json();
        return body as LoginResult;
      },
      () => mockAuthStore.login(email, password),
    );
  },

  /** Completes a 2FA challenge from `login`'s `requires2fa` response. */
  async verify2fa(challengeId: string, code: string): Promise<{ accessToken: string; user: AuthUser }> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/2fa/verify', {
          method: 'POST',
          body: JSON.stringify({ challengeId, code }),
        });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockAuthStore.verify2fa(challengeId, code),
    );
  },

  /** Re-sends the 2FA code for an in-flight challenge; the worker rate-limits
   * this per `retryAfterSec` (30s), which the caller uses to drive the
   * "Resend code" countdown. */
  async resend2fa(challengeId: string): Promise<{ ok: true; retryAfterSec: number }> {
    return withMockFallback(
      async () => {
        const res = await authFetch('/auth/2fa/resend', { method: 'POST', body: JSON.stringify({ challengeId }) });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockAuthStore.resend2fa(challengeId),
    );
  },

  /** Attempts to restore a session from the refresh cookie (web) or the
   * mock store. Resolves to null on no session — never throws for that
   * case, since "anon" is a normal outcome, not an error.
   *
   * SINGLE-FLIGHT: refresh ROTATES the cookie token, and the worker treats a
   * replay of the retired token as theft (reuse-detection revokes the whole
   * session). Concurrent callers — StrictMode's double mount, several 401
   * retries racing — must therefore share one in-flight rotation, or the
   * loser logs the user out (found live: first refresh 200, every later one
   * 401 "Session expired"). */
  async refresh(): Promise<{ accessToken: string; user: AuthUser } | null> {
    if (inflightRefresh) return inflightRefresh;
    inflightRefresh = this.doRefresh().finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  },

  async doRefresh(): Promise<{ accessToken: string; user: AuthUser } | null> {
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

  /** Full connect-app catalog for the Connections grid — public (no auth
   * needed to browse), so this hits the network directly rather than going
   * through `authedFetch`/`withMockFallback`'s AuthError handling. Falls
   * back to the bundled ~1,201-app Composio catalog (`store/apps.ts` /
   * `store/composio-apps.json`) in MOCK mode or whenever the live call
   * fails, so the grid is always fully demoable. */
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

  // ---- Custom MCPs (user_mcps) — Settings §"Custom MCPs". The live list
  // route only ever returns id/name/enabled/createdAt (config_json — url/
  // headers — isn't projected), so `url`/`headers` on a row from `listMcps`
  // are only ever populated right after create/update, in this same session.
  // CustomMcpsPanel keeps its own copy rather than re-fetching to avoid
  // losing them on a background refresh.
  async listMcps(authedFetch: AuthedFetch): Promise<UserMcp[]> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/mcps');
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.listMcps(),
    );
  },

  async createMcp(
    authedFetch: AuthedFetch,
    input: { name: string; url: string; headers?: Record<string, string> },
  ): Promise<UserMcp> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/mcps', {
          method: 'POST',
          body: JSON.stringify({ name: input.name, config: { url: input.url, headers: input.headers ?? {} } }),
        });
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        const { id } = (await res.json()) as { id: string };
        return { id, name: input.name, url: input.url, headers: input.headers, enabled: true, createdAt: Date.now() };
      },
      () => mockStoreStore.createMcp(input),
    );
  },

  async updateMcp(
    authedFetch: AuthedFetch,
    id: string,
    patch: { name?: string; url?: string; headers?: Record<string, string>; enabled?: boolean },
  ): Promise<void> {
    return withMockFallback(
      async () => {
        const body: Record<string, unknown> = {};
        if (patch.name !== undefined) body.name = patch.name;
        if (patch.enabled !== undefined) body.enabled = patch.enabled;
        if (patch.url !== undefined) body.config = { url: patch.url, headers: patch.headers ?? {} };
        const res = await authedFetch(`/api/mcps/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (!res.ok && res.status !== 204) throw new AuthError(await readJsonError(res), res.status);
      },
      async () => {
        await mockStoreStore.updateMcp(id, patch);
      },
    );
  },

  async deleteMcp(authedFetch: AuthedFetch, id: string): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authedFetch(`/api/mcps/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockStoreStore.deleteMcp(id),
    );
  },

  // ---- Per-app tool overrides (user_tools) — Settings §Connections tile
  // customization panel.
  async listToolOverrides(authedFetch: AuthedFetch): Promise<ToolOverride[]> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/tools');
        if (!res.ok) throw new AuthError(await readJsonError(res), res.status);
        return res.json();
      },
      () => mockStoreStore.listToolOverrides(),
    );
  },

  async setToolOverride(authedFetch: AuthedFetch, toolkit: string, tool: string, enabled: boolean): Promise<void> {
    return withMockFallback(
      async () => {
        const res = await authedFetch('/api/tools', { method: 'PATCH', body: JSON.stringify({ toolkit, tool, enabled }) });
        if (!res.ok && res.status !== 204) throw new AuthError(await readJsonError(res), res.status);
      },
      () => mockStoreStore.setToolOverride(toolkit, tool, enabled),
    );
  },
};
