// MCP call transport — JSON-RPC framing, SSE response mode, session carry,
// tool-name matching, SSRF guard. All fetches are mocked via the client's
// injectable fetchImpl; no live MCP server is involved.
import { describe, expect, it } from 'vitest';
import { isBlockedMcpUrl, McpHttpClient } from '../src/providers/mcp-client';
import { buildMcpTransport, matchMcpTool, type McpToolkit } from '../src/pipeline/mcp';

type RecordedRequest = { method: string; id?: number; params?: unknown; headers: Record<string, string> };

const TOOLS = [
  { name: 'echo', description: 'Echoes back the input message' },
  { name: 'get_weather', description: 'Current weather for a city' },
];

/** Minimal in-memory MCP server speaking the plain-JSON response mode. */
function makeMockServer(opts: { sessionId?: string; callResult?: unknown } = {}) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: unknown };
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    requests.push({ method: body.method, ...(body.id !== undefined ? { id: body.id } : {}), params: body.params, headers });

    if (body.id === undefined) return new Response(null, { status: 202 }); // notification

    const respond = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        headers: {
          'content-type': 'application/json',
          ...(body.method === 'initialize' && opts.sessionId ? { 'Mcp-Session-Id': opts.sessionId } : {}),
        },
      });

    if (body.method === 'initialize') {
      return respond({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '0' } });
    }
    if (body.method === 'tools/list') return respond({ tools: TOOLS });
    if (body.method === 'tools/call') {
      return respond(opts.callResult ?? { content: [{ type: 'text', text: 'called ok' }], isError: false });
    }
    return new Response('unknown method', { status: 400 });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe('McpHttpClient framing', () => {
  it('performs the lifecycle in order: initialize, initialized notification, tools/list, tools/call', async () => {
    const server = makeMockServer();
    const client = new McpHttpClient('https://mcp.example.com/mcp', {}, { fetchImpl: server.fetchImpl });

    const listed = await client.listTools();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((t) => t.name)).toEqual(['echo', 'get_weather']);

    const called = await client.callTool('echo', { message: 'hi' });
    expect(called).toEqual({ ok: true, value: { text: 'called ok', isError: false } });

    expect(server.requests.map((r) => r.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ]);
    const call = server.requests[3];
    expect(call?.params).toEqual({ name: 'echo', arguments: { message: 'hi' } });
  });

  it('carries Mcp-Session-Id from initialize into subsequent requests', async () => {
    const server = makeMockServer({ sessionId: 'sess-42' });
    const client = new McpHttpClient('https://mcp.example.com/mcp', { Authorization: 'Bearer k' }, { fetchImpl: server.fetchImpl });
    await client.listTools();

    expect(server.requests[0]?.headers['mcp-session-id']).toBeUndefined(); // initialize itself
    for (const r of server.requests.slice(1)) expect(r.headers['mcp-session-id']).toBe('sess-42');
    // Custom auth headers ride every request.
    for (const r of server.requests) expect(r.headers['authorization']).toBe('Bearer k');
  });

  it('parses an SSE response whose event is split across network chunks', async () => {
    const rpc = (id: number, result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });
    let calls = 0;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (body.id === undefined) return new Response(null, { status: 202 });
      calls++;
      if (body.method === 'initialize') {
        return new Response(rpc(body.id, { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: {} }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      // tools/list answered over SSE: an unrelated event first, then the
      // response event split mid-JSON across three chunks.
      const payload = rpc(body.id, { tools: TOOLS });
      const chunks = [
        'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n',
        `event: message\ndata: ${payload.slice(0, 25)}`,
        payload.slice(25, 60),
        `${payload.slice(60)}\n\n`,
      ];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) controller.enqueue(enc.encode(c));
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;

    const client = new McpHttpClient('https://mcp.example.com/mcp', {}, { fetchImpl });
    const listed = await client.listTools();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((t) => t.name)).toEqual(['echo', 'get_weather']);
    expect(calls).toBe(2);
  });

  it('aborts a hung request at the timeout and returns a structured error', async () => {
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const client = new McpHttpClient('https://mcp.example.com/mcp', {}, { fetchImpl, timeoutMs: 30 });
    const res = await client.initialize();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('timed out after 30ms');
  });

  it('maps a JSON-RPC error object to ok:false without throwing', async () => {
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number };
      if (body.id === undefined) return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'no such method' } }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new McpHttpClient('https://mcp.example.com/mcp', {}, { fetchImpl });
    const res = await client.initialize();
    expect(res).toEqual({ ok: false, error: 'mcp error -32601: no such method' });
  });
});

