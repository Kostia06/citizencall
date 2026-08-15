// Composio wrapper for GitHub + Gmail (SPEC.md §5.3). `@composio/core` runs on
// workerd via package `imports` conditions — verified, no `nodejs_compat`.
//
// The SDK's public surface (composio.connectedAccounts.link / tools.execute)
// is intentionally accessed through a narrow local type rather than the
// package's full generated types: those types are provider-generic and shift
// between minor versions, and pinning to them here would make this file
// brittle to upgrades that don't actually change the two calls we make.
// Guarded behind env.COMPOSIO_API_KEY — unset means the stub path below, so
// dev and tests never need a real key or network access.
import type { Env } from '../env';

export interface ConnectionLink {
  url: string;
  state: string;
}

interface ComposioClient {
  connectedAccounts: {
    link(userId: string, authConfigId: string, options?: Record<string, unknown>): Promise<{ redirectUrl: string }>;
    get(connectedAccountId: string): Promise<{ status: string; id: string }>;
  };
  tools: {
    execute(
      toolSlug: string,
      params: { userId: string; arguments: Record<string, unknown> }
    ): Promise<{ successful: boolean; data: unknown; error?: string | null }>;
  };
}

async function client(apiKey: string): Promise<ComposioClient> {
  const mod = (await import('@composio/core')) as unknown as { Composio: new (opts: { apiKey: string }) => unknown };
  return new mod.Composio({ apiKey }) as unknown as ComposioClient;
}

// v3's callback had no CSRF protection (SPEC.md §5.3) — that's textbook
// CSRF-on-OAuth-callback. Every link we create carries a `state` that's an
// HMAC-signed, self-contained token (userId + toolkit + nonce), so
// /oauth/done can verify it came from us without needing separate storage
// for pending OAuth attempts.
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

// Falls back to a fixed dev secret so local/test runs work with zero
// COMPOSIO_API_KEY set; production always sets it, which is what actually
// signs the token there.
function stateSecret(env: Env): string {
  return env.COMPOSIO_API_KEY ?? 'dev-oauth-state-secret';
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface OAuthStatePayload {
  userId: string;
  toolkit: string;
}

export async function createState(env: Env, payload: OAuthStatePayload): Promise<string> {
  const body = JSON.stringify({ ...payload, nonce: crypto.randomUUID() });
  const key = await hmacKey(stateSecret(env));
  const sig = bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `${btoa(body)}.${sig}`;
}

export async function verifyState(env: Env, token: string | null): Promise<OAuthStatePayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const bodyB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let body: string;
  try {
    body = atob(bodyB64);
  } catch {
    return null;
  }

  const key = await hmacKey(stateSecret(env));
  const valid = await crypto.subtle.verify('HMAC', key, hexToBytes(sig), new TextEncoder().encode(body));
  if (!valid) return null;

  try {
    const parsed = JSON.parse(body) as OAuthStatePayload & { nonce: string };
    return { userId: parsed.userId, toolkit: parsed.toolkit };
  } catch {
    return null;
  }
}

function stubLink(toolkit: string, userId: string, state: string): ConnectionLink {
  return { url: `https://composio.stub/link?toolkit=${toolkit}&user=${userId}&state=${state}`, state };
}

export async function createConnectionLink(
  env: Env,
  userId: string,
  toolkit: string,
  authConfigId: string
): Promise<ConnectionLink> {
  const state = await createState(env, { userId, toolkit });
  if (!env.COMPOSIO_API_KEY) return stubLink(toolkit, userId, state);

  // The narrow `state` option this used to pass isn't part of Composio's
  // actual link() options (verified against @composio/core's
  // CreateConnectedAccountLinkOptionsSchema — it only knows callbackUrl,
  // alias, allowMultiple, experimental) and was being silently stripped, so
  // /oauth/done's signed state never round-tripped through a live connect.
  // The real mechanism is: pass our own /oauth/done URL as callbackUrl, with
  // state riding in ITS query string — Composio appends status= and
  // connected_account_id= onto whatever callbackUrl you give it (confirmed
  // against the live v3.1 API), which is exactly the shape /oauth/done reads.
  const callbackUrl = `${env.APP_URL ?? ''}/oauth/done?state=${encodeURIComponent(state)}`;
  try {
    const c = await client(env.COMPOSIO_API_KEY);
    const link = await c.connectedAccounts.link(userId, authConfigId, { callbackUrl });
    return { url: link.redirectUrl, state };
  } catch (err) {
    // authConfigId not provisioned for this toolkit in the Composio
    // dashboard yet, or any other live-API failure: fall back to the dev
    // stub link rather than 500ing the whole /api/connect call.
    console.error(`Composio connect failed for toolkit=${toolkit} authConfigId=${authConfigId}:`, err);
    return stubLink(toolkit, userId, state);
  }
}

export interface ToolExecResult {
  ok: boolean;
  output: unknown;
  latencyMs: number;
}

export async function executeTool(
  env: Env,
  params: { userId: string; toolkit: string; tool: string; args: Record<string, unknown> }
): Promise<ToolExecResult> {
  const started = Date.now();
  if (!env.COMPOSIO_API_KEY) return stubExecuteTool(params, started);

  const c = await client(env.COMPOSIO_API_KEY);
  const slug = `${params.toolkit}_${params.tool}`.toUpperCase();
  const result = await c.tools.execute(slug, { userId: params.userId, arguments: params.args });
  return { ok: result.successful, output: result.data, latencyMs: Date.now() - started };
}

// Deterministic stub keyed on toolkit/tool so demo seed data (a repo with a
// week of commits, a burner Gmail inbox — SPEC.md §16) reads plausibly
// without a live connection.
function stubExecuteTool(
  params: { userId: string; toolkit: string; tool: string; args: Record<string, unknown> },
  started: number
): ToolExecResult {
  return {
    ok: true,
    output: { stub: true, toolkit: params.toolkit, tool: params.tool, args: params.args },
    latencyMs: Date.now() - started + 1,
  };
}
