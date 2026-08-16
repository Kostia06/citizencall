// Cron due-computation + sweep (worker/src/routines/scheduler.ts). The RunDO
// namespace is mocked so these assert exactly what the sweep sends to
// /start, without spinning real pipeline runs.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { applyRoutinesSchema } from '../../src/routines/schema';
import { isDue, MAX_RUNS_PER_TICK, runScheduledSweep } from '../../src/routines/scheduler';
import type { RoutineSchedule } from '../../src/routines/store';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeAll(async () => {
  await applyRoutinesSchema(env.DB);
});

describe('isDue', () => {
  const cases: Array<[RoutineSchedule | null, number | null, boolean, string]> = [
    ['hourly', null, true, 'never ran -> due immediately'],
    ['hourly', NOW - 30 * MIN, false, 'ran 30min ago -> fresh'],
    ['hourly', NOW - 55 * MIN, true, 'exactly at the 55min threshold -> due'],
    ['hourly', NOW - 2 * HOUR, true, 'ran 2h ago -> due'],
    ['daily', null, true, 'never ran -> due immediately'],
    ['daily', NOW - 22 * HOUR, false, 'ran 22h ago -> fresh'],
    ['daily', NOW - 23.5 * HOUR, true, 'ran 23.5h ago -> due'],
    ['weekly', null, true, 'never ran -> due immediately'],
    ['weekly', NOW - 6 * DAY, false, 'ran 6d ago -> fresh'],
    ['weekly', NOW - 7 * DAY, true, 'ran 7d ago -> due'],
    [null, null, false, 'manual-only never auto-fires'],
    [null, NOW - 30 * DAY, false, 'manual-only never auto-fires even when ancient'],
  ];
  it.each(cases)('%s / lastRunAt=%s -> %s (%s)', (schedule, lastRunAt, expected) => {
    expect(isDue(schedule, lastRunAt, NOW)).toBe(expected);
  });
});

interface StartBody {
  runId: string;
  userId: string;
  text: string;
  source: string;
  noCache: boolean;
}

// Minimal DO-namespace stand-in: records every /start body; optionally
// throws for selected bodies to simulate a routine whose run fails to start.
function mockRunNamespace(failFor?: (body: StartBody) => boolean) {
  const started: StartBody[] = [];
  const ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as StartBody;
        if (failFor?.(body)) throw new Error('simulated DO start failure');
        started.push(body);
        return new Response('{}');
      },
    }),
  };
  return { started, envWithMock: { ...env, RUN: ns } as unknown as Env };
}

async function insertRoutine(r: {
  id: string;
  schedule: RoutineSchedule | null;
  lastRunAt: number | null;
  enabled?: boolean;
  userId?: string;
  prompt?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_routines(id,user_id,name,prompt,schedule,enabled,last_run_at,created_at) VALUES(?,?,?,?,?,?,?,?)`
  )
    .bind(r.id, r.userId ?? `user-${r.id}`, r.id, r.prompt ?? `prompt-${r.id}`, r.schedule, r.enabled === false ? 0 : 1, r.lastRunAt, 1)
    .run();
}

async function lastRunAtOf(id: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT last_run_at FROM user_routines WHERE id=?`).bind(id).first<{ last_run_at: number | null }>();
  return row?.last_run_at ?? null;
}

it('sweep starts due routines with the /api/run start contract and stamps last_run_at', async () => {
  await insertRoutine({ id: 'sw-due-hourly', schedule: 'hourly', lastRunAt: NOW - 2 * HOUR, userId: 'u-sweep-1', prompt: 'check inbox' });
  await insertRoutine({ id: 'sw-fresh-hourly', schedule: 'hourly', lastRunAt: NOW - 10 * MIN });
  await insertRoutine({ id: 'sw-never-daily', schedule: 'daily', lastRunAt: null });
  await insertRoutine({ id: 'sw-manual', schedule: null, lastRunAt: null });
  await insertRoutine({ id: 'sw-disabled', schedule: 'weekly', lastRunAt: NOW - 30 * DAY, enabled: false });

  const { started, envWithMock } = mockRunNamespace();
  const result = await runScheduledSweep(envWithMock, NOW);

  expect(result).toEqual({ started: 2, failed: 0 });
  expect(started.map((b) => b.text).sort()).toEqual(['check inbox', 'prompt-sw-never-daily']);
  const dueStart = started.find((b) => b.text === 'check inbox')!;
  expect(dueStart).toMatchObject({ userId: 'u-sweep-1', source: 'text', noCache: false });
  expect(dueStart.runId).toMatch(/^[0-9a-f-]{36}$/);

  expect(await lastRunAtOf('sw-due-hourly')).toBe(NOW);
  expect(await lastRunAtOf('sw-never-daily')).toBe(NOW);
  expect(await lastRunAtOf('sw-fresh-hourly')).toBe(NOW - 10 * MIN); // untouched
  expect(await lastRunAtOf('sw-disabled')).toBe(NOW - 30 * DAY); // untouched
});

it(`sweep caps at ${MAX_RUNS_PER_TICK} per tick, oldest-due first`, async () => {
  // 12 due routines; i=0 is the most overdue. The two most recent (i=10,11)
  // must be left for the next tick.
  for (let i = 0; i < 12; i++) {
    await insertRoutine({ id: `cap-${i}`, schedule: 'hourly', lastRunAt: NOW - 3 * HOUR + i * MIN, prompt: `cap-${i}` });
  }
  const { started, envWithMock } = mockRunNamespace();
  const result = await runScheduledSweep(envWithMock, NOW);

  expect(result.started).toBe(MAX_RUNS_PER_TICK);
  const startedTexts = started.map((b) => b.text).sort();
  expect(startedTexts).toHaveLength(MAX_RUNS_PER_TICK);
  expect(startedTexts).not.toContain('cap-10');
  expect(startedTexts).not.toContain('cap-11');
  expect(await lastRunAtOf('cap-11')).toBe(NOW - 3 * HOUR + 11 * MIN); // still stale -> due next tick
});

it('one routine failing to start never stops the sweep, and it stays due for retry', async () => {
  await insertRoutine({ id: 'iso-ok-1', schedule: 'hourly', lastRunAt: NOW - 3 * HOUR, prompt: 'ok-1' });
  await insertRoutine({ id: 'iso-boom', schedule: 'hourly', lastRunAt: NOW - 2.5 * HOUR, prompt: 'fail-me' });
  await insertRoutine({ id: 'iso-ok-2', schedule: 'hourly', lastRunAt: NOW - 2 * HOUR, prompt: 'ok-2' });

  const { started, envWithMock } = mockRunNamespace((b) => b.text === 'fail-me');
  const result = await runScheduledSweep(envWithMock, NOW);

  expect(result).toEqual({ started: 2, failed: 1 });
  expect(started.map((b) => b.text).sort()).toEqual(['ok-1', 'ok-2']);
  expect(await lastRunAtOf('iso-ok-1')).toBe(NOW);
  expect(await lastRunAtOf('iso-ok-2')).toBe(NOW);
  // The failed routine keeps its stale stamp so the next tick retries it.
  expect(await lastRunAtOf('iso-boom')).toBe(NOW - 2.5 * HOUR);
});
