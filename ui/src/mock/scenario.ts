import type { SubTask, TraceEvent } from '../types';

export interface ScenarioStep {
  event: TraceEvent;
  delay: number; // ms to wait after the previous step before firing this one
}

const RAW_TRANSCRIPT =
  'uh so can you like tell me what changed in the repo this week and uh maybe write the PR thing';
const NORMALIZED_TEXT = "Summarize this week's repository changes and draft a PR description.";

const subTaskSummarize: SubTask = {
  id: 'st_0',
  idx: 0,
  kind: 'summarize',
  instruction: "Summarize this week's repository changes",
  ctxNeeded: 4096,
  needsTools: true,
  toolCall: { toolkit: 'github', tool: 'list_commits', args: { repo: 'understudy/agent', since: '7d' } },
  dependsOn: [],
  sensitive: false,
};

const subTaskExtract: SubTask = {
  id: 'st_1',
  idx: 1,
  kind: 'extract_fields',
  instruction: 'Draft a PR description from the commit summary',
  ctxNeeded: 2048,
  needsTools: true,
  toolCall: { toolkit: 'gmail', tool: 'create_draft', args: { to: 'team@understudy.dev' } },
  dependsOn: ['st_0'],
  sensitive: false,
};

/** Builds the full scripted TraceEvent sequence for the mock demo run.
 * SPEC.md requires this to demo a complete run — normalize (voice only) →
 * plan → route → hops with one escalation → run_end with savings — with
 * zero backend. See SPEC.md §15 for the shot this drives. */
