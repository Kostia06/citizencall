import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { listConnections, revokeConnection, upsertConnection } from '../../src/store/connections';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('upserts and lists a connection without leaking the account id', async () => {
  await upsertConnection(env.DB, { userId: 'u-c', toolkit: 'github', connectedAccountId: 'acct_secret', now: 1 });
  const list = await listConnections(env.DB, 'u-c');
  expect(list).toEqual([{ toolkit: 'github', status: 'active', connectedAt: 1 }]);
  expect(JSON.stringify(list)).not.toContain('acct_secret');
});

it('revoke marks status and is scoped to the user', async () => {
  await upsertConnection(env.DB, { userId: 'u-c2', toolkit: 'gmail', connectedAccountId: 'a', now: 1 });
  expect(await revokeConnection(env.DB, 'u-other', 'gmail')).toBe(false); // not this user's
  expect(await revokeConnection(env.DB, 'u-c2', 'gmail')).toBe(true);
  expect((await listConnections(env.DB, 'u-c2'))[0]!.status).toBe('revoked');
});
