// L3 semantic near-match tier (cache/planSemantic.ts + cache/planSimilarity.ts).
// The exact-match fast path must stay intact, every hit (exact or semantic)
// must mint fresh sub-task ids (sub_tasks.id is a global PK — regression that
// was fixed before), and the toolkit safety gate must refuse cross-domain
// borrows: a wrong plan is worse than a slow plan.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyCoreSchema } from './support/schema';
import { normalizePlanKey } from '../src/cache/plan';
import {
  applyPlanSemanticSchema,
  assertPlanIsGlobal,
  findNearPlan,
  PLAN_CACHE_TTL_MS,
  PLAN_SCAN_LIMIT,
  putPlanIndexed,
} from '../src/cache/planSemantic';
import { contentTokens, isNearMatch, planSimilarity, toolkitGateAllows } from '../src/cache/planSimilarity';
import { decompose } from '../src/pipeline/decompose';
import type { Env } from '../src/env';
import type { Plan, Policy } from '../src/types';

// No FEATHERLESS_API_KEY in vitest and an empty frontier baseline → the model
// planner is skipped and misses fall to the deterministic heuristic.
const policy = { baselines: { frontier: '', cheapDefault: '' } } as Policy;
const testEnv = env as unknown as Env;

function subTask(id: string, idx: number, instruction: string, toolkit?: string): Plan['subTasks'][number] {
  return {
    id,
    idx,
    kind: 'summarize',
    instruction,
    ctxNeeded: 512,
    needsTools: Boolean(toolkit),
    ...(toolkit ? { toolCall: { toolkit, tool: toolkit === 'github' ? 'list_commits' : 'fetch_emails', args: {} } } : {}),
    dependsOn: [],
    sensitive: false,
  };
}

function githubPlan(): Plan {
  const a = subTask('seed-a', 0, 'Summarize this week of repo commits', 'github');
  const b = subTask('seed-b', 1, 'Extract action items as JSON');
  b.kind = 'extract_fields';
  b.dependsOn = [a.id];
  return { subTasks: [a, b] };
}

const gmailPlan = (): Plan => ({ subTasks: [subTask('seed-g', 0, 'Summarize the unread inbox emails', 'gmail')] });
const noToolPlan = (): Plan => ({ subTasks: [subTask('seed-n', 0, 'Summarize the provided text')] });

const key = normalizePlanKey;
const sim = (a: string, b: string) => planSimilarity(contentTokens(key(a)), contentTokens(key(b)));

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyPlanSemanticSchema(env.DB);
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM plan_cache').run();
});

describe('similarity thresholds (tuned fixtures)', () => {
  it('accepts the canonical paraphrase pair', () => {
    const s = sim("Summarize this week's repo changes.", 'Give me a summary of the repository changes from this week');
    expect(s.jaccard).toBeGreaterThanOrEqual(0.82);
    expect(isNearMatch(s)).toBe(true);
  });

  it('accepts a word-order and morphology variant', () => {
    expect(isNearMatch(sim('What changed in the repo this week?', 'Tell me what changed in the repository this week'))).toBe(true);
  });

  it('rejects topical impostors that share a verb', () => {
    expect(isNearMatch(sim('summarize my recent emails', 'summarize my recent expenses'))).toBe(false);
    expect(isNearMatch(sim('summarize this weeks repo changes', 'summarize this weeks emails'))).toBe(false);
    expect(isNearMatch(sim('classify my inbox messages', 'classify the repo issues'))).toBe(false);
  });

  it('does not treat a different time scope as the same request', () => {
    // "week" is deliberately NOT a stopword — the cached instructions embed the window.
    expect(isNearMatch(sim('summarize todays repo changes', 'summarize this weeks repo changes'))).toBe(false);
  });
});

