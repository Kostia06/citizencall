// providers/composio-tools.ts — real-tool discovery (layered cache), the
// planned-name → real-slug resolver, and the args builder. The resolver is
// the fix for the live failure where a planned discord/'call' died as "tool
// error": every planned name must land on an executable Composio slug
// whenever a tool list is known.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import {
  buildToolArgs,
  getToolkitTools,
  parseArgsJson,
  resetToolkitToolsCacheForTests,
  resolveTool,
  type ToolkitTool,
} from '../src/providers/composio-tools';

const tool = (slug: string, description: string, required: string[] = [], props: string[] = []): ToolkitTool => ({
  slug,
  name: slug.toLowerCase().replace(/_/g, ' '),
  description,
  params: {
    required,
    properties: Object.fromEntries([...required, ...props].map((p) => [p, { type: 'string', description: p }])),
  },
});

// Discord-shaped fixture: a read that needs an id, a free read, a write.
const DISCORD_TOOLS: ToolkitTool[] = [
  tool('DISCORD_LIST_MESSAGES', 'List recent messages in a channel', ['channel_id'], ['limit']),
  tool('DISCORD_LIST_MY_GUILDS', 'List the guilds (servers) the current user is a member of'),
  tool('DISCORD_GET_INVITE', 'Retrieve information about a specific invite code', ['invite_code']),
  tool('DISCORD_SEND_MESSAGE', 'Send a message to a channel', ['channel_id', 'content']),
];

describe('resolveTool', () => {
  const cases: Array<{ name: string; planned: string; instruction: string; expected: string }> = [
    {
      name: 'exact full slug',
      planned: 'DISCORD_LIST_MY_GUILDS',
      instruction: 'irrelevant',
      expected: 'DISCORD_LIST_MY_GUILDS',
    },
    {
      name: 'exact without toolkit prefix, case-insensitive',
      planned: 'list_my_guilds',
      instruction: 'irrelevant',
      expected: 'DISCORD_LIST_MY_GUILDS',
    },
    {
      name: 'punctuation/space-insensitive exact',
      planned: 'List My Guilds',
      instruction: 'irrelevant',
      expected: 'DISCORD_LIST_MY_GUILDS',
    },
    {
      name: "legacy 'call' + read instruction resolves by keywords (the screenshot bug)",
      planned: 'call',
      instruction: 'check for new messages in the channel',
      expected: 'DISCORD_LIST_MESSAGES',
    },
    {
      name: "legacy 'call' + write instruction resolves to the send tool",
      planned: 'call',
      instruction: 'post an update message about the release',
      expected: 'DISCORD_SEND_MESSAGE',
    },
    {
      name: 'no keyword overlap falls back to a read tool with no required params',
      planned: 'call',
      instruction: 'do something entirely unrelated xyzzy',
      expected: 'DISCORD_LIST_MY_GUILDS',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveTool(DISCORD_TOOLS, 'discord', c.planned, c.instruction)?.slug).toBe(c.expected);
    });
  }

  it('returns null on an empty tool list so the planned name executes as-is', () => {
    expect(resolveTool([], 'discord', 'call', 'check messages')).toBeNull();
  });
});

