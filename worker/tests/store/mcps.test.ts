import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { createMcp, deleteMcp, listMcps, updateMcp } from '../../src/store/mcps';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('create/list/update/delete scoped to owner', async () => {
  const { id } = await createMcp(env.DB, { userId: 'u-m', name: 'local-fs', config: { cmd: 'x' }, now: 1 });
  expect((await listMcps(env.DB, 'u-m'))[0]!.name).toBe('local-fs');
  expect(await updateMcp(env.DB, 'u-other', id, { enabled: false })).toBe(false); // not owner
  expect(await updateMcp(env.DB, 'u-m', id, { enabled: false })).toBe(true);
  expect((await listMcps(env.DB, 'u-m'))[0]!.enabled).toBe(false);
  expect(await deleteMcp(env.DB, 'u-other', id)).toBe(false); // not owner
  expect(await deleteMcp(env.DB, 'u-m', id)).toBe(true);
  expect(await listMcps(env.DB, 'u-m')).toHaveLength(0);
});