describe('toolkit safety gate', () => {
  const gate = (prompt: string, plan: Plan) => {
    const k = key(prompt);
    return toolkitGateAllows(k, contentTokens(k), plan);
  };

  it('an email-ish prompt never inherits a github plan, and vice versa', () => {
    expect(gate('summarize my unread emails', githubPlan())).toBe(false);
    expect(gate('summarize this weeks repo commits', gmailPlan())).toBe(false);
  });

  it('accepts when the prompt implies exactly the toolkits the plan uses', () => {
    expect(gate('summarize this weeks repo commits', githubPlan())).toBe(true);
    expect(gate('summarize my unread inbox', gmailPlan())).toBe(true);
    expect(gate('summarize the meeting notes', noToolPlan())).toBe(true);
  });

  it('a tool-implying prompt does not inherit a no-tool plan (symmetric doubt → miss)', () => {
    expect(gate('summarize this weeks repo commits', noToolPlan())).toBe(false);
  });

  it('an unknown MCP toolkit requires its name verbatim in the prompt', () => {
    const plan: Plan = { subTasks: [subTask('m', 0, 'Fetch the pages', 'notion')] };
    expect(gate('summarize my notion pages', plan)).toBe(true);
    expect(gate('summarize my recent pages', plan)).toBe(false);
  });
});

describe('decompose with the semantic tier', () => {
  const seedPrompt = "Summarize this week's repo changes.";
  const paraphrase = 'Give me a summary of the repository changes from this week.';

  it('exact hit still works and mints fresh sub-task ids', async () => {
    const stored = githubPlan();
    await putPlanIndexed(env.DB, key(seedPrompt), stored);
    const res = await decompose(testEnv, env.DB, policy, seedPrompt);
    expect(res.cacheHit).toBe(true);
    expect(res.cacheKind).toBe('exact');
    expect(res.plan.subTasks.map((s) => s.instruction)).toEqual(stored.subTasks.map((s) => s.instruction));
    const storedIds = new Set(stored.subTasks.map((s) => s.id));
    for (const s of res.plan.subTasks) expect(storedIds.has(s.id)).toBe(false);
    // dependsOn remapped onto the fresh ids
    expect(res.plan.subTasks[1]!.dependsOn).toEqual([res.plan.subTasks[0]!.id]);
  });

  it('a paraphrase gets the cached plan as a semantic hit with fresh ids', async () => {
    const stored = githubPlan();
    await putPlanIndexed(env.DB, key(seedPrompt), stored);
    const res = await decompose(testEnv, env.DB, policy, paraphrase);
    expect(res.cacheHit).toBe(true);
    expect(res.cacheKind).toBe('semantic');
    expect(res.plan.subTasks.map((s) => s.instruction)).toEqual(stored.subTasks.map((s) => s.instruction));
    const storedIds = new Set(stored.subTasks.map((s) => s.id));
    for (const s of res.plan.subTasks) expect(storedIds.has(s.id)).toBe(false);
  });

  it('promotes a semantic hit to an exact row with borrowed_from provenance', async () => {
    await putPlanIndexed(env.DB, key(seedPrompt), githubPlan());
    await decompose(testEnv, env.DB, policy, paraphrase);
    const row = await env.DB.prepare('SELECT borrowed_from FROM plan_cache WHERE normalized = ?')
      .bind(key(paraphrase))
      .first<{ borrowed_from: string | null }>();
    expect(row?.borrowed_from).toBe(key(seedPrompt));
    // …and the next identical prompt takes the exact fast path.
    const again = await decompose(testEnv, env.DB, policy, paraphrase);
    expect(again.cacheKind).toBe('exact');
  });

  it('re-keying holds across repeated hits: no sub-task id is ever reused', async () => {
    await putPlanIndexed(env.DB, key(seedPrompt), githubPlan());
    const runs = [
      await decompose(testEnv, env.DB, policy, seedPrompt),
      await decompose(testEnv, env.DB, policy, paraphrase),
      await decompose(testEnv, env.DB, policy, seedPrompt),
    ];
    const ids = runs.flatMap((r) => r.plan.subTasks.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length); // would collide as sub_tasks PKs otherwise
  });

  it('the toolkit gate blocks a high-similarity borrow into a different domain', async () => {
    // Near-identical keys ({recent, updates}) but the stored plan needs github,
    // which nothing in the new prompt implies → must MISS, not borrow.
    await putPlanIndexed(env.DB, key('show me my recent updates'), githubPlan());
    const res = await decompose(testEnv, env.DB, policy, 'show my recent updates');
    expect(res.cacheHit).toBe(false);
  });

  it('an email prompt misses against a stored github plan', async () => {
    await putPlanIndexed(env.DB, key(seedPrompt), githubPlan());
    const res = await decompose(testEnv, env.DB, policy, 'Summarize this weeks emails.');
    expect(res.cacheHit).toBe(false);
  });

  it('below-threshold prompts miss and fall through to planning', async () => {
    await putPlanIndexed(env.DB, key('summarize repo commits'), githubPlan());
    const res = await decompose(testEnv, env.DB, policy, 'summarize my emails');
    expect(res.cacheHit).toBe(false);
    expect(res.plan.subTasks.length).toBeGreaterThan(0); // heuristic fallback plan
  });
});