describe('buildToolArgs', () => {
  const neverCalled = () => {
    throw new Error('model must not be consulted');
  };

  it('skips the model entirely when nothing is required', async () => {
    const t = tool('DISCORD_LIST_MY_GUILDS', 'List guilds');
    await expect(buildToolArgs(env as unknown as Env, t, 'list my servers', {}, neverCalled)).resolves.toEqual({});
  });

  it('keeps planned args and skips the model when they satisfy the schema', async () => {
    const t = tool('DISCORD_GET_INVITE', 'Get invite', ['invite_code']);
    const args = await buildToolArgs(env as unknown as Env, t, 'get invite', { invite_code: 'abc' }, neverCalled);
    expect(args).toEqual({ invite_code: 'abc' });
  });

  it('fills limit-family required params with an obvious default, no model', async () => {
    const t = tool('GITHUB_LIST_COMMITS', 'List commits', ['limit']);
    const args = await buildToolArgs(env as unknown as Env, t, 'recent commits', {}, neverCalled);
    expect(args).toEqual({ limit: 10 });
  });

  it('asks the model once for genuinely missing required params', async () => {
    const t = tool('DISCORD_LIST_MESSAGES', 'List messages', ['channel_id'], ['limit']);
    const model = vi.fn().mockResolvedValue('{"channel_id":"123","limit":5}');
    const args = await buildToolArgs(env as unknown as Env, t, 'check messages', {}, model);
    expect(args).toEqual({ channel_id: '123', limit: 5 });
    expect(model).toHaveBeenCalledTimes(1);
  });

  it('drops generated keys that are not in the schema', async () => {
    const t = tool('DISCORD_LIST_MESSAGES', 'List messages', ['channel_id']);
    const model = vi.fn().mockResolvedValue('{"channel_id":"123","hallucinated":"x"}');
    const args = await buildToolArgs(env as unknown as Env, t, 'check messages', {}, model);
    expect(args).toEqual({ channel_id: '123' });
  });

  it('retries once on an incomplete reply, then succeeds', async () => {
    const t = tool('DISCORD_SEND_MESSAGE', 'Send message', ['channel_id', 'content']);
    const model = vi
      .fn()
      .mockResolvedValueOnce('{"content":"hi"}')
      .mockResolvedValueOnce('{"channel_id":"9","content":"hi"}');
    const args = await buildToolArgs(env as unknown as Env, t, 'send hi', {}, model);
    expect(args).toEqual({ channel_id: '9', content: 'hi' });
    expect(model).toHaveBeenCalledTimes(2);
    expect(String(model.mock.calls[1]![1])).toContain('channel_id');
  });

  it('degrades to best-effort args after two bad replies', async () => {
    const t = tool('DISCORD_SEND_MESSAGE', 'Send message', ['channel_id', 'content']);
    const model = vi.fn().mockResolvedValue('not json at all');
    const args = await buildToolArgs(env as unknown as Env, t, 'send hi', {}, model);
    expect(args).toEqual({});
    expect(model).toHaveBeenCalledTimes(2);
  });

  it('degrades without retry when the model throws', async () => {
    const t = tool('DISCORD_SEND_MESSAGE', 'Send message', ['channel_id']);
    const model = vi.fn().mockRejectedValue(new Error('cold'));
    await expect(buildToolArgs(env as unknown as Env, t, 'send hi', {}, model)).resolves.toEqual({});
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe('parseArgsJson', () => {
  it('tolerates think blocks and code fences', () => {
    expect(parseArgsJson('<think>hmm</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('rejects non-objects', () => {
    expect(parseArgsJson('[1,2]')).toBeNull();
    expect(parseArgsJson('plain text')).toBeNull();
  });
});

describe('getToolkitTools cache read-through', () => {
  const realFetch = globalThis.fetch;
  const keyedEnv = { ...env, COMPOSIO_API_KEY: 'test-key' } as unknown as Env;

  const item = (slug: string, extra: Record<string, unknown> = {}) => ({
    slug,
    name: slug,
    description: `${slug} does things`,
    input_parameters: { required: [], properties: { limit: { type: 'integer', description: 'cap' } } },
    ...extra,
  });

  const jsonResponse = (items: unknown[], nextCursor: string | null = null) =>
    new Response(JSON.stringify({ items, next_cursor: nextCursor }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(async () => {
    resetToolkitToolsCacheForTests();
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS toolkit_tools(toolkit TEXT PRIMARY KEY, value_json TEXT NOT NULL, fetched_at INTEGER NOT NULL)'
    );
    await env.DB.exec('DELETE FROM toolkit_tools');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetToolkitToolsCacheForTests();
  });

  it('serves a fresh D1 row without touching the network', async () => {
    const seeded: ToolkitTool[] = [tool('DISCORD_LIST_MY_GUILDS', 'List guilds')];
    await env.DB.prepare('INSERT INTO toolkit_tools (toolkit, value_json, fetched_at) VALUES (?1, ?2, ?3)')
      .bind('discord', JSON.stringify(seeded), Date.now())
      .run();
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be hit');
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tools = await getToolkitTools(keyedEnv, 'discord');
    expect(tools.map((t) => t.slug)).toEqual(['DISCORD_LIST_MY_GUILDS']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches live on a D1 miss, writes the row, and later isolates read it back', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse([item('GITHUB_LIST_COMMITS'), item('GITHUB_CREATE_AN_ISSUE')])
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tools = await getToolkitTools(keyedEnv, 'github');
    expect(tools.map((t) => t.slug)).toEqual(['GITHUB_LIST_COMMITS', 'GITHUB_CREATE_AN_ISSUE']);
    // A single complete page needs no curated-subset request.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain('important=true');

    // Simulate a different isolate: L0 cleared, network down — D1 row serves.
    resetToolkitToolsCacheForTests();
    globalThis.fetch = (() => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const again = await getToolkitTools(keyedEnv, 'github');
    expect(again.map((t) => t.slug)).toEqual(['GITHUB_LIST_COMMITS', 'GITHUB_CREATE_AN_ISSUE']);
  });

  it('prefers the curated important subset for multi-page toolkits (github case)', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('important=true')
        ? jsonResponse([item('GITHUB_LIST_COMMITS')])
        : jsonResponse([item('GITHUB_ACCEPT_A_REPOSITORY_INVITATION')], 'page2')
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tools = await getToolkitTools(keyedEnv, 'github');
    expect(tools.map((t) => t.slug)).toEqual(['GITHUB_LIST_COMMITS']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the alphabetical first page when important=true is empty on a multi-page toolkit', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('important=true')
        ? jsonResponse([])
        : jsonResponse([item('X_LIST_WIDGETS')], 'page2')
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tools = await getToolkitTools(keyedEnv, 'x');
    expect(tools.map((t) => t.slug)).toEqual(['X_LIST_WIDGETS']);
  });

  it('serves a stale D1 row when the live fetch fails', async () => {
    const seeded: ToolkitTool[] = [tool('DISCORD_GET_INVITE', 'Get invite', ['invite_code'])];
    await env.DB.prepare('INSERT INTO toolkit_tools (toolkit, value_json, fetched_at) VALUES (?1, ?2, ?3)')
      .bind('discord', JSON.stringify(seeded), Date.now() - 48 * 60 * 60 * 1000)
      .run();
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;

    const tools = await getToolkitTools(keyedEnv, 'discord');
    expect(tools.map((t) => t.slug)).toEqual(['DISCORD_GET_INVITE']);
  });

  it('returns an empty vocabulary with no key and no cached row', async () => {
    const tools = await getToolkitTools(env as unknown as Env, 'discord');
    expect(tools).toEqual([]);
  });

  it('drops deprecated tools, ranks reads first, and caps at 12', async () => {
    const items = [
      item('X_DELETE_EVERYTHING'),
      item('X_OLD_TOOL', { is_deprecated: true }),
      item('X_LIST_THINGS'),
      ...Array.from({ length: 14 }, (_, i) => item(`X_TOOL_${String(i).padStart(2, '0')}`)),
    ];
    globalThis.fetch = (async () => jsonResponse(items)) as unknown as typeof fetch;

    const tools = await getToolkitTools(keyedEnv, 'x');
    expect(tools).toHaveLength(12);
    expect(tools[0]!.slug).toBe('X_LIST_THINGS');
    expect(tools.some((t) => t.slug === 'X_OLD_TOOL')).toBe(false);
  });
});
