// Per-user store routes (SPEC.md §5): settings, connections, mcps, tools.
// Every handler is scoped to c.get('authUserId') — no endpoint accepts a
// user id from the request body/query, so a caller can never read or write
// another user's rows.
//
// Auth is applied per-route (not via a `storeRoutes.use('*', ...)` blanket
// middleware) so that mounting this sub-app at `/api` in index.ts cannot
// shadow the pre-existing, non-auth /api/* routes (/api/run, /api/roster,
// /api/benchmark, /api/funnel, /api/connect) that are registered directly
// on the main app.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { requireAuth, requireVerified } from '../auth/middleware';
import { clearAnonCookie, peekAnonId, resolveActor } from '../auth/anon';
import { getSettings, putSettings } from './settings';
import { validatePrefsPatch } from './prefs';
import { listConnections, revokeConnection } from './connections';
import { claimAnonActor } from './claim';
import { createMcp, deleteMcp, getMcp, listMcps, updateMcp } from './mcps';
import { listToolOverrides, setToolOverride } from './tools';
import { createProvider, deleteProvider, listProviders, maskApiKey, setProviderEnabled } from './user-providers';
import type { UserProvider } from '../providers/user-models';

type Vars = { authUserId?: string; authSessionId?: string; authEmailVerified?: boolean };
type StoreContext = Context<{ Bindings: Env; Variables: Vars }>;

export const storeRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const uid = (c: StoreContext): string => c.get('authUserId') as string;
const now = (): number => Date.now();
const gate = [requireAuth, requireVerified] as const;

// A malformed body (e.g. literal JSON `null`) parses successfully but isn't
// an object, so property access below would throw instead of yielding a
// clean 400. Coalesce anything that isn't a plain object to `{}`.
async function jsonBody(c: StoreContext): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => ({}));
  return raw && typeof raw === 'object' ? raw : {};
}

// Anon-friendly like /connections below: an anonymous `__Host-anon` session
// can arrange bar buttons, alignment, and theme before ever signing up, and
// claim-on-login re-keys the row onto the account. Gating these behind
// requireAuth made every anon/unverified Save 401 — the arranger's order
// then "never changed no matter what" (reported live).
storeRoutes.get('/settings', async (c) => c.json(await getSettings(c.env.DB, (await resolveActor(c)).userId)));

storeRoutes.put('/settings', async (c) => {
  const v = validatePrefsPatch(await c.req.json().catch(() => null));
  if (!v.ok) return c.json({ error: v.reason }, 400);
  return c.json(await putSettings(c.env.DB, (await resolveActor(c)).userId, v.value, now()));
});

// Anon-friendly (resolveActor, not the requireAuth/requireVerified `gate`):
// an unauthenticated caller can see and revoke connections started under
// their own `__Host-anon` session before they ever sign up. `/mcps` and
// `/tools` below are unchanged and stay Bearer + verified-email only.
storeRoutes.get('/connections', async (c) => c.json(await listConnections(c.env.DB, (await resolveActor(c)).userId)));

storeRoutes.delete('/connections/:toolkit', async (c) => {
  const actor = await resolveActor(c);
  await revokeConnection(c.env.DB, actor.userId, c.req.param('toolkit'));
  return c.body(null, 204);
});

// Claim-on-login: re-keys whatever the caller accumulated anonymously
// (connections, settings, MCPs, tool overrides, run history) onto their
// now-authenticated account, then clears the anon cookie. A no-op (still
// 204) when there's no anon cookie to claim. The auth routes also run this
// server-side on login/signup/2fa-verify, so this endpoint is a fallback
// for clients that authenticate out-of-band.
storeRoutes.post('/connections/claim', ...gate, async (c) => {
  const anonId = await peekAnonId(c);
  if (anonId) {
    await claimAnonActor(c.env.DB, anonId, uid(c));
    clearAnonCookie(c);
  }
  return c.body(null, 204);
});