describe('findNearPlan bounds and hygiene', () => {
  it('never near-matches on a single content token', async () => {
    await putPlanIndexed(env.DB, key('summarize this'), noToolPlan());
    expect(await findNearPlan(env.DB, key('summarize that'))).toBeNull();
  });

  it('respects the recency scan bound', async () => {
    const now = Date.now();
    const plan = JSON.stringify(noToolPlan());
    const insert = env.DB.prepare(
      'INSERT INTO plan_cache (normalized, plan_json, tokens, created_at, hits) VALUES (?, ?, ?, ?, 0)'
    );
    // A perfect near-match, but older than PLAN_SCAN_LIMIT fresher (dissimilar) rows.
    const similarKey = key('summarize the quarterly planning notes');
    const stmts = [insert.bind(similarKey, plan, contentTokens(similarKey).join(' '), now - 60_000)];
    for (let i = 0; i < PLAN_SCAN_LIMIT; i++) {
      const k = `unrelated filler task ${i} alpha beta gamma`;
      stmts.push(insert.bind(k, plan, contentTokens(k).join(' '), now));
    }
    await env.DB.batch(stmts);
    expect(await findNearPlan(env.DB, key('summarize the quarterly planning notes please'))).toBeNull();
  });

  it('ignores rows past the 7d TTL', async () => {
    const similarKey = key('summarize the quarterly planning notes');
    await env.DB.prepare('INSERT INTO plan_cache (normalized, plan_json, tokens, created_at, hits) VALUES (?, ?, ?, ?, 0)')
      .bind(similarKey, JSON.stringify(noToolPlan()), contentTokens(similarKey).join(' '), Date.now() - PLAN_CACHE_TTL_MS - 1000)
      .run();
    expect(await findNearPlan(env.DB, key('summarize the quarterly planning notes please'))).toBeNull();
  });

  it('writes prune expired rows best-effort', async () => {
    await env.DB.prepare('INSERT INTO plan_cache (normalized, plan_json, created_at, hits) VALUES (?, ?, ?, 0)')
      .bind('ancient row', '{"subTasks":[]}', Date.now() - PLAN_CACHE_TTL_MS - 1000)
      .run();
    await putPlanIndexed(env.DB, key('summarize the fresh notes'), noToolPlan());
    const gone = await env.DB.prepare('SELECT 1 AS one FROM plan_cache WHERE normalized = ?').bind('ancient row').first();
    expect(gone).toBeNull();
  });

  it('legacy rows without tokens still match (inline tokenization fallback)', async () => {
    const similarKey = key('summarize this weeks repo changes');
    await env.DB.prepare('INSERT INTO plan_cache (normalized, plan_json, created_at, hits) VALUES (?, ?, ?, 0)')
      .bind(similarKey, JSON.stringify(githubPlan()), Date.now())
      .run();
    const hit = await findNearPlan(env.DB, key('give me a summary of the repository changes from this week'));
    expect(hit?.matchedKey).toBe(similarKey);
  });
});

describe('global-cache invariant (SPEC.md §8)', () => {
  it('refuses to store a plan carrying user-scoped fields', async () => {
    const smuggled = { subTasks: [{ ...subTask('x', 0, 'Summarize'), userId: 'demo_kos' }] } as unknown as Plan;
    expect(() => assertPlanIsGlobal(smuggled)).toThrow(/global/);
    await expect(putPlanIndexed(env.DB, key('some prompt here'), smuggled)).rejects.toThrow(/global/);
  });

  it('accepts a normal plan — plans are pure task structure', () => {
    expect(() => assertPlanIsGlobal(githubPlan())).not.toThrow();
  });
});
