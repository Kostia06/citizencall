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
import type { Env } from '../env';
import { requireAuth, requireVerified } from '../auth/middleware';
import { getSettings, putSettings } from './settings';
import { validatePrefsPatch } from './prefs';
import { listConnections, revokeConnection } from './connections';
import { createMcp, deleteMcp, listMcps, updateMcp } from './mcps';
import { listToolOverrides, setToolOverride } from './tools';

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

storeRoutes.get('/settings', ...gate, async (c) => c.json(await getSettings(c.env.DB, uid(c))));

storeRoutes.put('/settings', ...gate, async (c) => {
  const v = validatePrefsPatch(await c.req.json().catch(() => null));
  if (!v.ok) return c.json({ error: v.reason }, 400);
  return c.json(await putSettings(c.env.DB, uid(c), v.value, now()));
});

storeRoutes.get('/connections', ...gate, async (c) => c.json(await listConnections(c.env.DB, uid(c))));

storeRoutes.delete('/connections/:toolkit', ...gate, async (c) => {
  await revokeConnection(c.env.DB, uid(c), c.req.param('toolkit'));
  return c.body(null, 204);
});

storeRoutes.get('/mcps', ...gate, async (c) => c.json(await listMcps(c.env.DB, uid(c))));

storeRoutes.post('/mcps', ...gate, async (c) => {
  const b = await jsonBody(c);
  if (typeof b.name !== 'string') return c.json({ error: 'name required' }, 400);
  return c.json(await createMcp(c.env.DB, { userId: uid(c), name: b.name, config: b.config, now: now() }), 201);
});

storeRoutes.patch('/mcps/:id', ...gate, async (c) => {
  const b = await jsonBody(c);
  const ok = await updateMcp(c.env.DB, uid(c), c.req.param('id'), b);
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
