// Chat-created routines: "create a routine that…" is a side-effecting
// command, not a question — run.ts short-circuits here BEFORE the run cache
// and the planner, because a cached CREATE would replay the confirmation
// without the side effect, and an 18s frontier plan buys nothing a regex
// already decided. Extraction mirrors memory-hook.ts: one cheap-model call,
// heuristic fallback, zero-key dev/tests stay fully functional.
import type { Env } from '../env';
import type { TraceEvent } from '../types';
import { callFeatherless } from '../providers/featherless';
import { cheapestAvailableModel } from './suggest';
import { buildRunEndEvent } from './trace';
import { createRoutine, listRoutines, type RoutineSchedule } from '../routines/store';
import { createMemory, getMemoryByTitle } from '../memory/store';
import { finalizeRun, saveRunAnswer } from '../db';

// Creation verbs must precede "routine" in the SAME sentence — "what is a
// routine" and "run my routine" have no verb and must fall through to the
// normal pipeline. "remind me …" only counts with a recurrence word: a
// one-off "remind me to buy milk" is a task, not a routine.
const CREATE_ROUTINE = /\b(?:create|make|add|set\s*up)\b[^.!?]*\broutine\b/i;
const RECURRING_REMIND = /\bremind me\b[^.!?]*\b(?:daily|weekly|hourly|(?:every|each)\s+(?:day|morning|evening|night|week|hour))\b/i;

export function isRoutineCreationIntent(text: string): boolean {
  return CREATE_ROUTINE.test(text) || RECURRING_REMIND.test(text);
}

export interface RoutineSpec {
  name: string;
  prompt: string;
  schedule: RoutineSchedule | null;
  /** Requested time of day in the USER'S local clock (0-23), when the text
   * states one ("at 6 am") — converted to UTC at persist time using the
   * client-sent tz offset. Null = no stated time. */
  runAtHourLocal: number | null;
}

/** "at 6 am" / "at 6:30pm" / "at 18:00" → local hour 0-23; bare "at 6" is
 * ambiguous and ignored. Exported for tests. */
export function hourFromText(text: string): number | null {
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const meridiem = m[3]?.toLowerCase();
  if (!meridiem && m[2] === undefined) return null; // "at 6" — could be anything
  if (hour > 23 || (meridiem && hour > 12)) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return hour;
}

/** "every morning" and friends map onto the schema's three-value enum;
 * anything unstated stays null (= manual trigger only). */
export function scheduleFromText(text: string): RoutineSchedule | null {
  if (/\bhourly\b|\b(?:every|each)\s+hour\b/i.test(text)) return 'hourly';
  if (/\bweekly\b|\b(?:every|each)\s+week\b/i.test(text)) return 'weekly';
  if (/\bdaily\b|\b(?:every|each)\s+(?:day|morning|evening|night)\b/i.test(text)) return 'daily';
  return null;
}

// Schedule words at the tail of the task text ("…notifications every
// morning") belong to the schedule, not the routine's prompt.
const SCHEDULE_TAIL = /[,\s]*\b(?:(?:every|each)\s+(?:day|morning|evening|night|week|hour)|daily|weekly|hourly)\b[.,!?]?\s*$/i;

/** Deterministic floor under the model: name from "called/named X", task from
 * the clause after routine/that/to, schedule from the recurrence words.
 * Exported for tests. */
export function heuristicRoutineSpec(text: string): RoutineSpec {
  const named = /\b(?:called|named)\s+["'“]?([\w][\w' -]{0,48}?)["'”]?(?:\s+(?=(?:that|which|to)\b)|[.,!?]|$)/i.exec(text);
  const task =
    /\broutine\b[^.!?]*?\b(?:that|which|to)\s+(.+)/i.exec(text)?.[1] ??
    /\bremind me\b[,\s]*(?:daily|weekly|hourly)?\s*(?:(?:every|each)\s+\w+)?\s*(?:to\s+)?(.+)/i.exec(text)?.[1] ??
    text;
  const prompt = task.trim().replace(SCHEDULE_TAIL, '').replace(/[.!?]+$/, '').trim() || text.trim();
  const name = named?.[1]?.trim() || prompt.split(/\s+/).slice(0, 4).join(' ');
  return { name, prompt, schedule: scheduleFromText(text), runAtHourLocal: hourFromText(text) };
}

const SPEC_SYSTEM_PROMPT = [
  'You turn a chat request into a saved routine (a reusable agent task).',
  'Reply with ONLY a JSON object: {"name": string, "prompt": string, "schedule": "hourly"|"daily"|"weekly"|null}.',
  "- name: a short label (max 5 words); keep the user's own name for it if they gave one.",
  '- prompt: the imperative task the agent should run, without schedule words.',
  '- schedule: "daily" for every day/morning/evening, "weekly" for every week, "hourly" for every hour, null if none stated.',
].join('\n');

/** Same tolerance as memory/extract's parser: think-blocks and code fences
 * around the JSON are model noise, not failures. Exported for tests. */
export function parseRoutineSpec(raw: string, sourceText: string): RoutineSpec | null {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { name, prompt, schedule } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || typeof prompt !== 'string' || !prompt.trim()) return null;
  return {
    name: name.trim().slice(0, 60),
    prompt: prompt.trim().slice(0, 500),
    // A recurrence the text itself states wins over the model's pick — found
    // live: "every morning" came back as "hourly". The model only decides
    // when the text is silent, and then only enum values count.
    schedule:
      scheduleFromText(sourceText) ??
      (schedule === 'hourly' || schedule === 'daily' || schedule === 'weekly' ? schedule : null),
    // Time of day comes ONLY from the deterministic parse — a small model
    // hallucinating "9" for an unstated time would silently shift the cron.
    runAtHourLocal: hourFromText(sourceText),
  };
}

