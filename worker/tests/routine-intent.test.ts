// Chat-created routines (pipeline/routine-intent.ts): intent detection is
// deterministic and conservative, schedule words map onto the schema enum,
// the heuristic extractor yields usable name/prompt pairs, and creation
// dedupes by name while mirroring into a "Routine: <name>" memory.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TraceEvent } from '../src/types';
import {
  createRoutineFromChat,
  heuristicRoutineSpec,
  hourFromText,
  isRoutineCreationIntent,
  localHourToUtc,
  parseRoutineSpec,
  scheduleFromText,
} from '../src/pipeline/routine-intent';
import { listRoutines } from '../src/routines/store';
import { getMemoryByTitle } from '../src/memory/store';
import { insertRun, getRun } from '../src/db';
import { applyCoreSchema } from './support/schema';
import { applyRoutinesSchema } from '../src/routines/schema';
import { applyMemorySchema } from '../src/memory/schema';

// Applied in beforeAll (not left to the stores' lazy ensure): isolated
// storage rolls tables back between tests while the ensure WeakSet persists,
// so a lazily-created table would vanish for the second test.
beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyRoutinesSchema(env.DB);
  await applyMemorySchema(env.DB);
});

describe('isRoutineCreationIntent', () => {
  it.each([
    'create a routine that checks my github notifications every morning',
    'make a routine called standup that summarizes my day',
    'please set up a routine to triage my inbox',
    'add a routine which lists open PRs weekly',
    'remind me daily to review PRs',
    'remind me every morning to drink water',
  ])('matches: %s', (text) => {
    expect(isRoutineCreationIntent(text)).toBe(true);
  });

  it.each([
    'what is a routine',
    'run my routine',
    'delete the standup routine',
    'remind me to buy milk', // one-off task, no recurrence
    'my morning routine is great',
    'I created a playlist. What routine should I follow at the gym?',
  ])('does NOT match: %s', (text) => {
    expect(isRoutineCreationIntent(text)).toBe(false);
  });
});

describe('scheduleFromText', () => {
  it('maps recurrence words onto the schema enum', () => {
    expect(scheduleFromText('every morning')).toBe('daily');
    expect(scheduleFromText('do it daily please')).toBe('daily');
    expect(scheduleFromText('each evening')).toBe('daily');
    expect(scheduleFromText('every week')).toBe('weekly');
    expect(scheduleFromText('weekly summary')).toBe('weekly');
    expect(scheduleFromText('every hour')).toBe('hourly');
    expect(scheduleFromText('check my inbox')).toBeNull();
  });
});

describe('heuristicRoutineSpec', () => {
  it('takes the user-given name and strips schedule words from the prompt', () => {
    const spec = heuristicRoutineSpec('create a routine called morning check that lists my github notifications every morning');
    expect(spec.name).toBe('morning check');
    expect(spec.prompt).toBe('lists my github notifications');
    expect(spec.schedule).toBe('daily');
  });

  it('derives a name from the task when none was given', () => {
    const spec = heuristicRoutineSpec('remind me daily to review PRs');
    expect(spec.prompt).toBe('review PRs');
    expect(spec.name).toBe('review PRs');
    expect(spec.schedule).toBe('daily');
  });

  it('handles the "to <task>" form with no schedule', () => {
    const spec = heuristicRoutineSpec('set up a routine to triage my inbox');
    expect(spec.prompt).toBe('triage my inbox');
    expect(spec.schedule).toBeNull();
  });
});

describe('recurring imperative tasks without the word "routine" (found live)', () => {
  it('a task with a recurrence phrase is a routine ask', () => {
    expect(isRoutineCreationIntent('check my slack messages and pr every work day at 6 am')).toBe(true);
    expect(isRoutineCreationIntent('summarize my inbox every weekday')).toBe(true);
  });
  it('questions about recurring things are NOT routine asks', () => {
    expect(isRoutineCreationIntent('what did I do every day last week')).toBe(false);
    expect(isRoutineCreationIntent('did the cron run every hour?')).toBe(false);
  });
  it('work day maps to daily and the schedule tail (with time) leaves the prompt', () => {
    const spec = heuristicRoutineSpec('check my slack messages and pr every work day at 6 am');
    expect(spec.schedule).toBe('daily');
    expect(spec.prompt).toBe('check my slack messages and pr');
    expect(spec.runAtHourLocal).toBe(6);
  });
});

