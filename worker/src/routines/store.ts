// user_routines data access. Every read/write is owner-scoped by user_id
// (except the scheduler's sweep query, which is cross-user by design and
// never exposed over HTTP). Ensures its own schema lazily, like the cache
// modules.
import { ensureRoutinesSchema } from './schema';

export type RoutineSchedule = 'hourly' | 'daily' | 'weekly';

export interface Routine {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule | null;
  /** UTC hour (0-23) a daily routine should fire at; null = fire on the
   * first sweep after its period elapses (the pre-time-of-day behavior). */
  runAtHour: number | null;
  enabled: boolean;
  lastRunAt: number | null;
  createdAt: number;
}

interface RoutineRow {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  schedule: string | null;
  run_at_hour: number | null;
  enabled: number;
  last_run_at: number | null;
  created_at: number;
}

function fromRow(row: RoutineRow): Routine {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prompt: row.prompt,
    schedule: (row.schedule as RoutineSchedule | null) ?? null,
    runAtHour: row.run_at_hour ?? null,
    enabled: row.enabled !== 0,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  };
}

const COLS = 'id,user_id,name,prompt,schedule,run_at_hour,enabled,last_run_at,created_at';

export async function listRoutines(db: D1Database, userId: string): Promise<Routine[]> {
  await ensureRoutinesSchema(db);
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM user_routines WHERE user_id=? ORDER BY created_at DESC, id`)
    .bind(userId)
    .all<RoutineRow>();
  return results.map(fromRow);
}

export async function getRoutine(db: D1Database, userId: string, id: string): Promise<Routine | null> {
  await ensureRoutinesSchema(db);
  const row = await db
    .prepare(`SELECT ${COLS} FROM user_routines WHERE id=? AND user_id=?`)
    .bind(id, userId)
    .first<RoutineRow>();
  return row ? fromRow(row) : null;
}

export interface RoutineCreate {
  userId: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule | null;
  /** UTC hour for daily routines; omit/null for period-elapsed firing. */
  runAtHour?: number | null;
  enabled: boolean;
  now: number;
}

export async function createRoutine(db: D1Database, input: RoutineCreate): Promise<Routine> {
  await ensureRoutinesSchema(db);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO user_routines(id,user_id,name,prompt,schedule,run_at_hour,enabled,last_run_at,created_at)
       VALUES(?,?,?,?,?,?,?,NULL,?)`
    )
    .bind(id, input.userId, input.name, input.prompt, input.schedule, input.runAtHour ?? null, input.enabled ? 1 : 0, input.now)
    .run();
  return {
    id,
    userId: input.userId,
    name: input.name,
    prompt: input.prompt,
    schedule: input.schedule,
    runAtHour: input.runAtHour ?? null,
    enabled: input.enabled,
    lastRunAt: null,
    createdAt: input.now,
  };
}

export interface RoutinePatch {
  name?: string;
  prompt?: string;
  schedule?: RoutineSchedule | null;
  enabled?: boolean;
}

// Read-merge-write (owner-scoped) rather than dynamic SQL: routines are tiny
// rows and this returns the updated shape without a second SELECT.
export async function updateRoutine(
  db: D1Database,
  userId: string,
  id: string,
  patch: RoutinePatch
): Promise<Routine | null> {
  const current = await getRoutine(db, userId, id);
  if (!current) return null;
  const next: Routine = {
    ...current,
    name: patch.name ?? current.name,
    prompt: patch.prompt ?? current.prompt,
    schedule: patch.schedule !== undefined ? patch.schedule : current.schedule,
    enabled: patch.enabled ?? current.enabled,
  };
  await db
    .prepare(`UPDATE user_routines SET name=?, prompt=?, schedule=?, enabled=? WHERE id=? AND user_id=?`)
    .bind(next.name, next.prompt, next.schedule, next.enabled ? 1 : 0, id, userId)
    .run();
  return next;
}

export async function deleteRoutine(db: D1Database, userId: string, id: string): Promise<boolean> {
  await ensureRoutinesSchema(db);
  const res = await db.prepare(`DELETE FROM user_routines WHERE id=? AND user_id=?`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function markRoutineRan(db: D1Database, id: string, now: number): Promise<void> {
  await ensureRoutinesSchema(db);
  await db.prepare(`UPDATE user_routines SET last_run_at=? WHERE id=?`).bind(now, id).run();
}

// Scheduler sweep input: enabled routines with a schedule, across all users.
// Due-ness itself is computed in JS (scheduler.ts isDue) so it's unit-testable
// without a clock in SQL.
export async function listScheduledCandidates(db: D1Database): Promise<Routine[]> {
  await ensureRoutinesSchema(db);
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM user_routines WHERE enabled=1 AND schedule IS NOT NULL`)
    .all<RoutineRow>();
  return results.map(fromRow);
}
