// CitizenCall Worker — Hono app + all routes (SPEC.md §13). Durable Object
// class is re-exported here because wrangler.jsonc's `main` points at this
// file and resolves `class_name: "RunDO"` against its exports.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { getRun } from './db';
import { buildBenchmarkReport, buildRosterReport } from './reporting';
import { createConnectionLink, verifyState } from './providers/composio';
import { getToolkitCatalog } from './providers/composio-catalog';
import { AuthConfigUnavailableError, resolveAuthConfigId } from './providers/composio-auth-configs';
import { MAX_AUDIO_BYTES, SttUpstreamError, transcribeAudio } from './providers/elevenlabs';
import { authRoutes } from './auth/routes';
import type { AuthVars } from './auth/middleware';
import { resolveActor } from './auth/anon';
import { storeRoutes } from './store/routes';
import { memoryRoutes } from './memory/routes';
import { routineRoutes } from './routines/routes';
import { scheduled } from './routines/scheduler';
import { upsertConnection } from './store/connections';
import { checkAndIncrement } from './auth/throttle';
import { recordApiKeyCost, resolveApiKey } from './store/api-keys';
import { suggestNextAction } from './pipeline/suggest';
import { historySchema } from './pipeline/conversation';
import { attachmentsSchema } from './pipeline/attachments';
import funnelFixture from '../../artifacts/funnel.example.json';

export { RunDO } from './run.do';

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>();

app.route('/auth', authRoutes);
// storeRoutes applies requireAuth/requireVerified per-route (not via a
// blanket `use('*', ...)`), so mounting it at /api only claims its own
// literal paths (/api/settings, /api/connections*, /api/mcps*, /api/tools)
// and cannot shadow the non-auth /api/* routes registered below
// (/api/run, /api/roster, /api/benchmark, /api/funnel, /api/connect).
app.route('/api', storeRoutes);
app.route('/api', memoryRoutes); // /api/memories* — per-route resolveActor, cannot shadow the routes below
// Routine CRUD + manual trigger — resolveActor-scoped, claims only /api/routines*.
app.route('/api', routineRoutes);

const runRequestSchema = z.object({
  // Legacy display field — actor identity comes from resolveActor below, so
  // a caller can no longer name an arbitrary userId and read that user's run
  // cache / context prompt / connections.
  userId: z.string().min(1).optional(),
  text: z.string().min(1),
  source: z.enum(['text', 'voice']),
  noCache: z.boolean().optional(),
  // Prior turns for multi-turn context — capped/truncated by the schema
  // (12 newest turns, 2000 chars each), threaded through the DO to
  // runPipeline's conversation block.
  history: historySchema.optional(),
  // Files attached in the command bar — client-extracted text only, capped
  // and filtered by the schema (4 files, 50KB each; metadata-only entries
  // dropped, never rejected). Threaded through the DO to runPipeline's
  // ATTACHED FILES block.
  attachments: attachmentsSchema.optional(),
  // Client Date.getTimezoneOffset() — anchors "at 6 am" in chat-created
  // routines to the user's clock instead of UTC.
  tzOffsetMinutes: z.number().int().min(-900).max(900).optional(),
});

app.post('/api/run', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  // Same identity rule as /api/connect: authed bearer wins, else the signed
  // anon cookie session. This is what scopes the run cache, the context
  // prompt, and which Composio connections the run's tools execute against.
  const { userId: actorId } = await resolveActor(c);

  const runId = crypto.randomUUID();
  const stub = c.env.RUN.get(c.env.RUN.idFromName(runId));
  await stub.fetch('https://run.do/start', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      userId: actorId,
      text: parsed.data.text,
      source: parsed.data.source,
      noCache: parsed.data.noCache ?? false,
      ...(parsed.data.history && parsed.data.history.length > 0 ? { history: parsed.data.history } : {}),
      ...(parsed.data.attachments && parsed.data.attachments.length > 0
        ? { attachments: parsed.data.attachments }
        : {}),
      ...(parsed.data.tzOffsetMinutes !== undefined ? { tzOffsetMinutes: parsed.data.tzOffsetMinutes } : {}),
    }),
  });
  return c.json({ runId });
});

