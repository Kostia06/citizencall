// Cache keeper (src/warmup.ts): selection logic — expiring/missing plan rows
// get picked under the per-sweep mint cap, unsupported auth configs are
// negative-cached in D1 so they aren't retried every sweep — and the curated
// prompt list only contains prompts the model planner would actually serve
// (warming the trivial/bypass paths buys nothing).
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CURATED_PROMPTS,
  EXPIRY_WINDOW_MS,
  MAX_PLAN_MINTS_PER_SWEEP,
  TOP_TOOLKITS,
  readAuthWarmStates,
  resetWarmupStateForTests,
  runWarmupSweep,
  selectAuthWarmups,
  selectPlanWarmups,
  warmAuthConfigs,
  type AuthWarmState,
} from '../src/warmup';
import { PLAN_CACHE_TTL_MS } from '../src/cache/planSemantic';
import { wouldUsePlannerModel } from '../src/pipeline/decompose';
import { isCapabilityIntent } from '../src/pipeline/capability-intent';
import { isRoutineCreationIntent } from '../src/pipeline/routine-intent';
import { AuthConfigUnavailableError } from '../src/providers/composio-auth-configs';

const NOW = 1_700_000_000_000;
const FRESH = NOW - 60_000; // minted a minute ago
const EXPIRING = NOW - (PLAN_CACHE_TTL_MS - EXPIRY_WINDOW_MS / 2); // dies within the window

beforeEach(() => resetWarmupStateForTests());

describe('curated prompt list', () => {
  it('stays within the 50-70 entry budget', () => {
    expect(CURATED_PROMPTS.length).toBeGreaterThanOrEqual(50);
    expect(CURATED_PROMPTS.length).toBeLessThanOrEqual(70);
  });

  it('every prompt reaches the model planner (tool signal, named toolkit, or long-form)', () => {
    // Short prompts naming a catalog toolkit reach the planner via the
    // detectMentionedToolkits vocabulary at runtime; the rest must be
    // planner-bound even with an empty vocab.
    const mentionable = /\b(discord|slack|notion|linear|jira|trello|reddit|twitter|google calendar|google drive)\b/i;
    for (const prompt of CURATED_PROMPTS) {
      const reaches = wouldUsePlannerModel(prompt, []) || mentionable.test(prompt);
      expect(reaches, `trivial prompt would never be planner-warmed: "${prompt}"`).toBe(true);
    }
  });

  it('never warms the deterministic bypass paths (capability/routine intents)', () => {
    for (const prompt of CURATED_PROMPTS) {
      expect(isCapabilityIntent(prompt), `capability bypass: "${prompt}"`).toBe(false);
      expect(isRoutineCreationIntent(prompt), `routine bypass: "${prompt}"`).toBe(false);
    }
  });
});

describe('selectPlanWarmups', () => {
  it('picks missing keys and rows expiring within the window, skips fresh rows', () => {
    const rows = new Map<string, number>([
      ['fresh', FRESH],
      ['expiring', EXPIRING],
    ]);
    expect(selectPlanWarmups(['fresh', 'expiring', 'missing'], rows, NOW)).toEqual(['missing', 'expiring']);
  });

  it('caps at MAX_PLAN_MINTS_PER_SWEEP, most-stale first', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const picked = selectPlanWarmups(keys, new Map(), NOW);
    expect(picked).toHaveLength(MAX_PLAN_MINTS_PER_SWEEP);
  });

  it('orders older rows before newer expiring rows so the cap starves nothing', () => {
    const rows = new Map<string, number>([
      ['newer', EXPIRING],
      ['older', EXPIRING - 60_000],
    ]);
    expect(selectPlanWarmups(['newer', 'older'], rows, NOW, 1)).toEqual(['older']);
  });
});

