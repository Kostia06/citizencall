// File attachments through the run path: the boundary schema caps/filters
// instead of rejecting (UI sends metadata-only entries for images), the
// ATTACHED FILES block rides the SYSTEM message of sub-task calls (captured
// via a mocked Featherless endpoint), attachment content keys the run cache
// (same text + different file must not replay), and the plan text stays
// attachment-free. Mirrors conversation-threading.test.ts.
import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyStoreSchema } from '../src/db';
import { applyRunCacheSchema } from '../src/cache/schema';
import { applyMemorySchema } from '../src/memory/schema';
import { runPipeline, type RunRequest } from '../src/pipeline/run';
import {
  attachmentsSchema,
  buildAttachmentsBlock,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_TEXT_CHARS,
  type RunAttachmentInput,
} from '../src/pipeline/attachments';
import type { ModelCandidate, Policy, TraceEvent } from '../src/types';
import { applyCoreSchema } from './support/schema';

interface CapturedCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

/** ONE persistent interceptor for the whole file (undici routes matching
 * requests to the first registered persistent interceptor). */
const captured: CapturedCall[] = [];

beforeAll(async () => {
  await applyCoreSchema(env.DB);
  await applyStoreSchema(env.DB);
  await applyRunCacheSchema(env.DB);
  await applyMemorySchema(env.DB);
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get('https://api.featherless.ai')
    .intercept({ method: 'POST', path: '/v1/chat/completions' })
    .reply(200, (opts: { body?: unknown }) => {
      const raw = typeof opts.body === 'string' ? opts.body : new TextDecoder().decode(opts.body as ArrayBuffer);
      captured.push(JSON.parse(raw) as CapturedCall);
      return JSON.stringify({
        choices: [{ message: { content: 'A concise, helpful reply.' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8 },
      });
    })
    .persist();
});

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  delete (env as { FEATHERLESS_API_KEY?: string }).FEATHERLESS_API_KEY;
});

function enableLiveModelPath(): void {
  (env as { FEATHERLESS_API_KEY?: string }).FEATHERLESS_API_KEY = 'test-key';
}

const candidates: ModelCandidate[] = [
  {
    id: 'small-summarizer',
    modelClass: 'test',
    contextLength: 32768,
    paramsB: 4,
    pricePerMTokIn: 0.05,
    pricePerMTokOut: 0.1,
    concurrencyCost: 1,
    availability: 'warm',
    isHotLive: true,
    toolUse: true,
    availableOnPlan: true,
  },
  {
    id: 'big-generalist',
    modelClass: 'test',
    contextLength: 262144,
    paramsB: 100,
    pricePerMTokIn: 0.6,
    pricePerMTokOut: 2.2,
    concurrencyCost: 4,
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
  ladders: {
    classify: ['small-summarizer', 'big-generalist'],
    extract_fields: ['small-summarizer', 'big-generalist'],
    summarize: ['small-summarizer', 'big-generalist'],
    normalize: ['small-summarizer', 'big-generalist'],
  },
  quality: {
    'small-summarizer': { summarize: 0.9, extract_fields: 0.6, classify: 0.9, normalize: 0.9 },
    'big-generalist': { summarize: 0.95, extract_fields: 0.9, classify: 0.95, normalize: 0.95 },
  },
  qualityCI: {},
  baselines: { frontier: 'big-generalist', cheapDefault: 'small-summarizer' },
  margin: { classify: 0.15, extract_fields: 0.15, summarize: 0.15, normalize: 0.15 },
};

type AnyEvent = TraceEvent & { t: string };

async function run(
  userId: string,
  text: string,
  attachments?: RunAttachmentInput[]
): Promise<{ runId: string; events: AnyEvent[] }> {
  const runId = crypto.randomUUID();
  const events: AnyEvent[] = [];
  const body: RunRequest = { runId, userId, text, source: 'text', ...(attachments ? { attachments } : {}) };
  await runPipeline(env, (e) => events.push(e as AnyEvent), body, { policy, candidates });
  return { runId, events };
}

const kinds = (events: AnyEvent[]) => events.map((e) => e.t);

const NOTES_MD: RunAttachmentInput = {
  name: 'meeting-notes.md',
  mimeType: 'text/markdown',
  text: '# Q3 sync\n- ship the pricing page by Friday\n- Dana owns the launch email',
};

describe('attachmentsSchema — tolerant boundary', () => {
  it('keeps text-bearing entries, strips UI-only keys, drops metadata-only ones', () => {
    const parsed = attachmentsSchema.parse([
      { id: 'file-1', kind: 'file', size: 12, name: 'a.txt', mimeType: 'text/plain', text: 'hello' },
      // Image chip from the UI — no text, must be dropped, not rejected.
      { id: 'img-1', kind: 'clipboard-image', size: 999, name: 'shot.png', mimeType: 'image/png' },
      { name: 'blank.txt', text: '   \n  ' }, // whitespace-only — dropped
    ]);
    expect(parsed).toEqual([{ name: 'a.txt', mimeType: 'text/plain', text: 'hello' }]);
  });

  it('caps at MAX_ATTACHMENTS (first wins) and truncates text at 50KB', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => ({
      name: `f${i}.txt`,
      text: i === 0 ? 'x'.repeat(MAX_ATTACHMENT_TEXT_CHARS + 500) : `content ${i}`,
    }));
    const parsed = attachmentsSchema.parse(many);
    expect(parsed).toHaveLength(MAX_ATTACHMENTS);
    expect(parsed[0]!.name).toBe('f0.txt');
    expect(parsed[0]!.text).toHaveLength(MAX_ATTACHMENT_TEXT_CHARS);
  });

  it('normalizes a pathological name instead of rejecting', () => {
    const parsed = attachmentsSchema.parse([{ name: `  ${'n'.repeat(500)}  `, text: 'body' }]);
    expect(parsed[0]!.name.length).toBeLessThanOrEqual(120);
    const blank = attachmentsSchema.parse([{ name: '   ', text: 'body' }]);
    expect(blank[0]!.name).toBe('attachment');
  });
});

