// Auth-config resolution for POST /api/connect — makes ANY of Composio's
// 1,200+ catalog toolkits connectable, not just the ones with a pre-created
// dashboard auth config (previously: just GitHub).
//
// Flow (Composio API v3, confirmed against the live backend):
//   1. GET  /api/v3/auth_configs?toolkit_slug=<slug>  -> reuse an existing
//      auth config when the project already has one for this toolkit.
//   2. POST /api/v3/auth_configs with
//      { toolkit: {slug}, auth_config: {type: "use_composio_managed_auth"} }
//      -> create one on the fly using Composio's managed OAuth app.
//   3. Toolkits that genuinely can't use managed auth (Composio rejects the
//      create) surface as AuthConfigUnavailableError so the route can answer
//      a structured 422 — never a silent 500.
//
// Resolved ids are cached per-isolate with a TTL, same pattern (and reasons)
// as composio-catalog.ts's catalog cache.
const COMPOSIO_API_BASE = 'https://backend.composio.dev';
const CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map<string, { id: string; expiresAt: number }>();

export class AuthConfigUnavailableError extends Error {
  readonly toolkit: string;

  constructor(toolkit: string, detail: string) {
    super(`No usable auth config for toolkit "${toolkit}": ${detail}`);
    this.name = 'AuthConfigUnavailableError';
    this.toolkit = toolkit;
  }
}

interface AuthConfigItem {
  id?: string;
  status?: string;
}

interface ListAuthConfigsResponse {
  items?: AuthConfigItem[];
}

// Create responses have varied between {auth_config: {id}} and a flat {id}
// across v3 revisions — accept either.
interface CreateAuthConfigResponse {
  auth_config?: AuthConfigItem;
  id?: string;
}

async function composioJson<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${COMPOSIO_API_BASE}${path}`, {
    ...init,
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Composio ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function firstUsableId(items: AuthConfigItem[] | undefined): string | null {
  if (!items?.length) return null;
  // Prefer a non-disabled config; fall back to whatever exists.
  const usable = items.find((i) => i.id && i.status?.toUpperCase() !== 'DISABLED') ?? items.find((i) => i.id);
  return usable?.id ?? null;
}

async function createManagedAuthConfig(apiKey: string, toolkit: string): Promise<string> {
  const body = await composioJson<CreateAuthConfigResponse>(apiKey, '/api/v3/auth_configs', {
    method: 'POST',
    body: JSON.stringify({ toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth' } }),
  });
  const id = body.auth_config?.id ?? body.id;
  if (!id) throw new Error('create succeeded but returned no auth config id');
  return id;
}

// Resolves the auth-config id to hand to connectedAccounts.link() for a
// toolkit slug: cached -> existing -> created-on-the-fly (managed auth).
// Throws AuthConfigUnavailableError when Composio can't provide one — the
// caller maps that to a 422 so the UI can say "needs manual configuration".
export async function resolveAuthConfigId(apiKey: string, toolkit: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(toolkit);
  if (hit && hit.expiresAt > now) return hit.id;

  let id: string | null = null;
  try {
    const listed = await composioJson<ListAuthConfigsResponse>(
      apiKey,
      `/api/v3/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}`
    );
    id = firstUsableId(listed.items);
    if (!id) id = await createManagedAuthConfig(apiKey, toolkit);
  } catch (err) {
    // Any Composio API failure here (unknown slug, toolkit not eligible for
    // managed auth, upstream outage) means we cannot mint a redirect URL for
    // this toolkit — surface it as the structured, catchable error.
    throw new AuthConfigUnavailableError(toolkit, err instanceof Error ? err.message : String(err));
  }

  cache.set(toolkit, { id, expiresAt: now + CACHE_TTL_MS });
  return id;
}

// Same vitest-isolate-reuse concern as resetToolkitCatalogCacheForTests.
export function resetAuthConfigCacheForTests(): void {
  cache.clear();
}