describe('selectAuthWarmups', () => {
  const states = (entries: Array<[string, AuthWarmState]>) => new Map(entries);

  it('picks unknown toolkits and skips freshly-verified ones', () => {
    const s = states([['github', { status: 'ok', updatedAt: NOW - 60_000 }]]);
    expect(selectAuthWarmups(['github', 'slack'], s, NOW)).toEqual(['slack']);
  });

  it('skips a fresh unsupported negative but rechecks it after a week', () => {
    const fresh = states([['zoom', { status: 'unsupported', updatedAt: NOW - 24 * 3_600_000 }]]);
    expect(selectAuthWarmups(['zoom'], fresh, NOW)).toEqual([]);
    const stale = states([['zoom', { status: 'unsupported', updatedAt: NOW - 8 * 24 * 3_600_000 }]]);
    expect(selectAuthWarmups(['zoom'], stale, NOW)).toEqual(['zoom']);
  });

  it('rechecks an ok state after a day (config may have been deleted)', () => {
    const s = states([['github', { status: 'ok', updatedAt: NOW - 25 * 3_600_000 }]]);
    expect(selectAuthWarmups(['github'], s, NOW)).toEqual(['github']);
  });
});

describe('warmAuthConfigs (D1 negative cache)', () => {
  const deadline = () => Date.now() + 30_000;

  it('records ok and does not re-resolve on the next sweep', async () => {
    let calls = 0;
    const resolve = async () => {
      calls += 1;
      return 'ac_1';
    };
    const first = await warmAuthConfigs(env.DB, ['warmtest_ok'], resolve, NOW, deadline());
    expect(first.warmed).toBe(1);
    expect(calls).toBe(1);

    const second = await warmAuthConfigs(env.DB, ['warmtest_ok'], resolve, NOW + 60_000, deadline());
    expect(second.warmed).toBe(0);
    expect(calls).toBe(1); // served from the D1 state row, not re-resolved
  });

  it('negative-caches a deterministic 4xx rejection and stops retrying it', async () => {
    let calls = 0;
    const resolve = async (toolkit: string) => {
      calls += 1;
      throw new AuthConfigUnavailableError(
        toolkit,
        'Composio POST /api/v3/auth_configs -> 400: toolkit does not support composio managed auth'
      );
    };
    const first = await warmAuthConfigs(env.DB, ['warmtest_unsupported'], resolve, NOW, deadline());
    expect(first.unsupported).toBe(1);
    expect(calls).toBe(1);

    const states = await readAuthWarmStates(env.DB);
    expect(states.get('warmtest_unsupported')?.status).toBe('unsupported');

    const second = await warmAuthConfigs(env.DB, ['warmtest_unsupported'], resolve, NOW + 60_000, deadline());
    expect(second.unsupported).toBe(0);
    expect(calls).toBe(1); // remembered — not retried every sweep
  });

  it('treats a 5xx as transient: no negative row, retried next sweep', async () => {
    let calls = 0;
    const resolve = async (toolkit: string) => {
      calls += 1;
      throw new AuthConfigUnavailableError(toolkit, 'Composio GET /api/v3/auth_configs -> 503: upstream');
    };
    await warmAuthConfigs(env.DB, ['warmtest_transient'], resolve, NOW, deadline());
    expect((await readAuthWarmStates(env.DB)).has('warmtest_transient')).toBe(false);

    await warmAuthConfigs(env.DB, ['warmtest_transient'], resolve, NOW + 60_000, deadline());
    expect(calls).toBe(2);
  });
});

describe('runWarmupSweep guards', () => {
  it('is a safe no-op without API keys (never throws, skips every step)', async () => {
    // Test env has neither FEATHERLESS_API_KEY nor COMPOSIO_API_KEY.
    const summary = await runWarmupSweep(env, NOW);
    expect(summary.plansMinted).toBe(0);
    expect(summary.toolsRefreshed).toBe(0);
    expect(summary.authWarmed).toBe(0);
    expect(summary.skipped).toEqual(['plans (no FEATHERLESS_API_KEY)', 'composio (no COMPOSIO_API_KEY)']);
  });

  it('exposes the judge-facing toolkit list the sweep keeps warm', () => {
    for (const toolkit of ['github', 'gmail', 'slack', 'notion', 'linear']) {
      expect(TOP_TOOLKITS).toContain(toolkit);
    }
  });
});
