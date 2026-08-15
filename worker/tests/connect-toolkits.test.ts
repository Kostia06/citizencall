// POST /api/connect for ANY Composio catalog slug (providers/
// composio-auth-configs.ts): auth configs are looked up per toolkit and
// created on the fly with Composio managed auth when missing. The Composio
// backend is mocked via cloudflare:test's fetchMock; the @composio/core
// SDK's own link() call is NOT mocked, so it fails under disableNetConnect
// and createConnectionLink falls back to its stub link — which is exactly
// the assertable part of the contract here ({redirectUrl} comes back).
import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import app from '../src/index';
import { resetAuthConfigCacheForTests } from '../src/providers/composio-auth-configs';

const keyedEnv = { ...env, COMPOSIO_API_KEY: 'test-composio-key' };

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => resetAuthConfigCacheForTests());
afterEach(() => fetchMock.assertNoPendingInterceptors());

async function connect(toolkit: string, testEnv: typeof env = env): Promise<Response> {
  return await app.request(
    '/api/connect',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toolkit }) },
    testEnv
  );
}

const composio = () => fetchMock.get('https://backend.composio.dev');
const listIntercept = (toolkit: string) =>
  composio().intercept({ method: 'GET', path: `/api/v3/auth_configs?toolkit_slug=${toolkit}` });
const createIntercept = () => composio().intercept({ method: 'POST', path: '/api/v3/auth_configs' });

it('accepts any catalog slug on the keyless stub path (not just github/gmail)', async () => {
  for (const toolkit of ['slack', 'notion', 'linear']) {
    const res = await connect(toolkit);
    expect(res.status).toBe(200);
    const body = await res.json<{ redirectUrl: string; url: string; state: string }>();
    expect(body.redirectUrl).toContain(`toolkit=${toolkit}`);
    expect(body.url).toBe(body.redirectUrl); // legacy shape preserved
    expect(body.state).toBeTruthy();
  }
});

it('400s on a malformed slug', async () => {
  for (const toolkit of ['', 'not a slug!', 'a'.repeat(101)]) {
    const res = await connect(toolkit);
    expect(res.status).toBe(400);
  }
});

it('reuses an existing auth config and caches it per toolkit', async () => {
  // Exactly ONE list call is allowed — the second connect must be served
  // from the in-isolate cache (an uncached second call would either consume
  // a second interceptor or die on disableNetConnect and 422).
  listIntercept('slack').reply(200, JSON.stringify({ items: [{ id: 'ac_existing', status: 'ENABLED' }] }), {
    headers: { 'Content-Type': 'application/json' },
  });

  const first = await connect('slack', keyedEnv);
  expect(first.status).toBe(200);
  expect((await first.json<{ redirectUrl: string }>()).redirectUrl).toBeTruthy();

  const second = await connect('slack', keyedEnv);
  expect(second.status).toBe(200);
});

it('creates a managed auth config when none exists', async () => {
  listIntercept('notion').reply(200, JSON.stringify({ items: [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
  createIntercept().reply(201, JSON.stringify({ auth_config: { id: 'ac_created' } }), {
    headers: { 'Content-Type': 'application/json' },
  });

  const res = await connect('notion', keyedEnv);
  expect(res.status).toBe(200);
  expect((await res.json<{ redirectUrl: string }>()).redirectUrl).toBeTruthy();
});

it('422s with a structured error when managed auth is unavailable', async () => {
  listIntercept('obscureapp').reply(200, JSON.stringify({ items: [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
  createIntercept().reply(400, JSON.stringify({ error: 'toolkit does not support composio managed auth' }));

  const res = await connect('obscureapp', keyedEnv);
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: 'auth_config_unavailable', toolkit: 'obscureapp' });
});