// The actor's recent runs, newest first — chat history for the main screen.
// Anon-friendly on purpose (resolveActor, same identity rule as /api/run):
// an anonymous browser's history is scoped to its signed `__Host-anon`
// cookie, a logged-in user's to their bearer id. Only the caller's own rows
// are ever selected, so one actor can never page through another's runs.
storeRoutes.get('/sessions', async (c) => {
  const actor = await resolveActor(c);
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, request_text, created_at, total_cost_usd, status
       FROM runs WHERE user_id=? ORDER BY created_at DESC LIMIT 50`
    )
    .bind(actor.userId)
    .all<{ id: string; request_text: string; created_at: number; total_cost_usd: number | null; status: string }>();
  return c.json(
    results.map((r) => ({
      id: r.id,
      requestText: r.request_text,
      createdAt: r.created_at,
      totalCostUsd: r.total_cost_usd ?? 0,
      status: r.status,
    }))
  );
});

// Delete one past run and its child rows — same actor scoping as the list
// above, so a caller can only ever delete their own history. The ownership
// check rides in the runs DELETE itself (user_id bind); child deletes are
// gated on that row actually having been removed.
storeRoutes.delete('/sessions/:id', async (c) => {
  const actor = await resolveActor(c);
  const runId = c.req.param('id');
  const owned = await c.env.DB.prepare('DELETE FROM runs WHERE id=? AND user_id=?').bind(runId, actor.userId).run();
  if ((owned.meta.changes ?? 0) === 0) return c.json({ error: 'Not found.' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sub_tasks WHERE run_id=?').bind(runId),
    c.env.DB.prepare('DELETE FROM hops WHERE run_id=?').bind(runId),
    c.env.DB.prepare('DELETE FROM tool_calls WHERE run_id=?').bind(runId),
  ]);
  return c.body(null, 204);
});

// ---- Model providers (bring-your-own-key) ---------------------------------
// Anon-friendly like /connections: an anonymous session can save a key and
// claim-on-login re-parents the row. The API key is write-only — every read
// path returns it masked to `…last4`; the full key never leaves the server
// after creation.

// min(8): a masked key echoes its last 4 chars, which must never be most of
// the key. Real provider keys are all far longer.
const providerCreateSchema = z
  .object({
    kind: z.enum(['anthropic', 'openai', 'custom']),
    model: z.string().trim().min(1, 'model required').max(120),
    apiKey: z.string().trim().min(8, 'apiKey too short').max(500),
    baseUrl: z
      .string()
      .url()
      .refine((u) => /^https:\/\//i.test(u), { message: 'baseUrl must be https' })
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, rctx) => {
    // base_url is what a 'custom' provider IS; on the fixed-endpoint kinds a
    // stray baseUrl would be silently ignored — reject it loudly instead.
    if (v.kind === 'custom' && !v.baseUrl) {
      rctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'baseUrl required for custom providers' });
    }
    if (v.kind !== 'custom' && v.baseUrl) {
      rctx.addIssue({ code: 'custom', path: ['baseUrl'], message: `baseUrl not allowed for ${v.kind}` });
    }
  });

function maskedProvider(p: UserProvider) {
  return {
    id: p.id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKeyMasked: maskApiKey(p.apiKey),
    enabled: p.enabled,
    createdAt: p.createdAt,
  };
}

storeRoutes.get('/providers', async (c) => {
  const actor = await resolveActor(c);
  return c.json((await listProviders(c.env.DB, actor.userId)).map(maskedProvider));
});

storeRoutes.post('/providers', async (c) => {
  const parsed = providerCreateSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return c.json({ error: 'invalid provider', details: parsed.error.flatten() }, 400);
  const actor = await resolveActor(c);
  const { kind, model, apiKey, baseUrl, enabled } = parsed.data;
  const created = await createProvider(c.env.DB, { userId: actor.userId, kind, model, apiKey, baseUrl, enabled, now: now() });
  return c.json(maskedProvider(created), 201);
});

storeRoutes.patch('/providers/:id', async (c) => {
  const b = await jsonBody(c);
  if (typeof b.enabled !== 'boolean') return c.json({ error: 'enabled (boolean) required' }, 400);
  const actor = await resolveActor(c);
  const ok = await setProviderEnabled(c.env.DB, actor.userId, c.req.param('id'), b.enabled);
  return ok ? c.body(null, 200) : c.json({ error: 'Not found.' }, 404);
});

storeRoutes.delete('/providers/:id', async (c) => {
  const actor = await resolveActor(c);
  const ok = await deleteProvider(c.env.DB, actor.userId, c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'Not found.' }, 404);
});

// Custom MCP entry validation: name required, url must be http(s), headers
// (optional) a flat string->string record, enabled (optional) a bool.
// `.strict()` rejects unknown keys so typos ("hdrs", "uri") fail loudly at
// the boundary instead of silently persisting a config the pipeline ignores.
const mcpUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'url must be http(s)' });
const mcpHeadersSchema = z.record(z.string(), z.string());

const mcpCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'name required').max(120),
    url: mcpUrlSchema,
    headers: mcpHeadersSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const mcpPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'name must be non-empty').max(120).optional(),
    url: mcpUrlSchema.optional(),
    headers: mcpHeadersSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

storeRoutes.get('/mcps', ...gate, async (c) => c.json(await listMcps(c.env.DB, uid(c))));

storeRoutes.post('/mcps', ...gate, async (c) => {
  const parsed = mcpCreateSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return c.json({ error: 'invalid mcp', details: parsed.error.flatten() }, 400);
  const { name, url, headers, enabled } = parsed.data;
  return c.json(
    await createMcp(c.env.DB, { userId: uid(c), name, config: { url, headers: headers ?? {} }, enabled, now: now() }),
    201
  );
});

storeRoutes.patch('/mcps/:id', ...gate, async (c) => {
  const parsed = mcpPatchSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return c.json({ error: 'invalid mcp', details: parsed.error.flatten() }, 400);
  const { name, url, headers, enabled } = parsed.data;

  // url/headers live together inside config_json — a partial change to
  // either merges over the current row (read-modify-write, owner-scoped).
  let config: { url: string; headers: Record<string, string> } | undefined;
  if (url !== undefined || headers !== undefined) {
    const current = await getMcp(c.env.DB, uid(c), c.req.param('id'));
    if (!current) return c.json({ error: 'Not found.' }, 404);
    config = { url: url ?? current.url, headers: headers ?? current.headers };
  }

  const ok = await updateMcp(c.env.DB, uid(c), c.req.param('id'), { name, config, enabled });
  return ok ? c.body(null, 200) : c.json({ error: 'Not found.' }, 404);
});

storeRoutes.delete('/mcps/:id', ...gate, async (c) => {
  const ok = await deleteMcp(c.env.DB, uid(c), c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'Not found.' }, 404);
});

storeRoutes.get('/tools', ...gate, async (c) => c.json(await listToolOverrides(c.env.DB, uid(c))));

storeRoutes.patch('/tools', ...gate, async (c) => {
  const b = await jsonBody(c);
  if (typeof b.toolkit !== 'string' || typeof b.tool !== 'string' || typeof b.enabled !== 'boolean') {
    return c.json({ error: 'toolkit, tool, enabled required' }, 400);
  }
  await setToolOverride(c.env.DB, { userId: uid(c), toolkit: b.toolkit, tool: b.tool, enabled: b.enabled });
  return c.body(null, 200);
});
