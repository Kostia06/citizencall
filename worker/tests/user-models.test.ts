// providers/user-models.ts: the three kinds translate the shared message
// shape correctly onto their wire formats, and every failure surfaces as a
// bounded UserProviderError (never a raw throw, never the api key).
import { afterEach, expect, it } from 'vitest';
import { callUserProvider, UserProviderError, type UserProvider } from '../src/providers/user-models';
import type { FeatherlessMessage } from '../src/providers/featherless';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function mockFetch(response: unknown, status = 200): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { captured };
}

function provider(overrides: Partial<UserProvider> = {}): UserProvider {
  return {
    id: 'p1',
    userId: 'u1',
    kind: 'openai',
    baseUrl: null,
    model: 'gpt-4o-mini',
    apiKey: 'sk-test-key-123456',
    enabled: true,
    createdAt: 1,
    ...overrides,
  };
}

const messages: FeatherlessMessage[] = [
  { role: 'system', content: 'persona' },
  { role: 'system', content: 'task prompt' },
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'hi' },
  { role: 'user', content: 'summarize' },
];

it('anthropic: lifts system turns into the top-level field, sends required headers + max_tokens', async () => {
  const { captured } = mockFetch({
    content: [{ type: 'text', text: 'the ' }, { type: 'text', text: 'answer' }],
    usage: { input_tokens: 11, output_tokens: 7 },
  });
  const result = await callUserProvider(provider({ kind: 'anthropic', model: 'claude-sonnet-5' }), {
    messages,
    maxTokens: 1024,
  });

  const req = captured[0]!;
  expect(req.url).toBe('https://api.anthropic.com/v1/messages');
  expect(req.headers['x-api-key']).toBe('sk-test-key-123456');
  expect(req.headers['anthropic-version']).toBe('2023-06-01');
  expect(req.body.model).toBe('claude-sonnet-5');
  expect(req.body.system).toBe('persona\n\ntask prompt');
  expect(req.body.max_tokens).toBe(1024); // required by the Messages API
  expect(req.body.messages).toEqual([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: 'summarize' },
  ]);
  expect(result).toMatchObject({ content: 'the answer', promptTokens: 11, completionTokens: 7 });
});

it('openai: passes messages through (system stays a role) with a bearer header', async () => {
  const { captured } = mockFetch({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  });
  const result = await callUserProvider(provider(), { messages, maxTokens: 256 });

  const req = captured[0]!;
  expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
  expect(req.headers.authorization).toBe('Bearer sk-test-key-123456');
  expect(req.body.messages).toEqual(messages);
  expect(req.body.max_tokens).toBe(256);
  expect(result).toMatchObject({ content: 'ok', promptTokens: 5, completionTokens: 2 });
});

it('custom: joins base_url to /chat/completions, tolerating a trailing slash', async () => {
  const { captured } = mockFetch({ choices: [{ message: { content: 'echo' } }] });
  const result = await callUserProvider(
    provider({ kind: 'custom', baseUrl: 'https://my-host.example.com/v1/', model: 'llama-3-8b' }),
    { messages, maxTokens: 256 }
  );
  expect(captured[0]!.url).toBe('https://my-host.example.com/v1/chat/completions');
  expect(result.content).toBe('echo');
});

it('non-2xx surfaces as UserProviderError with a bounded, key-free message', async () => {
  mockFetch({ error: { message: 'invalid api key' } }, 401);
  const err = await callUserProvider(provider({ kind: 'anthropic' }), { messages, maxTokens: 64 }).then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(UserProviderError);
  expect((err as Error).message).toContain('anthropic 401');
  expect((err as Error).message).not.toContain('sk-test-key-123456');
});

it('a throwing fetch (DNS, abort) is wrapped, never rethrown raw', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('getaddrinfo ENOTFOUND my-host');
  }) as typeof fetch;
  const err = await callUserProvider(
    provider({ kind: 'custom', baseUrl: 'https://gone.example.com' }),
    { messages, maxTokens: 64 }
  ).then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(UserProviderError);
  expect((err as Error).message).toContain('custom call failed');
});