export function buildScenario(opts: {
  runId: string;
  userId: string;
  text: string;
  source: 'text' | 'voice';
}): ScenarioStep[] {
  const { runId, userId, text, source } = opts;
  const steps: ScenarioStep[] = [];

  steps.push({
    event: { t: 'run_start', runId, userId, text: source === 'voice' ? RAW_TRANSCRIPT : text, source },
    delay: 0,
  });

  if (source === 'voice') {
    const words = RAW_TRANSCRIPT.split(' ');
    const chunk1 = words.slice(0, 6).join(' ');
    const chunk2 = words.slice(0, 13).join(' ');
    const chunk3 = words.join(' ');
    steps.push({ event: { t: 'transcript', raw: chunk1, final: false }, delay: 320 });
    steps.push({ event: { t: 'transcript', raw: chunk2, final: false }, delay: 360 });
    steps.push({ event: { t: 'transcript', raw: chunk3, final: false }, delay: 420 });
    steps.push({ event: { t: 'transcript', raw: chunk3, final: true }, delay: 280 });
    steps.push({
      event: {
        t: 'normalized',
        from: RAW_TRANSCRIPT,
        to: NORMALIZED_TEXT,
        ms: 180,
        modelId: 'Qwen/Qwen3-0.6B',
      },
      delay: 260,
    });
  }

  steps.push({
    event: { t: 'plan', plan: { subTasks: [subTaskSummarize, subTaskExtract] }, cacheHit: false, ms: 46 },
    delay: source === 'voice' ? 380 : 420,
  });

  // --- sub-task 0: summarize, single rung, passes ---
  steps.push({
    event: {
      t: 'route',
      decision: {
        subTaskId: 'st_0',
        modelId: 'Qwen/Qwen3-8B',
        score: 0.91,
        reasons: [
          'accuracy 0.88 on summarize (n=12 held-out, Wilson [0.55,0.95])',
          '$0.0006 vs cheap-default $0.0021 — 3.5× cheaper',
          'warm · no cold-start penalty',
        ],
        ladderPosition: 0,
        candidatesConsidered: 8,
      },
    },
    delay: 320,
  });
  steps.push({
    event: { t: 'hop_start', hop: { id: 'hop_0', subTaskId: 'st_0', modelId: 'Qwen/Qwen3-8B', paramsB: 8 } },
    delay: 160,
  });
  steps.push({
    event: { t: 'tool_call', toolkit: 'github', tool: 'list_commits', cacheHit: false, ms: 214 },
    delay: 240,
  });
  steps.push({
    event: {
      t: 'hop_end',
      hop: {
        id: 'hop_0',
        subTaskId: 'st_0',
        modelId: 'Qwen/Qwen3-8B',
        modelClass: 'qwen3',
        paramsB: 8,
        promptTokens: 1180,
        completionTokens: 210,
        costUsd: 0.00061,
        latencyMs: 640,
        availability: 'warm',
        verdict: 'pass',
        cacheHit: 'none',
      },
    },
    delay: 460,
  });

  // --- sub-task 1: extract_fields, fails schema on primary, escalates ---
  steps.push({
    event: {
      t: 'route',
      decision: {
        subTaskId: 'st_1',
        modelId: 'Qwen/Qwen3-14B',
        score: 0.85,
        reasons: [
          'accuracy 0.91 on extract_fields (n=12 held-out, Wilson [0.62,0.98])',
          '$0.0004 vs cheap-default $0.0021 — 5.2× cheaper',
          'warm · no cold-start penalty',
        ],
        ladderPosition: 0,
        candidatesConsidered: 8,
      },
    },
    delay: 320,
  });
  steps.push({
    event: {
      t: 'hop_start',
      hop: { id: 'hop_1', subTaskId: 'st_1', modelId: 'Qwen/Qwen3-14B', paramsB: 14 },
    },
    delay: 160,
  });
  steps.push({
    event: { t: 'tool_call', toolkit: 'gmail', tool: 'create_draft', cacheHit: false, ms: 178 },
    delay: 220,
  });
  steps.push({
    event: {
      t: 'hop_end',
      hop: {
        id: 'hop_1',
        subTaskId: 'st_1',
        modelId: 'Qwen/Qwen3-14B',
        modelClass: 'qwen3',
        paramsB: 14,
        promptTokens: 860,
        completionTokens: 0,
        costUsd: 0.00034,
        latencyMs: 410,
        availability: 'warm',
        verdict: 'fail_schema',
        cacheHit: 'none',
      },
    },
    delay: 400,
  });
  steps.push({
    event: { t: 'escalate', from: 'Qwen/Qwen3-14B', to: 'zai-org/GLM-5.2', reason: 'fail_schema' },
    delay: 280,
  });
  steps.push({
    event: {
      t: 'route',
      decision: {
        subTaskId: 'st_1',
        modelId: 'zai-org/GLM-5.2',
        score: 0.99,
        reasons: [
          'escalation rung 1 of 1 — schema failure on primary',
          'accuracy 0.95 on extract_fields (n=12 held-out)',
          'frontier fallback, ladder ceiling',
        ],
        ladderPosition: 1,
        candidatesConsidered: 8,
      },
    },
    delay: 320,
  });
  steps.push({
    event: {
      t: 'hop_start',
      hop: { id: 'hop_2', subTaskId: 'st_1', modelId: 'zai-org/GLM-5.2', paramsB: 355 },
    },
    delay: 160,
  });
  steps.push({
    event: {
      t: 'hop_end',
      hop: {
        id: 'hop_2',
        subTaskId: 'st_1',
        modelId: 'zai-org/GLM-5.2',
        modelClass: 'glm',
        paramsB: 355,
        promptTokens: 860,
        completionTokens: 240,
        costUsd: 0.0071,
        latencyMs: 980,
        availability: 'warm',
        verdict: 'pass',
        escalatedFrom: 'hop_1',
        cacheHit: 'none',
      },
    },
    delay: 760,
  });

  const totalCostUsd = 0.00061 + 0.00034 + 0.0071;
  const baselineCostUsd = 0.0412;
  steps.push({
    event: {
      t: 'run_end',
      runId,
      totalCostUsd,
      totalMs: 2540,
      baselineCostUsd,
      savingsPct: (1 - totalCostUsd / baselineCostUsd) * 100,
    },
    delay: 420,
  });

  return steps;
}