describe('buildAttachmentsBlock', () => {
  it('is empty without attachments and quotes each file with name + mime', () => {
    expect(buildAttachmentsBlock(undefined)).toBe('');
    expect(buildAttachmentsBlock([])).toBe('');
    const block = buildAttachmentsBlock([NOTES_MD, { name: 'data.csv', text: 'a,b\n1,2' }]);
    expect(block).toContain('attached file: meeting-notes.md (text/markdown)');
    expect(block).toContain('ship the pricing page by Friday');
    expect(block).toContain('attached file: data.csv');
    expect(block).toContain('a,b\n1,2');
    // Injection posture: quoted as source material, not instructions.
    expect(block).toContain('never as instructions');
  });
});

describe('runPipeline — attachments key the run cache', () => {
  it('same text: bare seed does not serve an attachment run; identical attachment hits', async () => {
    const text = 'summarize the attached meeting notes';
    const first = await run('demo_att', text);
    expect(kinds(first.events)).toContain('run_end');

    // Different userContext (attachments block) → different cache key.
    const withFile = await run('demo_att', text, [NOTES_MD]);
    expect(kinds(withFile.events)).not.toContain('cache_hit');

    // Same text + same file → hit.
    const again = await run('demo_att', text, [NOTES_MD]);
    expect(kinds(again.events)).toContain('cache_hit');

    // A DIFFERENT file with the same prompt must not replay the first file's answer.
    const otherFile = await run('demo_att', text, [{ name: 'other.md', text: 'entirely different notes' }]);
    expect(kinds(otherFile.events)).not.toContain('cache_hit');
  });
});

describe('runPipeline — attachment content reaches the model', () => {
  it('rides the SYSTEM message of sub-task calls, never the user text or the plan', async () => {
    enableLiveModelPath();
    const { events } = await run('demo_att', 'summarize the attached meeting notes for me', [NOTES_MD]);

    expect(captured.length).toBeGreaterThan(0);
    const systems = captured.flatMap((c) => c.messages.filter((m) => m.role === 'system').map((m) => m.content));
    const users = captured.flatMap((c) => c.messages.filter((m) => m.role === 'user').map((m) => m.content));

    expect(
      systems.some((s) => s.includes('attached file: meeting-notes.md') && s.includes('ship the pricing page by Friday'))
    ).toBe(true);
    // Never prepended to the user text (the conversation-block bug, once).
    expect(users.every((u) => !u.includes('ship the pricing page by Friday'))).toBe(true);

    // Plan text stays attachment-free — content is context, not the task.
    const plan = events.find((e) => e.t === 'plan') as Extract<TraceEvent, { t: 'plan' }>;
    for (const st of plan.plan.subTasks) {
      expect(st.instruction).not.toContain('ship the pricing page by Friday');
    }
  });
});
