import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { getSettings, putSettings } from '../../src/store/settings';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('returns defaults for a user with no row', async () => {
  const s = await getSettings(env.DB, 'u-none');
  expect(s.keybindings.run).toBe('Enter');
  expect(s.contextPrompt).toBe('');
});

it('deep-merges a patch and persists', async () => {
  await putSettings(env.DB, 'u-set', { contextPrompt: 'be terse', keybindings: { run: 'Mod+Enter' } }, 1);
  const s = await getSettings(env.DB, 'u-set');
  expect(s.contextPrompt).toBe('be terse');
  expect(s.keybindings.run).toBe('Mod+Enter');   // overridden
  expect(s.keybindings.focus).toBe('Mod+K');      // default preserved
});
