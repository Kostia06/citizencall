// Regression guard for the smart loop: the shipped policy.json ladders must
// resolve against the shipped runtime catalog. v1-live promoted long-tail
// models that the catalog didn't carry, so routeSubTask threw
// NoEligibleModelError at rung 0 and EVERY kind silently ran on the rung-1
// frontier — the cheap-specialist demo never happened. These tests pin the
// boot-loaded policy + roster together so that drift fails CI instead.
import { describe, expect, it } from 'vitest';
import { candidates, policy } from '../src/policy';
import { routeSubTask } from '../src/pipeline/route';
import type { SubTask, TaskKind } from '../src/types';

const kinds = Object.keys(policy.ladders) as TaskKind[];
const byId = new Map(candidates.map((c) => [c.id, c]));

function makeSubTask(kind: TaskKind): SubTask {
  return {
    id: `st-${kind}`,
    idx: 0,
    kind,
    instruction: 'probe',
    ctxNeeded: 2000,
    needsTools: false,
    dependsOn: [],
    sensitive: false,
  };
}

describe('shipped policy.json resolves against the shipped runtime catalog', () => {
  it('covers all four task kinds with a two-rung ladder', () => {
    expect(kinds.sort()).toEqual(['classify', 'extract_fields', 'normalize', 'summarize']);
    for (const kind of kinds) expect(policy.ladders[kind]).toHaveLength(2);
  });

  it('every ladder model id exists in the runtime candidate roster', () => {
    for (const kind of kinds) {
      for (const id of policy.ladders[kind]) {
        expect(byId.has(id), `${kind} ladder references ${id}, missing from catalog_sample.json`).toBe(true);
      }
    }
  });

  it('every ladder model is warm and available on plan (rung 0 must actually serve)', () => {
    for (const kind of kinds) {
      for (const id of policy.ladders[kind]) {
        const m = byId.get(id)!;
        expect(m.availability, `${id} availability`).toBe('warm');
        expect(m.availableOnPlan, `${id} availableOnPlan`).toBe(true);
      }
    }
  });

  it('rung 0 is meaningfully cheaper than rung 1 for every kind (no own-goal ladders)', () => {
    for (const kind of kinds) {
      const [cheapId, frontierId] = policy.ladders[kind];
      const cheap = byId.get(cheapId!)!;
      const frontier = byId.get(frontierId!)!;
      const cheapPrice = cheap.pricePerMTokIn + cheap.pricePerMTokOut;
      const frontierPrice = frontier.pricePerMTokIn + frontier.pricePerMTokOut;
      // "meaningfully": at least 5x — the demo's whole pitch is the cost gap.
      expect(frontierPrice / cheapPrice, `${kind}: rung1 ${frontierId} vs rung0 ${cheapId}`).toBeGreaterThan(5);
    }
  });

  it('routes rung 0 to the cheap specialist and rung 1 to the frontier for every kind', () => {
    for (const kind of kinds) {
      const rung0 = routeSubTask(policy, candidates, makeSubTask(kind), 0);
      expect(rung0.modelId).toBe(policy.ladders[kind][0]);
      expect(rung0.modelId).not.toBe(policy.baselines.frontier);

      const rung1 = routeSubTask(policy, candidates, makeSubTask(kind), 1);
      expect(rung1.modelId).toBe(policy.baselines.frontier);
    }
  });

  it('stage-0 voice normalize model (ladders.normalize[0]) is a resolvable non-frontier model', () => {
    const id = policy.ladders.normalize[0]!;
    expect(byId.has(id)).toBe(true);
    expect(id).not.toBe(policy.baselines.frontier);
  });
});

// v3-live-widened: policy.json carries per-kind `alternates` — live-probed
// servable models at other size/price points. route.ts only ever routes the
// 2-rung ladders (it slices ladder[0]/[1]), so alternates are display/manual-
// promotion material — but they must still resolve and be genuinely servable,
// or the roster page would advertise models that 403/404 at runtime.
describe('policy.json alternates resolve against the runtime catalog', () => {
  const alternates = (policy as unknown as { alternates?: Record<string, string[]> }).alternates ?? {};

  it('every kind has at least one alternate', () => {
    for (const kind of kinds) {
      expect(alternates[kind]?.length ?? 0, `${kind} alternates`).toBeGreaterThan(0);
    }
  });

  it('every alternate exists in the catalog, is warm, on-plan, and cheaper than the frontier', () => {
    const frontier = byId.get(policy.baselines.frontier)!;
    const frontierPrice = frontier.pricePerMTokIn + frontier.pricePerMTokOut;
    for (const kind of kinds) {
      for (const id of alternates[kind] ?? []) {
        const m = byId.get(id);
        expect(m, `${kind} alternate ${id} missing from catalog_sample.json`).toBeDefined();
        expect(m!.availability, `${id} availability`).toBe('warm');
        expect(m!.availableOnPlan, `${id} availableOnPlan`).toBe(true);
        expect(
          m!.pricePerMTokIn + m!.pricePerMTokOut,
          `${id} should undercut the frontier`
        ).toBeLessThan(frontierPrice);
      }
    }
  });

  it('alternates never duplicate the ladder they back up', () => {
    for (const kind of kinds) {
      for (const id of alternates[kind] ?? []) {
        expect(policy.ladders[kind]).not.toContain(id);
      }
    }
  });

  it('models the live probe rejected are marked off-plan (gated 403 / delisted)', () => {
    for (const id of ['google/gemma-2-9b-it', 'meta-llama/Llama-3.1-8B-Instruct', 'deepseek-ai/DeepSeek-V3-Lite']) {
      const m = byId.get(id);
      if (m) expect(m.availableOnPlan, `${id} must not claim servability`).toBe(false);
    }
  });
});
