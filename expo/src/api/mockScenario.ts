// Ported from ui/src/mock/scenario.ts, text-only (the Expo command screen
// is typed input — no Web Speech API equivalent on native, SPEC.md §7.3
// notes voice is browser-only anyway). Same scripted run: plan -> route ->
// hops with one escalation -> run_end with savings, so the app is fully
// demoable with zero backend.
import type { RunAttachment, SubTask, TraceEvent } from '../types/contract';

export interface ScenarioStep {
  event: TraceEvent;
  delay: number;
}

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

export function buildScenario(opts: {
  runId: string;
  userId: string;
  text: string;
  attachments?: RunAttachment[];
}): ScenarioStep[] {
  const { runId, userId, text, attachments } = opts;
  const steps: ScenarioStep[] = [];

  steps.push({
    event: {
      t: 'run_start',
      runId,
      userId,
      text,
      source: 'text',
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    },
    delay: 0,
  });

  steps.push({
    event: { t: 'plan', plan: { subTasks: [subTaskSummarize, subTaskExtract] }, cacheHit: false, ms: 46 },
    delay: 420,
  });

  steps.push({
    event: {
      t: 'route',
      decision: {
        subTaskId: 'st_0',
        modelId: 'Qwen/Qwen3-8B',
        score: 0.91,
        reasons: [
          'accuracy 0.88 on summarize (n=12 held-out, Wilson [0.55,0.95])',
          '$0.0006 vs cheap-default $0.0021 — 3.5x cheaper',
          'warm - no cold-start penalty',
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
  steps.push({ event: { t: 'tool_call', toolkit: 'github', tool: 'list_commits', cacheHit: false, ms: 214 }, delay: 240 });
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

  steps.push({
    event: {
      t: 'route',
      decision: {
        subTaskId: 'st_1',
        modelId: 'Qwen/Qwen3-14B',
        score: 0.85,
        reasons: [
          'accuracy 0.91 on extract_fields (n=12 held-out, Wilson [0.62,0.98])',
          '$0.0004 vs cheap-default $0.0021 — 5.2x cheaper',
          'warm - no cold-start penalty',
        ],
        ladderPosition: 0,
        candidatesConsidered: 8,
      },
    },
    delay: 320,
  });
  steps.push({ event: { t: 'hop_start', hop: { id: 'hop_1', subTaskId: 'st_1', modelId: 'Qwen/Qwen3-14B', paramsB: 14 } }, delay: 160 });
  steps.push({ event: { t: 'tool_call', toolkit: 'gmail', tool: 'create_draft', cacheHit: false, ms: 178 }, delay: 220 });
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
  steps.push({ event: { t: 'escalate', from: 'Qwen/Qwen3-14B', to: 'zai-org/GLM-5.2', reason: 'fail_schema' }, delay: 280 });
  steps.push({
    event: {
      t: 'route',
      decision: {
        subTaskId: 'st_1',
        modelId: 'zai-org/GLM-5.2',
        score: 0.99,
        reasons: [
          'escalation rung 1 of 1 - schema failure on primary',
          'accuracy 0.95 on extract_fields (n=12 held-out)',
          'frontier fallback, ladder ceiling',
        ],
        ladderPosition: 1,
        candidatesConsidered: 8,
      },
    },
    delay: 320,
  });
  steps.push({ event: { t: 'hop_start', hop: { id: 'hop_2', subTaskId: 'st_1', modelId: 'zai-org/GLM-5.2', paramsB: 355 } }, delay: 160 });
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
