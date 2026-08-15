// Connection-required pause: the DO's waitForConnection / POST /resume
// contract (run.do.ts) and the execute.ts gate that consumes it. The pause
// replaces the old hard error path when a run's sub-task needs a Composio
// toolkit the actor hasn't connected — retry resumes with the tool once the
// connection exists, skip/timeout resumes without tool data (tool_skipped
// semantics).
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { applyStoreSchema } from '../src/db';
import { executeSubTask, type ExecuteContext } from '../src/pipeline/execute';
import { putTool } from '../src/cache/tool';
import { upsertConnection } from '../src/store/connections';
import type { ModelCandidate, Policy, SubTask } from '../src/types';
import type { RunDO } from '../src/run.do';
import { applyCoreSchema } from './support/schema';

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyStoreSchema(env.DB);
});

// ---- RunDO pause/resume ----

function resumeRequest(action: unknown): Request {
  return new Request('https://run.do/resume', { method: 'POST', body: JSON.stringify({ action }) });
}

describe('RunDO — connection-required pause', () => {
  it('emits connection_required, survives a premature retry, and resumes once connected', async () => {
    const stub = env.RUN.get(env.RUN.idFromName('pause-retry'));
    await runInDurableObject(stub, async (instance: RunDO) => {
      const wait = instance.waitForConnection('pause_user_retry', 'github', 'st-1');
      const types = () => instance.snapshotEvents().map((e) => e.t);
      expect(instance.snapshotEvents().at(-1)).toMatchObject({
        t: 'connection_required',
        toolkit: 'github',
        subTaskId: 'st-1',
      });

      // Premature retry — connection still absent, the pause must survive.
      const early = await instance.fetch(resumeRequest('retry'));
      expect(await early.json()).toMatchObject({ resumed: false, waiting: true });
      expect(types()).not.toContain('run_resumed');

      await upsertConnection(env.DB, {
        userId: 'pause_user_retry',
        toolkit: 'github',
        connectedAccountId: 'acc-1',
        now: Date.now(),
      });
      const res = await instance.fetch(resumeRequest('retry'));
      expect(await res.json()).toMatchObject({ resumed: true, skipped: false });
      await expect(wait).resolves.toBe('connected');
      expect(instance.snapshotEvents().at(-1)).toMatchObject({ t: 'run_resumed', toolkit: 'github', skipped: false });
    });
  });

  it('skip resumes immediately with skipped:true', async () => {
    const stub = env.RUN.get(env.RUN.idFromName('pause-skip'));
    await runInDurableObject(stub, async (instance: RunDO) => {
      const wait = instance.waitForConnection('pause_user_skip', 'github', 'st-2');
      const res = await instance.fetch(resumeRequest('skip'));
      expect(await res.json()).toMatchObject({ resumed: true, skipped: true });
      await expect(wait).resolves.toBe('skipped');
      expect(instance.snapshotEvents().at(-1)).toMatchObject({ t: 'run_resumed', toolkit: 'github', skipped: true });
    });
  });

  it('the pause times out into a skip', async () => {
    const stub = env.RUN.get(env.RUN.idFromName('pause-timeout'));
    await runInDurableObject(stub, async (instance: RunDO) => {
      instance.connectionTimeoutMs = 20;
      const wait = instance.waitForConnection('pause_user_timeout', 'gmail', 'st-3');
      await expect(wait).resolves.toBe('skipped');
      expect(instance.snapshotEvents().at(-1)).toMatchObject({ t: 'run_resumed', toolkit: 'gmail', skipped: true });
      // A late /resume after the timeout settled finds no pause.
      const late = await instance.fetch(resumeRequest('skip'));
      expect(late.status).toBe(409);
    });
  });

  it('rejects a bad action and a resume with no pause pending', async () => {
    const stub = env.RUN.get(env.RUN.idFromName('pause-validation'));
    await runInDurableObject(stub, async (instance: RunDO) => {
      expect((await instance.fetch(resumeRequest('nonsense'))).status).toBe(400);
      expect((await instance.fetch(resumeRequest('retry'))).status).toBe(409);
    });
  });
});

// ---- execute.ts gate ----

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

// COMPOSIO_API_KEY set = live mode, which is what arms the connection gate.
const liveEnv = { ...(env as unknown as Env), COMPOSIO_API_KEY: 'test-key' } as Env;

function ctx(userId: string, extra: Partial<ExecuteContext>): { c: ExecuteContext; events: Emitted[] } {
  const events: Emitted[] = [];
  const c: ExecuteContext = {
    env: liveEnv,
    db: env.DB,
    policy,
    candidates,
    userId,
    emit: (e) => events.push(e as unknown as Emitted),
    ...extra,
  };
  return { c, events };
}

describe('execute gate — waitForConnection', () => {
  it('a skipped resolution proceeds like tool_skipped (no error, model answers without tool data)', async () => {
    const calls: Array<[string, string]> = [];
    const st = subTask('github', 'list_commits');
    const { c, events } = ctx('pause_exec_skip', {
      waitForConnection: async (toolkit, subTaskId) => {
        calls.push([toolkit, subTaskId]);
        return 'skipped';
      },
    });
    const result = await executeSubTask(c, st);

    expect(calls).toEqual([['github', st.id]]);
    expect(events.find((e) => e.t === 'tool_skipped')).toMatchObject({ toolkit: 'github', tool: 'list_commits' });
    expect(events.some((e) => e.t === 'error')).toBe(false);
    expect(result.hops[0]!.verdict).toBe('pass');
    expect(result.toolDerived).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('a connected resolution re-reads the connection and runs the tool', async () => {
    const userId = 'pause_exec_conn';
    const st = subTask('github', 'list_commits');
    // Pre-seed the L2 tool cache so the connected path exercises the gate
    // without firing a live Composio HTTP call from the test runner.
    await putTool(
      env.DB,
      { userId, toolkit: 'github', tool: 'list_commits', args: {} },
      { ok: true, output: { commits: ['abc123 fix things'] } }
    );
    const { c, events } = ctx(userId, {
      waitForConnection: async () => {
        // Simulates the user completing OAuth while the run is paused.
        await upsertConnection(env.DB, { userId, toolkit: 'github', connectedAccountId: 'acc-2', now: Date.now() });
        return 'connected';
      },
    });
    const result = await executeSubTask(c, st);

    expect(events.some((e) => e.t === 'tool_call')).toBe(true);
    expect(events.some((e) => e.t === 'error')).toBe(false);
    expect(events.some((e) => e.t === 'tool_skipped')).toBe(false);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolDerived).toBe(true);
    expect(result.hops[0]!.verdict).toBe('pass');
  });

  it('without a callback the legacy error path is unchanged', async () => {
    const st = subTask('github', 'list_commits');
    const { c, events } = ctx('pause_exec_legacy', {});
    const result = await executeSubTask(c, st);

    const error = events.find((e) => e.t === 'error');
    expect(String(error!.message)).toContain('github connection');
    expect(result.hops[0]!.verdict).toBe('fail_tool');
  });
});