// Resume a connection-required pause: {action:'retry'|'skip'} forwarded to
// the run's DO (same idFromName routing as /start). Like /api/run/:id, the
// unguessable runId is the capability — no additional auth requirement.
app.post('/api/run/:id/resume', async (c) => {
  const body = await c.req.text();
  const runId = c.req.param('id');
  const stub = c.env.RUN.get(c.env.RUN.idFromName(runId));
  const res = await stub.fetch('https://run.do/resume', { method: 'POST', body });
  if (res.status !== 409) return res;
  // 409 "not paused": either the run truly isn't paused, or the DO isolate
  // was evicted and its in-memory pause died with it — leaving the row
  // 'running' forever with no way to settle it (audit FAIL: zombie runs).
  // If the row is 'running' and older than the pause window, reconcile now
  // instead of making the caller wait for the cron reaper.
  const row = await c.env.DB.prepare(`SELECT status, created_at FROM runs WHERE id = ?`).bind(runId).first<{
    status: string;
    created_at: number;
  }>();
  if (row?.status === 'running' && Date.now() - row.created_at > 6 * 60_000) {
    await c.env.DB.prepare(`UPDATE runs SET status = 'error' WHERE id = ?`).bind(runId).run();
    return c.json({ resumed: false, reconciled: true });
  }
  return res;
});

app.get('/api/run/:id/stream', async (c) => {
  const stub = c.env.RUN.get(c.env.RUN.idFromName(c.req.param('id')));
  const headers = new Headers();
  const lastEventId = c.req.header('Last-Event-ID');
  if (lastEventId) headers.set('Last-Event-ID', lastEventId);
  // Returning the DO's Response directly preserves the streaming body — Hono
  // passes through any Response instance unmodified.
  return stub.fetch('https://run.do/stream', { headers });
});

app.get('/api/run/:id', async (c) => {
  const run = await getRun(c.env.DB, c.req.param('id'));
  if (!run) return c.json({ error: 'not found' }, 404);
  return c.json(run);
});

// ---- Public developer API (/v1) -------------------------------------------
// Bearer auth with a `cc_live_…` key (Settings → Personal → API keys). The
// key resolves to its owner, so /v1 runs execute with that user's
// connections, memories, and custom MCPs — same identity model as the UI.

const askRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  noCache: z.boolean().optional(),
});

type ApiKeyIdentity = { userId: string; keyId: string };

async function apiKeyFromRequest(c: { req: { header(n: string): string | undefined }; env: Env }): Promise<ApiKeyIdentity | null> {
  const auth = c.req.header('Authorization');
  const key = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!key) return null;
  return resolveApiKey(c.env.DB, key, Date.now());
}

/** Public run view — the internal doc minus other-user-irrelevant fields. */
function publicRunView(doc: NonNullable<Awaited<ReturnType<typeof getRun>>>) {
  const { run, hops } = doc as unknown as {
    run: {
      id: string;
      request_text: string;
      status: string;
      answer_text: string | null;
      total_cost_usd: number;
      total_ms: number;
      created_at: number;
    };
    hops: Array<{ model_id: string; verdict: string | null; latency_ms: number | null }>;
  };
  return {
    id: run.id,
    status: run.status,
    text: run.request_text,
    answer: run.answer_text,
    costUsd: run.total_cost_usd,
    totalMs: run.total_ms,
    createdAt: run.created_at,
    steps: hops.map((h) => ({ model: h.model_id, verdict: h.verdict, ms: h.latency_ms })),
  };
}

// Blocking ask: starts a run and waits (up to ~50s of wall clock, cheap on
// Workers) for it to settle. A run still going at the deadline returns 202
// with the id — poll GET /v1/runs/:id. Completed runs bill their measured
// cost to the key here; runs finishing after the 202 are not re-billed (the
// status endpoint is a read, never a charge).
app.post('/v1/ask', async (c) => {
  const identity = await apiKeyFromRequest(c);
  if (!identity) return c.json({ error: 'invalid or missing API key' }, 401);

  const throttle = await checkAndIncrement(c.env.DB, `v1:key:${identity.keyId}`, Date.now(), {
    windowMs: 60_000,
    max: 30,
  });
  if (!throttle.allowed) {
    c.header('Retry-After', String(Math.ceil(throttle.retryAfterMs / 1000)));
    return c.json({ error: 'rate limited' }, 429);
  }

  const parsed = askRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  const runId = crypto.randomUUID();
  const stub = c.env.RUN.get(c.env.RUN.idFromName(runId));
  await stub.fetch('https://run.do/start', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      userId: identity.userId,
      text: parsed.data.text,
      source: 'text',
      noCache: parsed.data.noCache ?? false,
    }),
  });

  for (let waited = 0; waited < 50_000; waited += 1500) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const doc = await getRun(c.env.DB, runId);
    const status = doc?.run?.status as string | undefined;
    if (doc && status && status !== 'running') {
      await recordApiKeyCost(c.env.DB, identity.keyId, Number(doc.run.total_cost_usd ?? 0)).catch(() => undefined);
      return c.json(publicRunView(doc));
    }
  }
  return c.json({ id: runId, status: 'running' }, 202);
});