describe('matchMcpTool', () => {
  it('matches exactly, case/punctuation-insensitive', () => {
    expect(matchMcpTool(TOOLS, 'GET-WEATHER')?.name).toBe('get_weather');
  });
  it("resolves the planner's generic 'call' by instruction keywords", () => {
    expect(matchMcpTool(TOOLS, 'call', 'what is the weather in Paris')?.name).toBe('get_weather');
  });
  it('falls back to the first tool when nothing matches', () => {
    expect(matchMcpTool(TOOLS, 'call', 'zzz')?.name).toBe('echo');
  });
  it('returns null for an empty tool list', () => {
    expect(matchMcpTool([], 'call')).toBeNull();
  });
});

describe('buildMcpTransport', () => {
  const servers: McpToolkit[] = [
    { id: '1', toolkit: 'my-notes', name: 'My Notes', url: 'https://mcp.example.com/mcp', headers: {} },
  ];

  it('resolves the toolkit, matches the tool, and maps content to text output', async () => {
    const server = makeMockServer();
    const transport = buildMcpTransport(servers, {
      allowLocalhost: false,
      clientFactory: (url, headers) => new McpHttpClient(url, headers, { fetchImpl: server.fetchImpl }),
    });
    const res = await transport.call('my-notes', 'echo', { message: 'hi' });
    expect(res).toEqual({ ok: true, output: 'called ok' });
  });

  it('maps isError:true tool results to ok:false', async () => {
    const server = makeMockServer({ callResult: { content: [{ type: 'text', text: 'boom' }], isError: true } });
    const transport = buildMcpTransport(servers, {
      allowLocalhost: false,
      clientFactory: (url, headers) => new McpHttpClient(url, headers, { fetchImpl: server.fetchImpl }),
    });
    const res = await transport.call('my-notes', 'echo', {});
    expect(res).toEqual({ ok: false, output: 'boom' });
  });

  it('fails cleanly for an unknown toolkit token', async () => {
    const transport = buildMcpTransport(servers, { allowLocalhost: false });
    const res = await transport.call('not-configured', 'call', {});
    expect(res.ok).toBe(false);
    expect(String(res.output)).toContain('no MCP server configured');
  });

  it('refuses internal URLs before any network call', async () => {
    const transport = buildMcpTransport(
      [{ id: '2', toolkit: 'evil', name: 'Evil', url: 'http://169.254.169.254/latest', headers: {} }],
      {
        allowLocalhost: true, // even in dev, metadata endpoints stay blocked
        clientFactory: () => {
          throw new Error('client must not be constructed for a blocked URL');
        },
      }
    );
    const res = await transport.call('evil', 'call', {});
    expect(res.ok).toBe(false);
    expect(String(res.output)).toContain('internal address');
  });
});

describe('isBlockedMcpUrl', () => {
  const blocked = (url: string, allowLocalhost = false) => isBlockedMcpUrl(url, { allowLocalhost }) !== null;

  it.each([
    ['http://localhost:8931/mcp', true],
    ['http://127.0.0.1/mcp', true],
    ['http://[::1]:9000/mcp', true],
    ['http://10.0.0.5/mcp', true],
    ['http://172.16.0.1/mcp', true],
    ['http://172.31.9.9/mcp', true],
    ['http://192.168.1.10/mcp', true],
    ['http://169.254.169.254/latest', true],
    ['http://metadata.google.internal/computeMetadata', true],
    ['http://foo.internal/mcp', true],
    ['ftp://mcp.example.com/mcp', true],
    ['not a url', true],
    ['https://mcp.example.com/mcp', false],
    ['http://172.32.0.1/mcp', false], // outside the 172.16-31 private block
  ])('%s blocked=%s (prod)', (url, expected) => {
    expect(blocked(url)).toBe(expected);
  });

  it('allows localhost and loopback only in dev (allowLocalhost)', () => {
    expect(blocked('http://localhost:8931/mcp', true)).toBe(false);
    expect(blocked('http://127.0.0.1:8931/mcp', true)).toBe(false);
    expect(blocked('http://[::1]:8931/mcp', true)).toBe(false);
    // Other private ranges stay blocked even in dev.
    expect(blocked('http://10.0.0.5/mcp', true)).toBe(true);
    expect(blocked('http://169.254.169.254/x', true)).toBe(true);
  });
});
