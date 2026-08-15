// runTool gating inside executeSubTask (pipeline/execute.ts): per-user tool
// enablement (per-tool rows + the '*' wildcard convention), unknown/MCP
// toolkits, the live-mode connection gate, and the §8 scoping rule that
// tool-derived model output never lands in the global L1 cache.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { applyStoreSchema } from '../src/db';
import { executeSubTask, type ExecuteContext } from '../src/pipeline/execute';
import { setToolOverride } from '../src/store/tools';
import type { ModelCandidate, Policy, SubTask } from '../src/types';
import { applyCoreSchema } from './support/schema';

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyStoreSchema(env.DB);
});

const candidates: ModelCandidate[] = [
  {
    id: 'tool-capable',
    modelClass: 'test',
    contextLength: 32768,
    paramsB: 8,
    pricePerMTokIn: 0.1,
    pricePerMTokOut: 0.2,
    concurrencyCost: 1,
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
  ladders: { classify: [], extract_fields: [], summarize: ['tool-capable'], normalize: [] },
  quality: { 'tool-capable': { summarize: 0.9 } },
  qualityCI: {},
  baselines: { frontier: 'tool-capable', cheapDefault: 'tool-capable' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

function subTask(toolkit: string, tool: string): SubTask {
  return {
    id: crypto.randomUUID(),
    idx: 0,
    kind: 'summarize', // stub output is non-empty text -> passes verify
    instruction: 'summarize this week of activity',
    ctxNeeded: 1000,
    needsTools: true,
    toolCall: { toolkit, tool, args: {} },
    dependsOn: [],
    sensitive: false,
  };
}

interface Emitted {
  t: string;
  [k: string]: unknown;
}

function ctx(userId: string, extra: Partial<ExecuteContext> = {}): { c: ExecuteContext; events: Emitted[] } {
  const events: Emitted[] = [];
  const c: ExecuteContext = {
    env,
    db: env.DB,
    policy,
    candidates,
    userId,
    emit: (e) => events.push(e as unknown as Emitted),
    ...extra,
  };
  return { c, events };
}

describe('runTool — enablement gating', () => {
  it('runs an enabled tool, feeds its output to the model, and skips the global L1 cache', async () => {
    const { c, events } = ctx('demo_kos');
    const result = await executeSubTask(c, subTask('github', 'list_commits'));

    expect(events.some((e) => e.t === 'tool_call')).toBe(true);
    expect(events.some((e) => e.t === 'tool_skipped')).toBe(false);
    expect(result.toolCalls).toHaveLength(1);
    // The stub model echoes its user message — the tool output block made it
    // into the prompt, and the result is flagged tool-derived.
    expect(result.output).toContain('Output of tool github.list_commits');
    expect(result.toolDerived).toBe(true);
    expect(result.hops[0]!.cacheHit).toBe('none');
    // §8 scoping rule: nothing tool-derived in the global exact tier.
    const l1 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cache_entries WHERE tier = 'exact'`).first<{ n: number }>();
    expect(l1!.n).toBe(0);
  });

  it('skips a tool the user disabled (per-tool row) with a tool_skipped event', async () => {
    await setToolOverride(env.DB, { userId: 'demo_kos', toolkit: 'github', tool: 'list_commits', enabled: false });
    const { c, events } = ctx('demo_kos');
    const result = await executeSubTask(c, subTask('github', 'list_commits'));

    const skipped = events.find((e) => e.t === 'tool_skipped');
    expect(skipped).toMatchObject({ toolkit: 'github', tool: 'list_commits', reason: 'disabled by user' });
    expect(events.some((e) => e.t === 'tool_call')).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    // A skipped tool is not a tool failure — the model still answers.
    expect(result.hops[0]!.verdict).toBe('pass');
    expect(result.toolDerived).toBe(false);
  });

  it("honors a disabled '*' wildcard row for the whole toolkit", async () => {
    await setToolOverride(env.DB, { userId: 'demo_kos', toolkit: 'github', tool: '*', enabled: false });
    const { c, events } = ctx('demo_kos');
    await executeSubTask(c, subTask('github', 'list_commits'));
    expect(events.some((e) => e.t === 'tool_skipped')).toBe(true);
  });

  it("lets an enabled per-tool row take precedence over a disabled '*' row", async () => {
    await setToolOverride(env.DB, { userId: 'demo_kos', toolkit: 'github', tool: '*', enabled: false });
    await setToolOverride(env.DB, { userId: 'demo_kos', toolkit: 'github', tool: 'list_commits', enabled: true });
    const { c, events } = ctx('demo_kos');
    await executeSubTask(c, subTask('github', 'list_commits'));
    expect(events.some((e) => e.t === 'tool_call')).toBe(true);
    expect(events.some((e) => e.t === 'tool_skipped')).toBe(false);
  });

  it('tool overrides are per-user: one user disabling github does not affect another', async () => {
    await setToolOverride(env.DB, { userId: 'demo_kos', toolkit: 'github', tool: 'list_commits', enabled: false });
    const { c, events } = ctx('demo_teammate');
    await executeSubTask(c, subTask('github', 'list_commits'));
    expect(events.some((e) => e.t === 'tool_call')).toBe(true);
  });
});

describe('runTool — toolkit availability', () => {
  it('skips a toolkit the user does not have (e.g. a plan minted for another user’s MCP)', async () => {
    const { c, events } = ctx('demo_kos');
    await executeSubTask(c, subTask('someone-elses-mcp', 'call'));
    const skipped = events.find((e) => e.t === 'tool_skipped');
    expect(skipped).toMatchObject({ toolkit: 'someone-elses-mcp', reason: 'toolkit not available for this user' });
  });

  it('skips an MCP toolkit cleanly while the transport is unimplemented', async () => {
    const { c, events } = ctx('demo_kos', { mcpToolkits: new Set(['my-notes']) });
    await executeSubTask(c, subTask('my-notes', 'call'));
    const skipped = events.find((e) => e.t === 'tool_skipped');
    expect(skipped).toMatchObject({ toolkit: 'my-notes', reason: 'mcp transport not implemented' });
  });
});

describe('runTool — connection gate (live mode)', () => {
  it('surfaces a missing/revoked connection as a clear trace error and does not escalate', async () => {
    const liveEnv = { ...(env as unknown as Env), COMPOSIO_API_KEY: 'test-key' };
    const { events } = ctx('demo_kos');
    const c: ExecuteContext = {
      env: liveEnv,
      db: env.DB,
      policy,
      candidates,
      userId: 'demo_kos',
      emit: (e) => events.push(e as unknown as Emitted),
    };
    const result = await executeSubTask(c, subTask('github', 'list_commits'));

    const error = events.find((e) => e.t === 'error');
    expect(error).toBeDefined();
    expect(String(error!.message)).toContain('github connection');
    expect(result.hops).toHaveLength(1); // no pointless escalation
    expect(result.hops[0]!.verdict).toBe('fail_tool');
  });
});
