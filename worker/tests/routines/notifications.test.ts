// GET /api/notifications (routines/routes.ts + routines/run-links.ts): the
// actor's routine-triggered runs, newest first, joined to runs for status /
// cost / answer preview. Owner scoping mirrors tests/routines/routes.test.ts.
import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import app from '../../src/index';
import type { Env } from '../../src/env';
import { applyAuthSchema } from '../../src/db';
import { applyCoreSchema } from '../support/schema';
import { applyRoutinesSchema } from '../../src/routines/schema';
import { applyRoutineRunsSchema, linkRoutineRun, listRoutineRunNotifications } from '../../src/routines/run-links';
import { signAccessToken } from '../../src/auth/jwt';

// Isolated storage resets D1 between tests, but the modules' ensure guards
// are per-isolate — re-apply every schema explicitly.
beforeEach(async () => {
  await applyCoreSchema(env.DB);
  await applyAuthSchema(env.DB);
  await applyRoutinesSchema(env.DB);
  await applyRoutineRunsSchema(env.DB);
  // runs.answer_text postdates schema.sql; seeds below write it directly.
  await env.DB.exec('ALTER TABLE runs ADD COLUMN answer_text TEXT').catch(() => undefined);
});

async function verifiedToken(userId: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`
  )
    .bind(userId, `${userId}@example.com`)
    .run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}
const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });

async function seedRoutine(id: string, userId: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_routines(id,user_id,name,prompt,schedule,enabled,last_run_at,created_at) VALUES(?,?,?,?,NULL,1,NULL,1)`
  )
    .bind(id, userId, name, 'do the thing')
    .run();
}

async function seedRun(p: {
  id: string;
  userId: string;
  createdAt: number;
  status?: string;
  cost?: number;
  answer?: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,user_id,request_text,source,created_at,status,total_cost_usd,answer_text) VALUES(?,?,?,?,?,?,?,?)`
  )
    .bind(p.id, p.userId, 'do the thing', 'text', p.createdAt, p.status ?? 'done', p.cost ?? 0.01, p.answer ?? null)
    .run();
}

it('lists own routine runs newest first with joined name/status and truncated answer', async () => {
  const t = await verifiedToken('u-nf-1');
  await seedRoutine('rt-1', 'u-nf-1', 'Morning digest');
  const longAnswer = 'x'.repeat(300);
  await seedRun({ id: 'run-old', userId: 'u-nf-1', createdAt: 1000, answer: 'all done' });
  await seedRun({ id: 'run-new', userId: 'u-nf-1', createdAt: 2000, status: 'error', cost: 0, answer: longAnswer });
  await linkRoutineRun(env.DB, { runId: 'run-old', routineId: 'rt-1', userId: 'u-nf-1', now: 1000 });
  await linkRoutineRun(env.DB, { runId: 'run-new', routineId: 'rt-1', userId: 'u-nf-1', now: 2000 });

  const res = await app.request('/api/notifications', auth(t), env);
  expect(res.status).toBe(200);
  const rows = await res.json<any[]>();
  expect(rows.map((r) => r.runId)).toEqual(['run-new', 'run-old']);
  expect(rows[0]).toMatchObject({
    routineId: 'rt-1',
    routineName: 'Morning digest',
    createdAt: 2000,
    status: 'error',
    totalCostUsd: 0,
  });
  expect(rows[0].answerPreview).toHaveLength(201); // 200 chars + ellipsis
  expect(rows[0].answerPreview.endsWith('…')).toBe(true);
  expect(rows[1].answerPreview).toBe('all done');
});

it('never shows another actor rows and survives a deleted routine', async () => {
  const t = await verifiedToken('u-nf-owner');
  await seedRoutine('rt-mine', 'u-nf-owner', 'Mine');
  await seedRun({ id: 'run-mine', userId: 'u-nf-owner', createdAt: 500 });
  await linkRoutineRun(env.DB, { runId: 'run-mine', routineId: 'rt-mine', userId: 'u-nf-owner', now: 500 });
  // Other actor's linkage — must be invisible to the token user.
  await seedRun({ id: 'run-theirs', userId: 'u-nf-other', createdAt: 600 });
  await linkRoutineRun(env.DB, { runId: 'run-theirs', routineId: 'rt-x', userId: 'u-nf-other', now: 600 });
  // Deleting the routine keeps the history row with a fallback name.
  await env.DB.prepare(`DELETE FROM user_routines WHERE id='rt-mine'`).run();

  const rows = await (await app.request('/api/notifications', auth(t), env)).json<any[]>();
  expect(rows.map((r: any) => r.runId)).toEqual(['run-mine']);
  expect(rows[0].routineName).toBe('Deleted routine');
});

it('caps the feed at 30 rows', async () => {
  for (let i = 0; i < 35; i++) {
    await seedRun({ id: `run-${i}`, userId: 'u-nf-cap', createdAt: i });
    await linkRoutineRun(env.DB, { runId: `run-${i}`, routineId: 'rt-cap', userId: 'u-nf-cap', now: i });
  }
  const rows = await listRoutineRunNotifications(env.DB, 'u-nf-cap');
  expect(rows).toHaveLength(30);
  expect(rows[0]!.runId).toBe('run-34'); // newest first
});

it('manual POST /api/routines/:id/run records the routine->run linkage', async () => {
  const t = await verifiedToken('u-nf-trigger');
  await seedRoutine('rt-trig', 'u-nf-trigger', 'Trigger me');
  // Minimal DO-namespace stand-in (mirrors tests/routines/scheduler.test.ts)
  // so the trigger path runs without invoking the real pipeline.
  const ns = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => new Response('{}') }),
  };
  const envWithMock = { ...env, RUN: ns } as unknown as Env;

  const res = await app.request('/api/routines/rt-trig/run', { method: 'POST', ...auth(t) }, envWithMock);
  expect(res.status).toBe(200);
  const { runId } = await res.json<{ runId: string }>();

  const row = await env.DB.prepare('SELECT routine_id, user_id FROM routine_runs WHERE run_id=?')
    .bind(runId)
    .first<{ routine_id: string; user_id: string }>();
  expect(row).toEqual({ routine_id: 'rt-trig', user_id: 'u-nf-trigger' });
});