async function extractSpecWithModel(env: Env, text: string): Promise<RoutineSpec | null> {
  if (!env.FEATHERLESS_API_KEY) return null;
  try {
    const result = await callFeatherless(env, {
      modelId: cheapestAvailableModel(),
      maxTokens: 300,
      messages: [
        { role: 'system', content: SPEC_SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 1000) },
      ],
    });
    return parseRoutineSpec(result.content, text);
  } catch {
    return null; // a flaky catalog model never blocks creation — heuristic covers it
  }
}

function describeSchedule(schedule: RoutineSchedule | null, localHour?: number | null): string {
  if (!schedule) return 'runs on demand (no schedule)';
  if (schedule === 'daily' && localHour != null) {
    const h12 = localHour % 12 === 0 ? 12 : localHour % 12;
    return `runs daily at ${h12}:00 ${localHour < 12 ? 'AM' : 'PM'}`;
  }
  return `runs ${schedule}`;
}

/** Local wall-clock hour → UTC hour, via the client-sent minutes offset
 * (JS getTimezoneOffset convention: minutes to ADD to local to reach UTC).
 * Non-integral offsets (e.g. +330) round to the nearest hour. */
export function localHourToUtc(localHour: number, tzOffsetMinutes: number): number {
  return ((Math.round(localHour + tzOffsetMinutes / 60) % 24) + 24) % 24;
}

/** Full fast-path run: extract → create (or report the duplicate) → mirror
 * into a user memory → answer + run_end, same event/persist contract as the
 * trivial path in run.ts so the client and GET /api/run/:id behave normally. */
export async function createRoutineFromChat(
  env: Env,
  db: D1Database,
  emit: (e: TraceEvent) => void,
  body: { runId: string; userId: string; text: string; tzOffsetMinutes?: number }
): Promise<void> {
  const startedAt = Date.now();
  const spec = (await extractSpecWithModel(env, body.text)) ?? heuristicRoutineSpec(body.text);
  // A stated time only matters for daily routines; without a client tz
  // offset, assume UTC (the confirmation still shows the user's own words).
  const runAtHour =
    spec.schedule === 'daily' && spec.runAtHourLocal != null
      ? localHourToUtc(spec.runAtHourLocal, body.tzOffsetMinutes ?? 0)
      : null;

  // Name is the identity: repeating the same request must answer, not pile
  // up duplicate routines (and duplicate scheduled runs).
  const existing = (await listRoutines(db, body.userId)).find((r) => r.name.toLowerCase() === spec.name.toLowerCase());
  let answer: string;
  if (existing) {
    answer = `Routine "${existing.name}" already exists — it ${describeSchedule(existing.schedule)}. You can edit or run it in Settings.`;
  } else {
    const routine = await createRoutine(db, {
      userId: body.userId,
      name: spec.name,
      prompt: spec.prompt,
      schedule: spec.schedule,
      runAtHour,
      enabled: true,
      now: Date.now(),
    });
    // Surface in /memory so the routine is visible/editable there. Memory is
    // a bonus, never worth failing the creation — same contract as the
    // auto-write hook.
    const title = `Routine: ${routine.name}`;
    const scheduleLabel = routine.schedule ?? 'manual';
    const date = new Date(startedAt).toISOString().slice(0, 10);
    const saved = await (async () => {
      if (await getMemoryByTitle(db, body.userId, title)) return null;
      return createMemory(db, {
        userId: body.userId,
        title,
        contentMd: `Routine "${routine.name}" (${scheduleLabel}): ${routine.prompt} — created from chat on ${date}`,
        source: 'agent',
      });
    })().catch(() => null);
    if (saved) emit({ t: 'memory_saved', memoryId: saved.id, title: saved.title });
    answer = `Created routine "${routine.name}" — ${describeSchedule(routine.schedule, spec.runAtHourLocal)}. You can bind it to a bar button in Settings.`;
  }

  emit({ t: 'answer', subTaskId: 'routine-intent', text: answer });
  await saveRunAnswer(db, body.runId, answer).catch(() => undefined);
  const totalMs = Date.now() - startedAt;
  emit(buildRunEndEvent(body.runId, [], totalMs, 0));
  await finalizeRun(db, body.runId, { totalCostUsd: 0, baselineCostUsd: 0, totalMs, cacheHits: 0, planCacheHit: false });
}
