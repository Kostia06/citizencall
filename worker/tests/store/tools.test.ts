import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { isToolEnabled, listToolOverrides, setToolOverride } from '../../src/store/tools';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('tools default-on; override disables; re-enable upserts', async () => {
  expect(await isToolEnabled(env.DB, 'u-t', 'github', 'list_commits')).toBe(true); // default-on
  await setToolOverride(env.DB, { userId: 'u-t', toolkit: 'github', tool: 'list_commits', enabled: false });
  expect(await isToolEnabled(env.DB, 'u-t', 'github', 'list_commits')).toBe(false);
  await setToolOverride(env.DB, { userId: 'u-t', toolkit: 'github', tool: 'list_commits', enabled: true });
  expect(await isToolEnabled(env.DB, 'u-t', 'github', 'list_commits')).toBe(true);
  expect((await listToolOverrides(env.DB, 'u-t'))).toHaveLength(1);
});
