// Understudy Worker — Hono app + all routes (SPEC.md §13). Durable Object
// class is re-exported here because wrangler.jsonc's `main` points at this
// file and resolves `class_name: "RunDO"` against its exports.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { getRoster, getRun } from './db';
import { createConnectionLink, verifyState } from './providers/composio';
import { policy } from './policy';
import { authRoutes } from './auth/routes';
import type { AuthVars } from './auth/middleware';
import { resolveActor } from './auth/anon';
import { storeRoutes } from './store/routes';
import { upsertConnection } from './store/connections';
import resultsFixture from '../../artifacts/results.example.json';
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

const runRequestSchema = z.object({
  userId: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(['text', 'voice']),
  noCache: z.boolean().optional(),
});

app.post('/api/run', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  const runId = crypto.randomUUID();
  const stub = c.env.RUN.get(c.env.RUN.idFromName(runId));
  await stub.fetch('https://run.do/start', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      userId: parsed.data.userId,
      text: parsed.data.text,
      source: parsed.data.source,
    }),
  });
  return c.json({ runId });
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

app.get('/api/roster', async (c) => {
  const roster = await getRoster(c.env.DB);
  return c.json({ roster, policyVersion: policy.version });
});

// results.json / funnel.json are harness artifacts (SPEC.md §3). Falling
// back to the committed example fixtures keeps these routes live before the
// harness has produced real ones — same pattern as policy.ts.
app.get('/api/benchmark', (c) => c.json(resultsFixture));
app.get('/api/funnel', (c) => c.json(funnelFixture));

const connectRequestSchema = z.object({
  toolkit: z.enum(['github', 'gmail']),
  authConfigId: z.string().optional(),
});

// Actor-resolved, never body-supplied: the user comes from a verified
// access token OR a signed `__Host-anon` cookie (resolveActor), never from
// the request body — the same IDOR-safe pattern as the rest of the per-user
// store (SPEC.md §5.3 / design doc §6), extended to let an anonymous caller
// start a connect before they've signed up.
app.post('/api/connect', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = connectRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  const { userId } = await resolveActor(c);
  const { toolkit } = parsed.data;
  const authConfigId = parsed.data.authConfigId ?? toolkit.toUpperCase();
  const link = await createConnectionLink(c.env, userId, toolkit, authConfigId);
  return c.json(link);
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
  return c.json({ userId: payload.userId, toolkit: payload.toolkit, status, connectedAccountId });
});

export default app;
