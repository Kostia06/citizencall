// Minimal MCP client for Workers — the Streamable HTTP transport of the MCP
// spec (2025-03-26), hand-rolled over fetch because the official SDK drags in
// Node transports we can't use in an isolate.
//
// Protocol shape: JSON-RPC 2.0 requests POSTed to the server URL with
// `Accept: application/json, text/event-stream`. The server answers either
// with a plain JSON body or with an SSE stream whose `data:` events carry
// JSON-RPC messages — we read events until the response matching our request
// id arrives. A server may issue an `Mcp-Session-Id` response header on
// `initialize`; when it does, every subsequent request must echo it.
//
// Every public method returns a structured result and NEVER throws — the run
// pipeline treats an MCP failure as a skipped/failed tool, not a crash.

export interface McpToolDef {
  name: string;
  description: string;
  /** Parsed from the tool's MCP inputSchema — same shape as ToolkitTool.params
   * so the executor's arg builder works on MCP tools unchanged. */
  params: {
    required: string[];
    properties: Record<string, { type?: string; description?: string; enum?: (string | number)[] }>;
  };
}

export type McpResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface McpToolCallOutput {
  /** Concatenated text of the result's content array. */
  text: string;
  /** The MCP-level `isError` flag (tool executed but reported failure). */
  isError: boolean;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface McpHttpClientOptions {
  timeoutMs?: number;
  /** Injectable for tests — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export class McpHttpClient {
  private url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private sessionId: string | undefined;
  private initialized = false;
  private nextId = 1;

  constructor(url: string, headers: Record<string, string> = {}, opts: McpHttpClientOptions = {}) {
    this.url = url;
    this.headers = headers;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Bind: an unbound fetch reference loses its Workers global receiver.
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** initialize → notifications/initialized. Idempotent per client. */
  async initialize(): Promise<McpResult<void>> {
    if (this.initialized) return { ok: true, value: undefined };
    const params = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'understudy', version: '1.0' },
    };
    let init = await this.request('initialize', params);
    if (!init.ok) {
      // Users paste the server's origin; the Streamable HTTP endpoint is
      // conventionally at /mcp (a bare origin often serves an HTML landing
      // page). One silent retry there before surfacing the error.
      const fallback = mcpEndpointFallback(this.url);
      if (fallback) {
        const original = this.url;
        this.url = fallback;
        this.sessionId = undefined;
        init = await this.request('initialize', params);
        if (!init.ok) this.url = original;
      }
    }
    if (!init.ok) return init;
    // Best-effort per spec — servers must tolerate a client that proceeds
    // straight to requests, and some (204/202 responders) return no body.
    await this.notify('notifications/initialized');
    this.initialized = true;
    return { ok: true, value: undefined };
  }

  async listTools(): Promise<McpResult<McpToolDef[]>> {
    const ensured = await this.initialize();
    if (!ensured.ok) return ensured;
    const res = await this.request('tools/list', {});
    if (!res.ok) return res;
    const tools = (res.value as { tools?: unknown })?.tools;
    if (!Array.isArray(tools)) return { ok: false, error: 'mcp tools/list returned no tools array' };
    return {
      ok: true,
      value: tools
        .filter((t): t is { name: string; description?: string; inputSchema?: unknown } => !!t && typeof (t as { name?: unknown }).name === 'string')
        .map((t) => ({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : '',
          params: parseInputSchema(t.inputSchema),
        })),
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpResult<McpToolCallOutput>> {
    const ensured = await this.initialize();
    if (!ensured.ok) return ensured;
    const res = await this.request('tools/call', { name, arguments: args });
    if (!res.ok) return res;
    const result = res.value as { content?: unknown; isError?: unknown };
    const text = contentToText(result?.content);
    return { ok: true, value: { text, isError: result?.isError === true } };
  }

  // -------------------------------------------------------------------------

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.headers,
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    };
  }

  private async post(body: unknown): Promise<McpResult<Response>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const session = response.headers.get('Mcp-Session-Id');
      if (session) this.sessionId = session;
      return { ok: true, value: response };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        error: aborted
          ? `mcp request timed out after ${this.timeoutMs}ms`
          : `mcp request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fire-and-forget JSON-RPC notification (no id, no response expected). */
  private async notify(method: string): Promise<void> {
    await this.post({ jsonrpc: '2.0', method });
  }

  /** JSON-RPC request; handles both plain-JSON and SSE response modes. */
  private async request(method: string, params: unknown): Promise<McpResult<unknown>> {
    const id = this.nextId++;
    const posted = await this.post({ jsonrpc: '2.0', id, method, params });
    if (!posted.ok) return posted;
    const response = posted.value;

    if (!response.ok) {
      return { ok: false, error: `mcp server responded ${response.status} for ${method}` };
    }

    const contentType = response.headers.get('content-type') ?? '';
    let message: McpResult<JsonRpcMessage>;
    if (contentType.includes('text/event-stream')) {
      message = await readSseUntilId(response, id, this.timeoutMs);
    } else {
      message = await parseJsonBody(response, id);
    }
    if (!message.ok) return message;
    if (message.value.error) {
      const { code, message: msg } = message.value.error;
      return { ok: false, error: `mcp error ${code ?? ''}: ${msg ?? 'unknown error'}`.trim() };
    }
    return { ok: true, value: message.value.result };
  }
}

async function parseJsonBody(response: Response, id: number): Promise<McpResult<JsonRpcMessage>> {
  try {
    const parsed: unknown = await response.json();
    // Some servers batch; accept an array and pick our id.
    const messages: JsonRpcMessage[] = Array.isArray(parsed) ? parsed : [parsed as JsonRpcMessage];
    const match = messages.find((m) => m && m.id === id);
    if (!match) return { ok: false, error: 'mcp response did not include a message for our request id' };
    return { ok: true, value: match };
  } catch {
    return { ok: false, error: 'mcp server returned unparseable JSON' };
  }
}

/** Read an SSE stream, parsing `data:` payloads (which may span multiple
 * data lines and arrive split across network chunks), until the JSON-RPC
 * message carrying our request id shows up. */
async function readSseUntilId(response: Response, id: number, timeoutMs: number): Promise<McpResult<JsonRpcMessage>> {
  const body = response.body;
  if (!body) return { ok: false, error: 'mcp SSE response had no body' };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  try {
    for (;;) {
      if (Date.now() > deadline) {
        return { ok: false, error: `mcp SSE stream timed out after ${timeoutMs}ms` };
      }
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      // Events are separated by a blank line; normalize CRLF first.
      const events = buffer.replace(/\r\n/g, '\n').split('\n\n');
      buffer = done ? '' : (events.pop() ?? '');
      for (const rawEvent of events) {
        const data = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // not JSON (keepalive/comment payload) — keep reading
        }
        const messages: JsonRpcMessage[] = Array.isArray(parsed) ? parsed : [parsed as JsonRpcMessage];
        const match = messages.find((m) => m && m.id === id);
        if (match) return { ok: true, value: match };
      }
      if (done) return { ok: false, error: 'mcp SSE stream ended without a response for our request id' };
    }
  } catch (err) {
    return { ok: false, error: `mcp SSE read failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    reader.releaseLock();
    // Cancel the stream so a long-lived SSE connection doesn't leak.
    body.cancel().catch(() => undefined);
  }
}

