// Understudy Worker — Hono app + all routes (SPEC.md §13). Durable Object
// class is re-exported here because wrangler.jsonc's `main` points at this
// file and resolves `class_name: "RunDO"` against its exports.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { getRoster, getRun } from './db';
import { createConnectionLink, verifyState } from './providers/composio';
import { policy } from './policy';
import resultsFixture from '../../artifacts/results.example.json';
import funnelFixture from '../../artifacts/funnel.example.json';

export { RunDO } from './run.do';

const app = new Hono<{ Bindings: Env }>();

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
  userId: z.string().min(1),
  toolkit: z.enum(['github', 'gmail']),
  authConfigId: z.string().optional(),
});

app.post('/api/connect', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = connectRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400);

  const { userId, toolkit } = parsed.data;
  const authConfigId = parsed.data.authConfigId ?? toolkit.toUpperCase();
  const link = await createConnectionLink(c.env, userId, toolkit, authConfigId);
  return c.json(link);
});

app.get('/oauth/done', async (c) => {
  // v3's callback had no CSRF protection (SPEC.md §5.3) — verify the signed
  // state BEFORE trusting status/connected_account_id from the query string.
  const payload = await verifyState(c.env, c.req.query('state') ?? null);
  if (!payload) return c.json({ error: 'invalid or missing state' }, 400);

  const status = c.req.query('status') ?? 'unknown';
  const connectedAccountId = c.req.query('connected_account_id') ?? null;
  return c.json({ userId: payload.userId, toolkit: payload.toolkit, status, connectedAccountId });
});

export default app;
