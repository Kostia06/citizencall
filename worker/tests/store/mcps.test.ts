import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { createMcp, deleteMcp, getMcp, listMcps, updateMcp } from '../../src/store/mcps';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('create/list/update/delete scoped to owner', async () => {
  const { id } = await createMcp(env.DB, {
    userId: 'u-m',
    name: 'local-fs',
    config: { url: 'https://mcp.example.com/sse', headers: { Authorization: 'Bearer t' } },
    now: 1,
  });
  const listed = (await listMcps(env.DB, 'u-m'))[0]!;
  expect(listed.name).toBe('local-fs');
  expect(listed.url).toBe('https://mcp.example.com/sse');
  expect(listed.headers).toEqual({ Authorization: 'Bearer t' });
  expect(listed.enabled).toBe(true);
  expect(await updateMcp(env.DB, 'u-other', id, { enabled: false })).toBe(false); // not owner
  expect(await updateMcp(env.DB, 'u-m', id, { enabled: false })).toBe(true);
  expect((await listMcps(env.DB, 'u-m'))[0]!.enabled).toBe(false);
  expect(await getMcp(env.DB, 'u-other', id)).toBeNull(); // not owner
  expect((await getMcp(env.DB, 'u-m', id))!.url).toBe('https://mcp.example.com/sse');
  expect(await deleteMcp(env.DB, 'u-other', id)).toBe(false); // not owner
  expect(await deleteMcp(env.DB, 'u-m', id)).toBe(true);
  expect(await listMcps(env.DB, 'u-m')).toHaveLength(0);
});

it('a legacy row with non-conforming config degrades to empty url/headers', async () => {
  await env.DB.prepare(
    `INSERT INTO user_mcps(id,user_id,name,config_json,enabled,created_at) VALUES('legacy-1','u-legacy','old','{"cmd":"x"}',1,1)`
  ).run();
  const [mcp] = await listMcps(env.DB, 'u-legacy');
  expect(mcp).toMatchObject({ name: 'old', url: '', headers: {}, enabled: true });
});