app.get('/v1/runs/:id', async (c) => {
  const identity = await apiKeyFromRequest(c);
  if (!identity) return c.json({ error: 'invalid or missing API key' }, 401);
  const doc = await getRun(c.env.DB, c.req.param('id'));
  if (!doc || doc.run.user_id !== identity.userId) return c.json({ error: 'not found' }, 404);
  return c.json(publicRunView(doc));
});

// Live report: policy ladders + alternates + real catalog prices merged with
// aggregate run/hop stats from D1 (zeros when no runs yet) — reporting.ts.
app.get('/api/roster', async (c) => c.json(await buildRosterReport(c.env.DB)));

// funnel.json is a harness artifact (SPEC.md §3). Falling back to the
// committed example fixture keeps the route live before the harness has
// produced a real one — same pattern as policy.ts.
app.get('/api/benchmark', async (c) => c.json(await buildBenchmarkReport(c.env.DB)));
app.get('/api/funnel', (c) => {
  // Harness artifact — changes only on deploy. Let the browser and CF edge
  // hold it for an hour instead of re-serializing per pageview.
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(funnelFixture);
});

const suggestRequestSchema = z.object({ context: z.array(z.string()).max(50) });

// Anonymous-friendly (no auth required) but IP-throttled — this is a
// fire-and-forget nudge, not a routed run, so it doesn't need an actor
// identity, only abuse protection. Reuses the same auth_attempts bucket
// mechanism as the auth routes (see auth/routes.ts's clientIp/throttle
// pattern) rather than inventing a second rate-limit store.
app.post('/api/suggest', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = suggestRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const throttle = await checkAndIncrement(c.env.DB, `suggest:ip:${ip}`, Date.now(), {
    windowMs: 60_000,
    max: 20,
  });
  if (!throttle.allowed) {
    c.header('Retry-After', String(Math.ceil(throttle.retryAfterMs / 1000)));
    return c.json({ error: 'rate limited' }, 429);
  }

  const suggestion = await suggestNextAction(c.env, parsed.data.context);
  return c.json({ suggestion });
});

// Composio's toolkit catalog for the "connect an app" picker — always
// returns 100+ apps (live from Composio when COMPOSIO_API_KEY is set and
// reachable, otherwise the bundled fallback list), so the UI never renders
// an empty picker.
app.get('/api/toolkits', async (c) => {
  // Global catalog, identical for every user — edge/browser-cacheable for
  // 10 minutes (the worker-side catalog cache already refreshes daily).
  c.header('Cache-Control', 'public, max-age=600');
  return c.json(await getToolkitCatalog(c.env));
});

// Any Composio catalog slug (1,200+ toolkits), not a hardcoded allowlist —
// the slug is validated for shape here and resolved against Composio's
// auth-config API below, which is the real source of truth for "does this
// toolkit exist / can it connect".
const connectRequestSchema = z.object({
  toolkit: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_-]+$/i, 'toolkit must be a catalog slug'),
  authConfigId: z.string().optional(),
  // Where /oauth/done returns the browser — allowlisted, default /settings.
  returnTo: z.enum(['/', '/settings']).optional(),
});