describe('hourFromText / localHourToUtc', () => {
  it('parses meridiem and 24h times, ignores bare ambiguous numbers', () => {
    expect(hourFromText('say hi every morning at 6 am')).toBe(6);
    expect(hourFromText('run at 6:30pm')).toBe(18);
    expect(hourFromText('at 18:00 sharp')).toBe(18);
    expect(hourFromText('at 12 am')).toBe(0);
    expect(hourFromText('at 6')).toBeNull(); // ambiguous — no meridiem, no minutes
    expect(hourFromText('every morning')).toBeNull();
  });
  it('converts local hour to UTC via the getTimezoneOffset convention', () => {
    expect(localHourToUtc(6, 420)).toBe(13); // PDT (UTC-7): 6am local = 13:00 UTC
    expect(localHourToUtc(6, -120)).toBe(4); // UTC+2: 6am local = 04:00 UTC
    expect(localHourToUtc(23, 420)).toBe(6); // wraps past midnight
  });
  it('heuristic spec carries the stated local hour', () => {
    expect(heuristicRoutineSpec('create a routine to say hi every morning at 6 am').runAtHourLocal).toBe(6);
  });
});

describe('parseRoutineSpec', () => {
  it('parses fenced JSON and keeps a valid schedule', () => {
    const spec = parseRoutineSpec('```json\n{"name":"standup","prompt":"summarize my day","schedule":"daily"}\n```', '');
    expect(spec).toEqual({ name: 'standup', prompt: 'summarize my day', schedule: 'daily', runAtHourLocal: null });
  });

  it('falls back to the text for a hallucinated schedule value', () => {
    const spec = parseRoutineSpec('{"name":"x","prompt":"y","schedule":"fortnightly"}', 'do it every week');
    expect(spec?.schedule).toBe('weekly');
  });

  it('lets a text-stated recurrence override the model pick (found live: morning → "hourly")', () => {
    const spec = parseRoutineSpec('{"name":"x","prompt":"y","schedule":"hourly"}', 'check things every morning');
    expect(spec?.schedule).toBe('daily');
  });

  it('rejects garbage', () => {
    expect(parseRoutineSpec('not json at all', '')).toBeNull();
    expect(parseRoutineSpec('{"name":"","prompt":"y"}', '')).toBeNull();
  });
});

describe('createRoutineFromChat', () => {
  const run = async (userId: string, text: string) => {
    const runId = crypto.randomUUID();
    await insertRun(env.DB, { id: runId, userId, requestText: text, source: 'text', transcriptRaw: null, createdAt: Date.now() });
    const events: TraceEvent[] = [];
    await createRoutineFromChat(env, env.DB, (e) => events.push(e), { runId, userId, text });
    return { runId, events };
  };

  it('creates the routine, mirrors a memory, and confirms in the answer', async () => {
    const U = 'routine-intent-user-1';
    const { runId, events } = await run(U, 'create a routine called morning check that lists my github notifications every morning');

    const routines = await listRoutines(env.DB, U);
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({ name: 'morning check', schedule: 'daily', enabled: true });

    const memory = await getMemoryByTitle(env.DB, U, 'Routine: morning check');
    expect(memory?.contentMd).toContain('(daily)');
    expect(memory?.contentMd).toContain('created from chat');

    const answer = events.find((e) => e.t === 'answer');
    expect(answer && 'text' in answer && answer.text).toContain('Created routine "morning check"');
    expect(events.some((e) => e.t === 'memory_saved')).toBe(true);
    expect(events[events.length - 1]?.t).toBe('run_end');
    expect((await getRun(env.DB, runId))?.run.status).toBe('done');
  });

  it('answers "already exists" instead of duplicating on a repeat request', async () => {
    const U = 'routine-intent-user-2';
    const text = 'make a routine called standup that summarizes my day';
    await run(U, text);
    const { events } = await run(U, text);

    expect(await listRoutines(env.DB, U)).toHaveLength(1);
    const answer = events.find((e) => e.t === 'answer');
    expect(answer && 'text' in answer && answer.text).toContain('already exists');
    // The memory was written by the first request only — no duplicate row,
    // and no second memory_saved announcement.
    expect(events.some((e) => e.t === 'memory_saved')).toBe(false);
  });
});
