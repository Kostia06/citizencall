// /api/memories — per-user memory CRUD (roadmap sub-project #3).
//
// Owner scoping follows the /connections precedent, not the /settings one:
// every handler resolves the actor via resolveActor (authed bearer wins,
// else the signed __Host-anon cookie), so anonymous users accumulate
// memories too and the anon→user claim flow can re-parent them later
// (reassignMemories in store.ts). No endpoint accepts a user id from the
// request, so a caller can never read or write another user's memories.
//
// Auth is applied per-route (no blanket middleware), so mounting this
// sub-app at /api cannot shadow the non-auth /api/* routes registered
// directly on the main app — same rule as store/routes.ts.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { resolveActor } from '../auth/anon';
import { createMemory, deleteMemory, getMemory, listMemories, updateMemory, type Memory } from './store';
import { resolveMemory } from './resolve';

export const memoryRoutes = new Hono<{ Bindings: Env }>();

// userId stays server-side; the client never needs it and must never send it.
function project(m: Memory) {
  return { id: m.id, title: m.title, contentMd: m.contentMd, source: m.source, createdAt: m.createdAt, updatedAt: m.updatedAt };
}

const createSchema = z
  .object({
    title: z.string().trim().min(1, 'title required').max(200),
    contentMd: z.string().min(1, 'contentMd required').max(20_000),
  })
  .strict();

const patchSchema = z
  .object({
    title: z.string().trim().min(1, 'title must be non-empty').max(200).optional(),
    contentMd: z.string().min(1, 'contentMd must be non-empty').max(20_000).optional(),
  })
  .strict();

memoryRoutes.get('/memories', async (c) => {
  const { userId } = await resolveActor(c);
  const list = await listMemories(c.env.DB, userId);
  return c.json(list.map(project));
});

memoryRoutes.get('/memories/:id', async (c) => {
  const { userId } = await resolveActor(c);
  const memory = await getMemory(c.env.DB, userId, c.req.param('id'));
  if (!memory) return c.json({ error: 'Not found.' }, 404);
  // Cycle-safe link resolution (visited-set + depth cap in resolve.ts) — a
  // self-linking memory serves fine here rather than hanging the request.
  const resolved = await resolveMemory(c.env.DB, userId, memory.id, { maxDepth: 2 });
  return c.json({
    ...project(memory),
    links: {
      memories: (resolved?.linked ?? []).map((m) => ({ id: m.id, title: m.title })),
      tools: resolved?.tools ?? [],
      unresolved: resolved?.unresolved ?? [],
      truncated: resolved?.truncated ?? false,
    },
  });
});

memoryRoutes.post('/memories', async (c) => {
  const { userId } = await resolveActor(c);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid memory', details: parsed.error.flatten() }, 400);
  const memory = await createMemory(c.env.DB, {
    userId,
    title: parsed.data.title,
    contentMd: parsed.data.contentMd,
    source: 'user',
  });
  return c.json(project(memory), 201);
});

memoryRoutes.put('/memories/:id', async (c) => {
  const { userId } = await resolveActor(c);
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid memory', details: parsed.error.flatten() }, 400);
  const updated = await updateMemory(c.env.DB, userId, c.req.param('id'), {
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.contentMd !== undefined ? { contentMd: parsed.data.contentMd } : {}),
  });
  return updated ? c.json(project(updated)) : c.json({ error: 'Not found.' }, 404);
});

memoryRoutes.delete('/memories/:id', async (c) => {
  const { userId } = await resolveActor(c);
  const ok = await deleteMemory(c.env.DB, userId, c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'Not found.' }, 404);
});