// Actor-resolved, never body-supplied: the user comes from a verified
// access token OR a signed `__Host-anon` cookie (resolveActor), never from
// the request body — the same IDOR-safe pattern as the rest of the per-user
// store (SPEC.md §5.3 / design doc §6), extended to let an anonymous caller
// start a connect before they've signed up.
//
// Contract: 200 {redirectUrl} (plus legacy url/state) or a structured 422
// {error:"auth_config_unavailable", toolkit} when Composio can't provide a
// managed auth config for the toolkit (needs manual dashboard setup).
app.post('/api/connect', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = connectRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  const { userId } = await resolveActor(c);
  const toolkit = parsed.data.toolkit.toLowerCase();

  let authConfigId = parsed.data.authConfigId;
  if (!authConfigId) {
    if (c.env.COMPOSIO_API_KEY) {
      try {
        authConfigId = await resolveAuthConfigId(c.env.COMPOSIO_API_KEY, toolkit);
      } catch (err) {
        if (err instanceof AuthConfigUnavailableError) {
          console.error(err.message);
          return c.json({ error: 'auth_config_unavailable', toolkit }, 422);
        }
        throw err;
      }
    } else {
      // Keyless dev/test path: createConnectionLink returns its stub link
      // without ever using the id, so a placeholder keeps signatures honest.
      authConfigId = toolkit.toUpperCase();
    }
  }

  const link = await createConnectionLink(c.env, userId, toolkit, authConfigId, parsed.data.returnTo);
  // `redirectUrl` is the cross-agent contract; `url` + `state` remain for
  // existing callers of the older shape.
  return c.json({ redirectUrl: link.url, url: link.url, state: link.state });
});

// ElevenLabs Scribe speech-to-text proxy (SPEC.md §7). No auth requirement —
// voice must work for anonymous users — but resolveActor still runs so the
// caller gets/keeps a signed `__Host-anon` cookie, making the endpoint
// attributable (and rate-limitable) later. Contract: multipart field `audio`
// -> 200 {text}.
app.post('/api/stt', async (c) => {
  await resolveActor(c);

  // Fail closed on the missing secret (same posture as auth/secret.ts), but
  // as a clear 503 rather than an unhandled 500: the route is "unconfigured",
  // not broken.
  const apiKey = c.env.ELEVENLABS_API_KEY;
  if (!apiKey) return c.json({ error: 'stt not configured' }, 503);

  const form = await c.req.raw.formData().catch(() => null);
  if (!form) return c.json({ error: 'multipart/form-data body required' }, 400);
  const audio = form.get('audio');
  if (!(audio instanceof File)) return c.json({ error: 'audio file field required' }, 400);
  if (audio.size > MAX_AUDIO_BYTES) return c.json({ error: 'audio too large (max 15MB)' }, 413);

  try {
    const text = await transcribeAudio(apiKey, audio);
    return c.json({ text });
  } catch (err) {
    const detail = err instanceof SttUpstreamError ? err.message : 'speech-to-text upstream failed';
    console.error('STT proxy failure:', err);
    return c.json({ error: detail }, 502);
  }
});

app.get('/oauth/done', async (c) => {
  // This is hit by the browser redirect straight from Composio, with no
  // bearer token — it authenticates via the signed `state` (which already
  // round-trips userId + toolkit, see providers/composio.ts), NOT
  // requireAuth. v3's callback had no CSRF protection (SPEC.md §5.3) —
  // verify the signed state BEFORE trusting status/connected_account_id
  // from the query string.
  const payload = await verifyState(c.env, c.req.query('state') ?? null);
  if (!payload) return c.json({ error: 'invalid or missing state' }, 400);

  const status = c.req.query('status') ?? 'unknown';
  const connectedAccountId = c.req.query('connected_account_id') ?? null;
  // Only persist when Composio actually handed back an account id — a
  // failed/cancelled callback still carries a validly-signed state but no
  // account to upsert.
  if (connectedAccountId) {
    await upsertConnection(c.env.DB, {
      userId: payload.userId,
      toolkit: payload.toolkit,
      connectedAccountId,
      now: Date.now(),
    });
  }
  // Bounce the browser back into the SPA instead of dead-ending on JSON.
  // Relative redirect keeps whatever origin the callback arrived on — the
  // Vite dev proxy origin in dev, the Worker (which serves the SPA) in
  // prod — so the user lands on their own settings page either way.
  const params = new URLSearchParams({ connected: payload.toolkit, status });
  const dest = payload.returnTo === '/' ? '/' : '/settings';
  return c.redirect(`${dest}?${params.toString()}`, 302);
});

// The default export stays the Hono app (tests rely on app.request), with
// the cron `scheduled` handler attached so the module-worker runtime finds
// both default.fetch and default.scheduled on the same object.
export default Object.assign(app, { scheduled });
