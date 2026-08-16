// Multi-turn threading through runPipeline: history changes the run-cache
// key (same text + same history still hits), the CONVERSATION block rides
// the SYSTEM message of sub-task calls (captured via a mocked Featherless
// endpoint — the "stubbed model"), the planner sees only the one-line
// disambiguator, and the trivial-prompt fast path never calls the planner.
import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyStoreSchema } from '../src/db';
import { applyRunCacheSchema } from '../src/cache/schema';
import { applyMemorySchema } from '../src/memory/schema';
import { runPipeline, type RunRequest } from '../src/pipeline/run';
import type { ConversationTurn } from '../src/pipeline/conversation';
import type { ModelCandidate, Policy, TraceEvent } from '../src/types';
import { applyCoreSchema } from './support/schema';

interface CapturedCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

/** Every Featherless call any test makes, in order. ONE persistent
 * interceptor for the whole file — undici routes all matching requests to
 * the first registered persistent interceptor, so per-test interceptors
 * would silently capture into the wrong array. Cleared in beforeEach. */
const captured: CapturedCall[] = [];

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyStoreSchema(env.DB);
  await applyRunCacheSchema(env.DB);
  await applyMemorySchema(env.DB); // silence the loud "no memory tables" degradation
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get('https://api.featherless.ai')
    .intercept({ method: 'POST', path: '/v1/chat/completions' })
    .reply(200, (opts: { body?: unknown }) => {
      const raw = typeof opts.body === 'string' ? opts.body : new TextDecoder().decode(opts.body as ArrayBuffer);
      captured.push(JSON.parse(raw) as CapturedCall);
      return JSON.stringify({
        choices: [{ message: { content: 'A concise, helpful reply.' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8 },
      });
    })
    .persist();
});

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  delete (env as { FEATHERLESS_API_KEY?: string }).FEATHERLESS_API_KEY;
});

/** The live callFeatherless path — the one that actually sends `messages`
 * to the (mocked) endpoint — only runs with a key set; reset in afterEach. */
function enableLiveModelPath(): void {
  (env as { FEATHERLESS_API_KEY?: string }).FEATHERLESS_API_KEY = 'test-key';
}

const candidates: ModelCandidate[] = [
  {
    id: 'small-summarizer',
    modelClass: 'test',
    contextLength: 32768,
    paramsB: 4,
    pricePerMTokIn: 0.05,
    pricePerMTokOut: 0.1,
    concurrencyCost: 1,
    availability: 'warm',
    isHotLive: true,
    toolUse: true,
    availableOnPlan: true,
  },
  {
    id: 'big-generalist',
    modelClass: 'test',
    contextLength: 262144,
    paramsB: 100,
    pricePerMTokIn: 0.6,
    pricePerMTokOut: 2.2,
    concurrencyCost: 4,
    availability: 'warm',
    isHotLive: true,
    toolUse: true,
    availableOnPlan: true,
  },
];

