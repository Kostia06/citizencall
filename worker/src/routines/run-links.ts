// routine_runs — records which pipeline run each routine execution started,
// so the notifications feed can say "this cron ran, here's its output". One
// row per startRoutineRun call (cron sweep AND manual trigger — both funnel
// through scheduler.startRoutineRun).
//
// Lazily provisioned like store/api-keys.ts (WeakSet ensure + exported
// applySchema for tests); the DDL also lives in worker/schema.sql for
// `pnpm db:reset`.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS routine_runs(
  run_id TEXT PRIMARY KEY, routine_id TEXT NOT NULL,
  user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_routine_runs_user ON routine_runs(user_id, created_at DESC)`;

/** Idempotent DDL — tests call this per-test (isolated storage resets D1
 * between tests while module state persists, so the WeakSet guard below
 * must not be the only path to a CREATE). */
export async function applyRoutineRunsSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

const ensured = new WeakSet<D1Database>();
async function ensureSchema(db: D1Database): Promise<void> {
  if (ensured.has(db)) return;
  await applyRoutineRunsSchema(db);
  ensured.add(db);
}

export async function linkRoutineRun(
  db: D1Database,
  p: { runId: string; routineId: string; userId: string; now: number }
): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare('INSERT INTO routine_runs(run_id, routine_id, user_id, created_at) VALUES (?,?,?,?)')
    .bind(p.runId, p.routineId, p.userId, p.now)
    .run();
}

/** Wire shape of one GET /api/notifications row. */
export interface RoutineRunNotification {
  runId: string;
  routineId: string;
  /** Falls back to "Deleted routine" when the routine row is gone —
   * history must outlive the routine that produced it. */
  routineName: string;
  createdAt: number;
  status: string;
  totalCostUsd: number;
  /** Final reply truncated to ~200 chars; null while running / on error. */
  answerPreview: string | null;
}

const PREVIEW_CHARS = 200;

export async function listRoutineRunNotifications(
  db: D1Database,
  userId: string
): Promise<RoutineRunNotification[]> {
  await ensureSchema(db);
  // runs.answer_text postdates schema.sql (db.ts saveRunAnswer ALTERs it in
  // lazily), so ensure it here too or the SELECT below 500s on a fresh DB.
  // Unconditional (no module flag): in tests, isolated storage resets D1
  // between tests while module state would persist and skip the ALTER.
  await db.exec('ALTER TABLE runs ADD COLUMN answer_text TEXT').catch(() => undefined);
  // Inner join on runs: a notification without its run row (run deleted, or
  // the DO insert hasn't landed yet) has nothing to show — drop it.
  const { results } = await db
    .prepare(
      `SELECT rr.run_id, rr.routine_id, rr.created_at,
              COALESCE(ur.name, 'Deleted routine') AS routine_name,
              r.status, r.total_cost_usd, r.answer_text
       FROM routine_runs rr
       JOIN runs r ON r.id = rr.run_id
       LEFT JOIN user_routines ur ON ur.id = rr.routine_id
       WHERE rr.user_id = ?
       ORDER BY rr.created_at DESC LIMIT 30`
    )
    .bind(userId)
    .all<{
      run_id: string;
      routine_id: string;
      created_at: number;
      routine_name: string;
      status: string;
      total_cost_usd: number | null;
      answer_text: string | null;
    }>();
  return results.map((r) => ({
    runId: r.run_id,
    routineId: r.routine_id,
    routineName: r.routine_name,
    createdAt: r.created_at,
    status: r.status,
    totalCostUsd: r.total_cost_usd ?? 0,
    answerPreview:
      r.answer_text == null
        ? null
        : r.answer_text.length > PREVIEW_CHARS
          ? `${r.answer_text.slice(0, PREVIEW_CHARS)}…`
          : r.answer_text,
  }));
}