/** `<origin or path>` → `<...>/mcp`, or null when the URL already targets a
 * plausible MCP endpoint (ends in /mcp or /sse) and a retry would be a no-op. */
function mcpEndpointFallback(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/mcp') || path.endsWith('/sse')) return null;
  url.pathname = `${path}/mcp`;
  return url.toString();
}

/** MCP tools carry a JSON-Schema `inputSchema`; reduce it to the flat
 * required/properties shape the arg builder consumes. Malformed or absent
 * schemas degrade to "no known params" rather than failing discovery. */
function parseInputSchema(schema: unknown): McpToolDef['params'] {
  const empty = { required: [] as string[], properties: {} as Record<string, { type?: string; description?: string }> };
  if (!schema || typeof schema !== 'object') return empty;
  const s = schema as { required?: unknown; properties?: unknown };
  const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === 'string') : [];
  const properties: Record<string, { type?: string; description?: string }> = {};
  if (s.properties && typeof s.properties === 'object') {
    for (const [key, value] of Object.entries(s.properties as Record<string, unknown>)) {
      const v = (value ?? {}) as { type?: unknown; description?: unknown; enum?: unknown };
      const enumValues = Array.isArray(v.enum)
        ? v.enum.filter((e): e is string | number => typeof e === 'string' || typeof e === 'number')
        : [];
      properties[key] = {
        ...(typeof v.type === 'string' ? { type: v.type } : {}),
        ...(typeof v.description === 'string' ? { description: v.description } : {}),
        ...(enumValues.length > 0 ? { enum: enumValues } : {}),
      };
    }
  }
  return { required, properties };
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const it = item as { type?: unknown; text?: unknown };
      if (it.type === 'text' && typeof it.text === 'string') return it.text;
      return JSON.stringify(item);
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

// ---------------------------------------------------------------------------
// SSRF guard. User-supplied MCP URLs are fetched from OUR worker, so an
// attacker could point one at internal infrastructure. Workers have no
// resolver hook, so this is a HOSTNAME-PATTERN check, not a DNS-resolution
// check — a public name that resolves to a private IP still gets through.
// That residual risk is accepted for now (the production runtime is a
// Cloudflare isolate with no private network of its own); revisit if the
// worker ever fronts internal services. `allowLocalhost` exists because in
// local dev the worker itself runs on localhost and test MCP servers do too —
// gated on env.APP_URL containing 'localhost' (the only dev-vs-prod signal
// this worker has; a prod deploy with a localhost APP_URL would weaken the
// guard, which is a config error we accept documenting over inventing a new
// env flag).
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local / cloud metadata
  /^\[?::1\]?$/,
  /^metadata\.google/i,
  /\.internal$/i,
];

const LOCALHOST_PATTERNS: RegExp[] = [/^localhost$/i, /^127\./, /^\[?::1\]?$/];

export function isBlockedMcpUrl(rawUrl: string, opts: { allowLocalhost: boolean }): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'invalid MCP server URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `unsupported MCP URL scheme ${url.protocol}`;
  }
  const host = url.hostname;
  if (opts.allowLocalhost && LOCALHOST_PATTERNS.some((p) => p.test(host))) return null;
  if (BLOCKED_HOST_PATTERNS.some((p) => p.test(host))) {
    return 'MCP server URL points at an internal address';
  }
  return null;
}
