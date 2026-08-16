// /api/providers (store/routes.ts + store/user-providers.ts): bring-your-own
// model keys. The contract under test: keys are write-only (masked to
// `…last4` on every read), rows are owner-scoped via resolveActor (anon
// cookie or bearer), and validation rejects malformed providers loudly.
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyStoreSchema } from '../../src/db';

const jsonHeaders = { 'Content-Type': 'application/json' };

beforeAll(async () => {
  await applyStoreSchema(env.DB);
});

function cookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('expected a Set-Cookie header');
  return setCookieHeader.split(';')[0]!;
}

async function post(body: unknown, cookie?: string): Promise<{ res: Response; cookie: string }> {
  const res = await app.request(
    '/api/providers',
    { method: 'POST', headers: { ...jsonHeaders, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) },
    env
  );
  // A 400 rejects before resolveActor runs, so no anon cookie is minted on
  // validation failures — only demand one when the caller will reuse it.
  const setCookie = res.headers.get('Set-Cookie');
  return { res, cookie: cookie ?? (setCookie ? cookiePair(setCookie) : '') };
}

it('create + list round-trip masks the api key and never echoes it', async () => {
  const { res, cookie } = await post({ kind: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-ant-secret-key-9876' });
  expect(res.status).toBe(201);
  const created = await res.json<Record<string, unknown>>();
  expect(created).toMatchObject({ kind: 'anthropic', model: 'claude-sonnet-5', apiKeyMasked: '…9876', enabled: true });
  expect(created).not.toHaveProperty('apiKey');

  const list = await app.request('/api/providers', { headers: { Cookie: cookie } }, env);
  expect(list.status).toBe(200);
  const bodyText = await list.text();
  expect(bodyText).not.toContain('sk-ant-secret-key-9876'); // the full key must never leave the server
  const rows = JSON.parse(bodyText) as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ apiKeyMasked: '…9876' });

  // The FULL key is stored — the pipeline needs it to call the provider.
  const stored = await env.DB.prepare(`SELECT api_key FROM user_providers WHERE id=?`)
    .bind(created.id)
    .first<{ api_key: string }>();
  expect(stored!.api_key).toBe('sk-ant-secret-key-9876');
});

it('rows are scoped to the acting session', async () => {
  const a = await post({ kind: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-scope-aaaa1111' });
  expect(a.res.status).toBe(201);
  const { id } = await a.res.json<{ id: string }>();

  // A different anonymous session sees nothing and cannot delete/toggle.
  const b = await post({ kind: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-scope-bbbb2222' });
  const listB = await app.request('/api/providers', { headers: { Cookie: b.cookie } }, env);
  const rowsB = await listB.json<Array<{ apiKeyMasked: string }>>();
  expect(rowsB.map((r) => r.apiKeyMasked)).toEqual(['…2222']);

  const foreignDelete = await app.request(`/api/providers/${id}`, { method: 'DELETE', headers: { Cookie: b.cookie } }, env);
  expect(foreignDelete.status).toBe(404);
  const foreignPatch = await app.request(
    `/api/providers/${id}`,
    { method: 'PATCH', headers: { ...jsonHeaders, Cookie: b.cookie }, body: JSON.stringify({ enabled: false }) },
    env
  );
  expect(foreignPatch.status).toBe(404);

  // The owner can toggle and delete.
  const patch = await app.request(
    `/api/providers/${id}`,
    { method: 'PATCH', headers: { ...jsonHeaders, Cookie: a.cookie }, body: JSON.stringify({ enabled: false }) },
    env
  );
  expect(patch.status).toBe(200);
  const afterPatch = await app.request('/api/providers', { headers: { Cookie: a.cookie } }, env);
  expect((await afterPatch.json<Array<{ enabled: boolean }>>())[0]!.enabled).toBe(false);

  const del = await app.request(`/api/providers/${id}`, { method: 'DELETE', headers: { Cookie: a.cookie } }, env);
  expect(del.status).toBe(204);
  const afterDelete = await app.request('/api/providers', { headers: { Cookie: a.cookie } }, env);
  expect(await afterDelete.json()).toEqual([]);
});

it('validation: kind, model, key length, and the base_url rules', async () => {
  const cases: Array<Record<string, unknown>> = [
    { kind: 'mystery', model: 'x-1', apiKey: 'sk-valid-length-123' }, // unknown kind
    { kind: 'openai', apiKey: 'sk-valid-length-123' }, // model missing
    { kind: 'openai', model: 'gpt-4o-mini', apiKey: 'short' }, // key too short to mask safely
    { kind: 'custom', model: 'llama-3-8b', apiKey: 'sk-valid-length-123' }, // custom without baseUrl
    { kind: 'custom', model: 'llama-3-8b', apiKey: 'sk-valid-length-123', baseUrl: 'http://insecure.example.com/v1' }, // https only
    { kind: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-valid-length-123', baseUrl: 'https://a.example.com' }, // baseUrl only for custom
    { kind: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-valid-length-123', extra: true }, // unknown key
  ];
  for (const body of cases) {
    const { res } = await post(body);
    expect(res.status, JSON.stringify(body)).toBe(400);
  }

  const ok = await post({ kind: 'custom', model: 'llama-3-8b', apiKey: 'sk-valid-length-123', baseUrl: 'https://my-host.example.com/v1' });
  expect(ok.res.status).toBe(201);
  expect(await ok.res.json()).toMatchObject({ kind: 'custom', baseUrl: 'https://my-host.example.com/v1' });
});
