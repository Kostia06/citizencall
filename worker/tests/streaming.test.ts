// Streaming provider variant (providers/featherless.ts): SSE frame
// reassembly across arbitrary chunk splits, [DONE]/usage handling, the same
// cold/backpressure/capacity error taxonomy as the non-stream call, the
// delta coalescer's ~10 events/sec throttle, and the stub-mode contract
// (exactly one synthetic delta).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import {
  callFeatherless,
  callFeatherlessStream,
  createDeltaCoalescer,
  createSseParser,
  FeatherlessBackpressureError,
  FeatherlessCapacityError,
  FeatherlessColdError,
  FeatherlessPlanError,
} from '../src/providers/featherless';

const stubEnv = {} as Env; // no FEATHERLESS_API_KEY → stub mode
const liveEnv = { FEATHERLESS_API_KEY: 'test-key' } as Env;

const req = {
  modelId: 'test-model',
  messages: [{ role: 'user' as const, content: 'write two sentences about red pandas' }],
  maxTokens: 256,
};

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function sseResponse(bodyText: string): Response {
  return new Response(bodyText, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSseParser', () => {
  it('reassembles a frame split across pushes', () => {
    const seen: unknown[] = [];
    const parser = createSseParser((d) => seen.push(d));
    const frame = sseChunk('hello');
    parser.push(frame.slice(0, 12));
    expect(seen).toHaveLength(0); // no complete line yet
    parser.push(frame.slice(12));
    expect(seen).toEqual([{ choices: [{ delta: { content: 'hello' } }] }]);
  });

  it('handles multiple frames in one push, CRLF line endings and [DONE]', () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push((d as any).choices[0].delta.content));
    parser.push(`data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\r\n\r\n${sseChunk('b')}data: [DONE]\n\n`);
    expect(seen).toEqual(['a', 'b']);
  });

  it('ignores blank lines, comments and malformed JSON without dying', () => {
    const seen: unknown[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.push(': keepalive\n\ndata: {not json}\n');
    parser.push(sseChunk('ok'));
    expect(seen).toEqual([{ choices: [{ delta: { content: 'ok' } }] }]);
  });
});

describe('createDeltaCoalescer', () => {
  it('flushes the first push immediately, then coalesces within the interval', () => {
    let t = 1_000;
    const flushed: string[] = [];
    const c = createDeltaCoalescer((text) => flushed.push(text), 100, () => t);
    c.push('a'); // 1000 - 0 >= 100 → immediate flush (fast first paint)
    t += 10;
    c.push('b');
    t += 10;
    c.push('c'); // still within 100ms → buffered
    expect(flushed).toEqual(['a']);
    t += 100;
    c.push('d'); // crosses the interval → coalesced flush
    expect(flushed).toEqual(['a', 'bcd']);
    c.end(); // nothing buffered → no extra flush
    expect(flushed).toEqual(['a', 'bcd']);
  });

  it('end() flushes the buffered tail', () => {
    let t = 1_000;
    const flushed: string[] = [];
    const c = createDeltaCoalescer((text) => flushed.push(text), 100, () => t);
    c.push('a');
    c.push('tail'); // same tick → buffered
    c.end();
    expect(flushed).toEqual(['a', 'tail']);
  });
});

describe('callFeatherlessStream — stub mode', () => {
  it('emits exactly one synthetic delta and matches callFeatherless', async () => {
    const deltas: string[] = [];
    const streamed = await callFeatherlessStream(stubEnv, req, (d) => deltas.push(d));
    const whole = await callFeatherless(stubEnv, req);
    expect(deltas).toEqual([whole.content]);
    expect(streamed).toEqual(whole);
  });
});

describe('callFeatherlessStream — live SSE', () => {
  it('streams deltas, accumulates the full content and reads the usage chunk', async () => {
    const usageFrame = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`;
    const body = sseChunk('Red ') + sseChunk('pandas ') + sseChunk('are great.') + usageFrame + 'data: [DONE]\n\n';
    const fetchMock = vi.fn(async () => sseResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const result = await callFeatherlessStream(liveEnv, req, (d) => deltas.push(d));

    expect(deltas).toEqual(['Red ', 'pandas ', 'are great.']);
    expect(result.content).toBe('Red pandas are great.');
    expect(result.promptTokens).toBe(11);
    expect(result.completionTokens).toBe(7);
    const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body as string);
    expect(sent.stream).toBe(true);
    expect(sent.stream_options).toEqual({ include_usage: true });
  });

  it('estimates tokens from text when no usage chunk arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(sseChunk('abcdefgh') + 'data: [DONE]\n\n')));
    const result = await callFeatherlessStream(liveEnv, req, () => undefined);
    expect(result.content).toBe('abcdefgh');
    expect(result.completionTokens).toBe(2); // ceil(8 / 4)
    expect(result.promptTokens).toBe(Math.ceil(req.messages[0]!.content.length / 4));
  });

  it('maps 400/403/429 to the same error classes as the non-stream call', async () => {
    for (const [status, cls] of [
      [400, FeatherlessColdError],
      [403, FeatherlessPlanError],
      [429, FeatherlessBackpressureError],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status })));
      await expect(callFeatherlessStream(liveEnv, req, () => undefined)).rejects.toBeInstanceOf(cls);
    }
  });

  it('retries 503 three times then throws FeatherlessCapacityError', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callFeatherlessStream(liveEnv, req, () => undefined)).rejects.toBeInstanceOf(FeatherlessCapacityError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
