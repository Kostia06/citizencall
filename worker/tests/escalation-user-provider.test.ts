// The user's own provider as the FINAL escalation rung (execute.ts): it runs
// only after the built-in ladder's last attempt fails verify, its hop is
// labeled "<model> (your key)", and its failure keeps the built-in result
// instead of erroring the run.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { executeSubTask } from '../src/pipeline/execute';
import type { UserProvider } from '../src/providers/user-models';
import type { ModelCandidate, Policy, SubTask, TraceEvent } from '../src/types';
import { applyCoreSchema } from './support/schema';

beforeAll(async () => {
  await applyCoreSchema(env.DB);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Same two-rung roster as escalation.test.ts: with no FEATHERLESS_API_KEY the
// stub provider answers plain text, which always fails extract_fields verify
// on both rungs — exactly the state the user rung is for.
const candidates: ModelCandidate[] = [
  {
    id: 'primary-model',
    modelClass: 'test',
    contextLength: 32768,
    paramsB: 8,
    pricePerMTokIn: 0.1,
    pricePerMTokOut: 0.2,
    concurrencyCost: 1,
    availability: 'warm',
    isHotLive: true,
    toolUse: false,
    availableOnPlan: true,
  },
  {
    id: 'escalation-model',
    modelClass: 'test',
    contextLength: 32768,
    paramsB: 20,
    pricePerMTokIn: 0.5,
    pricePerMTokOut: 1,
    concurrencyCost: 1,
    availability: 'warm',
    isHotLive: true,
    toolUse: false,
    availableOnPlan: true,
  },
];

const policy: Policy = {
  version: 'test',
  generatedAt: '2026-01-01T00:00:00Z',
  weights: { quality: 1, cost: 0.35 },
  ladders: { classify: [], extract_fields: ['primary-model', 'escalation-model'], summarize: [], normalize: [] },
  quality: { 'primary-model': { extract_fields: 0.6 }, 'escalation-model': { extract_fields: 0.9 } },
  qualityCI: {},
  baselines: { frontier: 'escalation-model', cheapDefault: 'primary-model' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

const userProvider: UserProvider = {
  id: 'up-1',
  userId: 'demo_kos',
  kind: 'custom',
  baseUrl: 'https://my-model.example.com/v1',
  model: 'my-frontier',
  apiKey: 'sk-user-own-key-123456',
  enabled: true,
  createdAt: 1,
};

function makeSubTask(id: string): SubTask {
  return {
    id,
    idx: 0,
    kind: 'extract_fields',
    instruction: 'extract the fields',
    ctxNeeded: 1000,
    needsTools: false,
    dependsOn: [],
    sensitive: false,
  };
}

it('runs the user provider after both built-in rungs fail, labeled "(your key)"', async () => {
  // The user's OpenAI-compatible endpoint answers valid JSON -> verify pass.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"field":"value"}' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )) as typeof fetch;

  const events: TraceEvent[] = [];
  const result = await executeSubTask(
    { env, db: env.DB, policy, candidates, userId: 'demo_kos', emit: (e) => events.push(e), userProvider },
    makeSubTask('st-user-rung')
  );

  expect(result.hops).toHaveLength(3);
  expect(result.hops[1]!.modelId).toBe('escalation-model');
  const userHop = result.hops[2]!;
  expect(userHop.modelId).toBe('my-frontier (your key)');
  expect(userHop.escalatedFrom).toBe('escalation-model');
  expect(userHop.verdict).toBe('pass');
  expect(userHop.costUsd).toBe(0); // the user's key pays, not us
  expect(result.output).toBe('{"field":"value"}');

  const escalates = events.filter((e) => e.t === 'escalate');
  expect(escalates).toHaveLength(2);
  expect(escalates[1]).toMatchObject({ from: 'escalation-model', to: 'my-frontier (your key)' });
});

it('a failing user provider keeps the built-in result and emits a key-free error', async () => {
  globalThis.fetch = (async () =>
    new Response('upstream exploded', { status: 500 })) as typeof fetch;

  const events: TraceEvent[] = [];
  const result = await executeSubTask(
    { env, db: env.DB, policy, candidates, userId: 'demo_kos', emit: (e) => events.push(e), userProvider },
    makeSubTask('st-user-rung-fail')
  );

  expect(result.hops).toHaveLength(2); // no user hop recorded on provider failure
  expect(result.hops[1]!.modelId).toBe('escalation-model');
  const errorEvent = events.find((e) => e.t === 'error');
  expect(errorEvent).toBeDefined();
  expect((errorEvent as { message: string }).message).not.toContain('sk-user-own-key-123456');
});

it('does not touch the user provider when the built-in ladder passes', async () => {
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  // summarize: the stub's plain-text answer passes verify on the primary.
  const passingPolicy: Policy = {
    ...policy,
    ladders: { ...policy.ladders, summarize: ['primary-model', 'escalation-model'] },
    quality: { 'primary-model': { summarize: 0.8 }, 'escalation-model': { summarize: 0.9 } },
  };
  const subTask: SubTask = { ...makeSubTask('st-no-user-rung'), kind: 'summarize' };

  const events: TraceEvent[] = [];
  const result = await executeSubTask(
    { env, db: env.DB, policy: passingPolicy, candidates, userId: 'demo_kos', emit: (e) => events.push(e), userProvider },
    subTask
  );

  expect(result.hops).toHaveLength(1);
  expect(result.hops[0]!.verdict).toBe('pass');
  expect(fetched).toBe(0);
  expect(events.some((e) => e.t === 'escalate')).toBe(false);
});
