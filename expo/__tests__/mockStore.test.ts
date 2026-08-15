import { mockStoreStore } from '../src/api/mockStore';

describe('mockStoreStore', () => {
  it('returns default settings and applies a partial patch', async () => {
    const before = await mockStoreStore.getSettings();
    expect(before.suggestions).toBe(true);

    const after = await mockStoreStore.putSettings({ contextPrompt: 'be terse' });
    expect(after.contextPrompt).toBe('be terse');
    expect(after.suggestions).toBe(true); // untouched field survives the patch
  });

  it('connects and disconnects a toolkit', async () => {
    await mockStoreStore.connect('github');
    const connections = await mockStoreStore.listConnections();
    expect(connections.find((c) => c.toolkit === 'github')?.status).toBe('active');

    await mockStoreStore.disconnect('github');
    const after = await mockStoreStore.listConnections();
    expect(after.find((c) => c.toolkit === 'github')).toBeUndefined();
  });
});