const policy: Policy = {
  version: 'v-test',
  generatedAt: '2026-01-01T00:00:00Z',
  weights: { quality: 1, cost: 0.35 },
  ladders: {
    classify: ['small-summarizer', 'big-generalist'],
    extract_fields: ['small-summarizer', 'big-generalist'],
    summarize: ['small-summarizer', 'big-generalist'],
    normalize: ['small-summarizer', 'big-generalist'],
  },
  quality: {
    'small-summarizer': { summarize: 0.9, extract_fields: 0.6, classify: 0.9, normalize: 0.9 },
    'big-generalist': { summarize: 0.95, extract_fields: 0.9, classify: 0.95, normalize: 0.95 },
  },
  qualityCI: {},
  baselines: { frontier: 'big-generalist', cheapDefault: 'small-summarizer' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

type AnyEvent = TraceEvent & { t: string };

async function run(userId: string, text: string, history?: ConversationTurn[]): Promise<{ runId: string; events: AnyEvent[] }> {
  const runId = crypto.randomUUID();
  const events: AnyEvent[] = [];
  const body: RunRequest = { runId, userId, text, source: 'text', ...(history ? { history } : {}) };
  await runPipeline(env, (e) => events.push(e as AnyEvent), body, { policy, candidates });
  return { runId, events };
}

const kinds = (events: AnyEvent[]) => events.map((e) => e.t);

const TEAL_HISTORY: ConversationTurn[] = [
  { role: 'user', text: 'my favorite color is teal' },
  { role: 'assistant', text: 'Noted — teal it is.' },
];

describe('runPipeline — history keys the run cache', () => {
  it('same text: no-history seed does NOT serve a with-history run; identical history hits', async () => {
    const text = 'summarize the color preferences discussion';
    const first = await run('demo_kos', text);
    expect(kinds(first.events)).toContain('run_end');

    // Different userContext (conversation block) → different cache key.
    const withHistory = await run('demo_kos', text, TEAL_HISTORY);
    expect(kinds(withHistory.events)).not.toContain('cache_hit');

    // Same text + same history → same key → cache hit.
    const again = await run('demo_kos', text, TEAL_HISTORY);
    expect(kinds(again.events)).toContain('cache_hit');

    // And the no-history variant still hits its own original entry.
    const bare = await run('demo_kos', text);
    expect(kinds(bare.events)).toContain('cache_hit');
  });
});

describe('runPipeline — conversation block reaches the model', () => {
  it('rides the SYSTEM message of sub-task calls, never the user text or the plan', async () => {
    enableLiveModelPath();
    const { events } = await run('demo_kos', 'summarize what we know about my preferences', TEAL_HISTORY);

    expect(captured.length).toBeGreaterThan(0);
    const systems = captured.flatMap((c) => c.messages.filter((m) => m.role === 'system').map((m) => m.content));
    const users = captured.flatMap((c) => c.messages.filter((m) => m.role === 'user').map((m) => m.content));

    // The block reached at least one model call, in the system channel…
    expect(
      systems.some((s) => s.includes('Conversation so far') && s.includes('User: my favorite color is teal'))
    ).toBe(true);
    // …and never leaked into the user text (the "prepended to user text" bug
    // was already made and fixed once — see run.ts loadUserContextSafe note).
    expect(users.every((u) => !u.includes('my favorite color is teal'))).toBe(true);

    // The plan is built from the user's actual request only.
    const plan = events.find((e) => e.t === 'plan') as Extract<TraceEvent, { t: 'plan' }>;
    for (const st of plan.plan.subTasks) {
      expect(st.instruction).not.toContain('my favorite color is teal');
    }
  });

  it('planner gets ONLY the one-line last-user-turn hint, in its system prompt', async () => {
    enableLiveModelPath();
    // ≥140 chars and tool-word-free → not a trivial prompt, so the model
    // planner runs (its JSON parse fails on the mock reply and falls back to
    // the heuristic — the captured request is what we assert on).
    const longText =
      'please put together a short overview of everything we have discussed so far about my preferences and habits, ' +
      'organized as a few bullet points I could paste somewhere';
    await run('demo_kos', longText, TEAL_HISTORY);

    const plannerCalls = captured.filter((c) => c.messages.some((m) => m.role === 'system' && m.content.includes('task planner')));
    expect(plannerCalls.length).toBeGreaterThan(0);
    for (const call of plannerCalls) {
      const system = call.messages.find((m) => m.role === 'system')!.content;
      expect(system).toContain('For disambiguation only');
      expect(system).toContain('my favorite color is teal');
      // The plan text itself is untouched by history.
      const user = call.messages.find((m) => m.role === 'user')!.content;
      expect(user).not.toContain('my favorite color is teal');
    }
  });

  it('trivial fast path: "say hi" with history skips the planner but still carries the block', async () => {
    enableLiveModelPath();
    const { events } = await run('demo_kos', 'say hi', TEAL_HISTORY);

    expect(kinds(events)).toContain('run_end');
    // No planner model call — the heuristic planned it.
    expect(captured.some((c) => c.messages.some((m) => m.content.includes('task planner')))).toBe(false);
    // Plan text unchanged by history.
    const plan = events.find((e) => e.t === 'plan') as Extract<TraceEvent, { t: 'plan' }>;
    expect(plan.plan.subTasks[0]!.instruction).toContain('say hi');
    expect(plan.plan.subTasks[0]!.instruction).not.toContain('teal');
    // The execute-stage system message still carries the conversation.
    const systems = captured.flatMap((c) => c.messages.filter((m) => m.role === 'system').map((m) => m.content));
    expect(systems.some((s) => s.includes('Conversation so far'))).toBe(true);
  });
});
