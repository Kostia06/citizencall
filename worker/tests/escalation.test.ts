// SPEC.md §5.4: "Escalation: exactly one rung." This is the one test that
// exercises the real D1 + stub-provider path end to end (via the workers
// pool's local D1 binding) rather than a pure function, because the
// invariant under test — never a third attempt — lives in the orchestration
// across route -> execute -> verify, not in any single pure helper.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeSubTask } from '../src/pipeline/execute';
import type { ModelCandidate, Policy, SubTask } from '../src/types';
// Vite raw import: schema.sql content is inlined at build time, so this
// works inside the workerd test runtime with no filesystem access.
// @ts-expect-error -- ?raw is a Vite loader convention, not a real module
import schemaSql from '../schema.sql?raw';

// D1Database.exec() requires exactly one statement per newline-separated
// chunk — comments and multi-line CREATE TABLE statements both violate that,
// so schema.sql (written for readability, not for exec()) needs reflowing.
function toExecStatements(sql: string): string {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((stmt) => stmt.replace(/\s+/g, ' ').trim()) // one line per statement — exec() requires it
    .filter(Boolean)
    .join(';\n');
}

beforeAll(async () => {
  await env.DB.exec(toExecStatements(schemaSql as unknown as string));
});

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

function makeSubTask(): SubTask {
  return {
    id: 'st-escalation',
    idx: 0,
    kind: 'extract_fields', // stub Featherless output is plain text, never valid JSON -> always fail_schema
    instruction: 'extract the fields',
    ctxNeeded: 1000,
    needsTools: false,
    dependsOn: [],
    sensitive: false,
  };
}

describe('executeSubTask — exactly one rung of escalation', () => {
  it('escalates once from primary to the rung-1 model when verify fails, and stops there', async () => {
    const events: Array<{ t: string }> = [];
    const result = await executeSubTask(
      {
        env,
        db: env.DB,
        policy,
        candidates,
        userId: 'demo_kos',
        emit: (e) => events.push(e),
      },
      makeSubTask()
    );

    // Stub Featherless always returns non-JSON text for extract_fields, so
    // both attempts fail verify — proving escalation stopped at rung 1
    // rather than looping until pass.
    expect(result.hops).toHaveLength(2);
    expect(result.hops[0]!.modelId).toBe('primary-model');
    expect(result.hops[0]!.verdict).not.toBe('pass');
    expect(result.hops[1]!.modelId).toBe('escalation-model');
    expect(result.hops[1]!.escalatedFrom).toBe('primary-model');

    const escalateEvents = events.filter((e) => e.t === 'escalate');
    expect(escalateEvents).toHaveLength(1); // exactly one rung — never a second escalation

    // Stream-ordering contract: the UI reducer opens the new rung and drops
    // the failed rung's streamed text on `escalate`, so it must arrive
    // before any rung-1 event (it used to fire after rung-1's hop_end,
    // garbling the live answer and rendering a ghost empty rung).
    const escalateIdx = events.findIndex((e) => e.t === 'escalate');
    const rung1RouteIdx = events.findIndex(
      (e) => e.t === 'route' && (e as unknown as { decision: { ladderPosition: number } }).decision.ladderPosition === 1
    );
    expect(rung1RouteIdx).toBeGreaterThan(-1);
    expect(escalateIdx).toBeLessThan(rung1RouteIdx);
  });

  it('does not escalate when the primary hop passes verify', async () => {
    const passingCandidates: ModelCandidate[] = [
      { ...candidates[0]!, id: 'summarizer' },
      { ...candidates[1]!, id: 'summarizer-escalation' },
    ];
    const passingPolicy: Policy = {
      ...policy,
      ladders: { ...policy.ladders, summarize: ['summarizer', 'summarizer-escalation'] },
      quality: { summarizer: { summarize: 0.8 }, 'summarizer-escalation': { summarize: 0.9 } },
    };
    const subTask: SubTask = { ...makeSubTask(), id: 'st-pass', kind: 'summarize' }; // stub output always non-empty text -> passes

    const events: Array<{ t: string }> = [];
    const result = await executeSubTask(
      { env: env as never, db: env.DB, policy: passingPolicy, candidates: passingCandidates, userId: 'demo_kos', emit: (e) => events.push(e) },
      subTask
    );

    expect(result.hops).toHaveLength(1);
    expect(result.hops[0]!.verdict).toBe('pass');
    expect(events.some((e) => e.t === 'escalate')).toBe(false);
  });
});
