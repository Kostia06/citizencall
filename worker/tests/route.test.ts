// SPEC.md §5.2: eligible(m,t) predicate, and score(m,t) = w_q·quality − w_c·normCost
// with weights read from policy.weights — never hardcoded in route.ts.
import { describe, expect, it } from 'vitest';
import { eligible, NoEligibleModelError, routeSubTask, score } from '../src/pipeline/route';
import type { ModelCandidate, Policy, SubTask } from '../src/types';

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: 'st1',
    idx: 0,
    kind: 'summarize',
    instruction: 'summarize this',
    ctxNeeded: 2000,
    needsTools: false,
    dependsOn: [],
    sensitive: false,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    id: 'model-a',
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
    ...overrides,
  };
}

const policy: Policy = {
  version: 'test',
  generatedAt: '2026-01-01T00:00:00Z',
  weights: { quality: 1.0, cost: 0.35 },
  ladders: { classify: [], extract_fields: [], summarize: ['model-a', 'model-b'], normalize: [] },
  quality: { 'model-a': { summarize: 0.8 }, 'model-b': { summarize: 0.95 } },
  qualityCI: {},
  baselines: { frontier: 'model-b', cheapDefault: 'model-a' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

describe('eligible()', () => {
  it('rejects insufficient context length', () => {
    const m = makeCandidate({ contextLength: 1000 });
    expect(eligible(m, makeSubTask({ ctxNeeded: 2000 }))).toBe(false);
  });

  it('rejects cold/offline availability', () => {
    expect(eligible(makeCandidate({ availability: 'cold' }), makeSubTask())).toBe(false);
    expect(eligible(makeCandidate({ availability: 'offline' }), makeSubTask())).toBe(false);
  });

  it('accepts warm and loading availability', () => {
    expect(eligible(makeCandidate({ availability: 'warm' }), makeSubTask())).toBe(true);
    expect(eligible(makeCandidate({ availability: 'loading' }), makeSubTask())).toBe(true);
  });

  it('rejects models unavailable on plan', () => {
    expect(eligible(makeCandidate({ availableOnPlan: false }), makeSubTask())).toBe(false);
  });

  it('rejects a tool-incapable model for a tool-needing sub-task', () => {
    const m = makeCandidate({ toolUse: false });
    expect(eligible(m, makeSubTask({ needsTools: true }))).toBe(false);
    expect(eligible(makeCandidate({ toolUse: true }), makeSubTask({ needsTools: true }))).toBe(true);
  });
});

describe('score() — weights come from policy, not hardcoded', () => {
  it('changes ranking when policy.weights.cost changes, with the same candidates', () => {
    const t = makeSubTask({ kind: 'summarize' });
    const cheap = makeCandidate({ id: 'model-a', pricePerMTokIn: 0.01, pricePerMTokOut: 0.01 });
    const pricier = makeCandidate({ id: 'model-b', pricePerMTokIn: 5, pricePerMTokOut: 5 });
    const pool = [cheap, pricier];

    const qualityOnly: Policy = { ...policy, weights: { quality: 1, cost: 0 } };
    const costHeavy: Policy = { ...policy, weights: { quality: 1, cost: 10 } };

    // model-b has higher quality (0.95 vs 0.8) — quality-only weighting favors it.
    expect(score(qualityOnly, pricier, t, pool)).toBeGreaterThan(score(qualityOnly, cheap, t, pool));
    // Cranking cost weight up flips the ranking toward the cheap model.
    expect(score(costHeavy, cheap, t, pool)).toBeGreaterThan(score(costHeavy, pricier, t, pool));
  });
});

describe('routeSubTask()', () => {
  it('picks a rung-0 candidate and reports reasons for humans', () => {
    const candidates = [makeCandidate({ id: 'model-a' }), makeCandidate({ id: 'model-b', pricePerMTokIn: 5, pricePerMTokOut: 5 })];
    const decision = routeSubTask(policy, candidates, makeSubTask(), 0);
    expect(decision.modelId).toBe('model-a');
    expect(decision.ladderPosition).toBe(0);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('throws when no candidate at the requested rung is eligible', () => {
    const candidates = [makeCandidate({ id: 'model-a', availability: 'cold' })];
    expect(() => routeSubTask(policy, candidates, makeSubTask(), 0)).toThrow(NoEligibleModelError);
  });
});
