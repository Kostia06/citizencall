// Routine CRUD + manual trigger (SPEC background agents). Mounted at /api in
// index.ts, claiming only /api/routines*.
//
// Identity is resolveActor (not the requireAuth/requireVerified gate): an
// anonymous `__Host-anon` session may create and run routines before signing
// up — rows are keyed by the actor's userId, so the anon->user claim flow can
// re-parent them with one UPDATE on user_routines.user_id. No handler ever
// accepts a user id from the request, so routines stay invisible across
// actors.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { resolveActor } from '../auth/anon';
import {
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutines,
  markRoutineRan,
  updateRoutine,
  type Routine,
} from './store';
import { startRoutineRun } from './scheduler';

export const routineRoutes = new Hono<{ Bindings: Env }>();

const scheduleSchema = z.enum(['hourly', 'daily', 'weekly']).nullable();
const nameSchema = z.string().trim().min(1, 'name required').max(100);
const promptSchema = z.string().min(1, 'prompt required').max(4000);

// `.strict()` so typos ("schdule", "text") fail loudly at the boundary.
const routineCreateSchema = z
  .object({
    name: nameSchema,
    prompt: promptSchema,
    schedule: scheduleSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const routinePatchSchema = z
  .object({
    name: nameSchema.optional(),
    prompt: promptSchema.optional(),
    schedule: scheduleSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// Wire shape (cross-agent contract with the UI): userId never leaves the
// server; enabled crosses as a boolean.
function toJson(r: Routine) {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    schedule: r.schedule,
    enabled: r.enabled,
    lastRunAt: r.lastRunAt,
    createdAt: r.createdAt,
  };
}

routineRoutes.get('/routines', async (c) => {
  const { userId } = await resolveActor(c);
  return c.json((await listRoutines(c.env.DB, userId)).map(toJson));
});

routineRoutes.post('/routines', async (c) => {
  const parsed = routineCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid routine', details: parsed.error.flatten() }, 400);
  const { userId } = await resolveActor(c);
  const routine = await createRoutine(c.env.DB, {
    userId,
    name: parsed.data.name,
    prompt: parsed.data.prompt,
    schedule: parsed.data.schedule ?? null,
    enabled: parsed.data.enabled ?? true,
    now: Date.now(),
  });
  return c.json(toJson(routine), 201);
});

routineRoutes.put('/routines/:id', async (c) => {
  const parsed = routinePatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid routine', details: parsed.error.flatten() }, 400);
  const { userId } = await resolveActor(c);
  const updated = await updateRoutine(c.env.DB, userId, c.req.param('id'), parsed.data);
  return updated ? c.json(toJson(updated)) : c.json({ error: 'not found' }, 404);
});

routineRoutes.delete('/routines/:id', async (c) => {
  const { userId } = await resolveActor(c);
  const ok = await deleteRoutine(c.env.DB, userId, c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'not found' }, 404);
});

// Run NOW: identical run path to POST /api/run (RunDO /start), with the
// routine's prompt as the text. Ownership check first so an actor can never
// trigger (or probe for) someone else's routine.
routineRoutes.post('/routines/:id/run', async (c) => {
  const { userId } = await resolveActor(c);
  const routine = await getRoutine(c.env.DB, userId, c.req.param('id'));
  if (!routine) return c.json({ error: 'not found' }, 404);
  const runId = await startRoutineRun(c.env, routine);
  await markRoutineRan(c.env.DB, routine.id, Date.now());
  console.log(`routines: manual trigger routine=${routine.id} run=${runId}`);
  return c.json({ runId });
});
