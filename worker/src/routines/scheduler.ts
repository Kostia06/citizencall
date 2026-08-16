// Cron sweep + shared "start a run for a routine" path (SPEC background
// agents). Runs go through the RunDO exactly like POST /api/run — same
// /start body, same idFromName routing — so SSE streaming, run persistence,
// and session history all behave identically to a hand-typed run.
import type { Env } from '../env';
import { listScheduledCandidates, markRoutineRan, type Routine, type RoutineSchedule } from './store';

// Coarse on purpose: the cron tick is every 15 minutes, so each threshold is
// set just under its nominal period ("hourly" fires on the first tick after
// ~55min) — the tick granularity bounds the drift.
export const DUE_THRESHOLD_MS: Record<RoutineSchedule, number> = {
  hourly: 55 * 60_000,
  daily: 23 * 3_600_000,
  weekly: Math.round(6.9 * 24 * 3_600_000),
};

// Per-tick cap keeps one pathological tick (e.g. after a long outage where
// everything is due) from starting an unbounded number of pipeline runs.
export const MAX_RUNS_PER_TICK = 10;

export function isDue(schedule: RoutineSchedule | null, lastRunAt: number | null, now: number): boolean {
  if (!schedule) return false; // manual-only routines never auto-fire
  if (lastRunAt === null) return true; // never ran: due on the first tick
  return now - lastRunAt >= DUE_THRESHOLD_MS[schedule];
}

// Same contract as index.ts's POST /api/run handler: fresh runId, DO looked
// up by idFromName(runId), /start body {runId,userId,text,source,noCache}.
export async function startRoutineRun(env: Env, routine: Pick<Routine, 'userId' | 'prompt'>): Promise<string> {
  const runId = crypto.randomUUID();
  const stub = env.RUN.get(env.RUN.idFromName(runId));
  await stub.fetch('https://run.do/start', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      userId: routine.userId,
      text: routine.prompt,
      source: 'text',
      noCache: false,
    }),
  });
  return runId;
}

export interface SweepResult {
  started: number;
  failed: number;
}

export async function runScheduledSweep(env: Env, now: number): Promise<SweepResult> {
  const candidates = await listScheduledCandidates(env.DB);
  const due = candidates
    .filter((r) => isDue(r.schedule, r.lastRunAt, now))
    // Oldest-due first (never-ran sorts as 0, i.e. most overdue) so the
    // per-tick cap starves nothing permanently — leftovers lead next tick.
    .sort((a, b) => (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0))
    .slice(0, MAX_RUNS_PER_TICK);

  let started = 0;
  let failed = 0;
  for (const routine of due) {
    // One routine failing to start must never abort the rest of the sweep.
    try {
      const runId = await startRoutineRun(env, routine);
      await markRoutineRan(env.DB, routine.id, now);
      console.log(`routines: cron triggered routine=${routine.id} run=${runId}`);
      started += 1;
    } catch (err) {
      failed += 1;
      console.error(`routines: failed to start routine=${routine.id}:`, err);
    }
  }
  return { started, failed };
}

// Module-worker `scheduled` handler, attached to the default export in
// index.ts. Awaited directly (not waitUntil) so cron invocation logs reflect
// the real outcome.
export async function scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const { started, failed } = await runScheduledSweep(env, Date.now());
  console.log(`routines: sweep cron="${controller.cron}" started=${started} failed=${failed}`);
}
