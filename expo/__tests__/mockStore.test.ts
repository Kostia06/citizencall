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

  it('suggests a rule-matched next action based on the last prompt', async () => {
    const pr = await mockStoreStore.suggest(['check my inbox', 'any open pull requests?']);
    expect(pr.suggestion).toMatch(/pull requests/i);

    const email = await mockStoreStore.suggest(['summarize the repo', 'check my gmail inbox']);
    expect(email.suggestion).toMatch(/emails/i);
  });

  it('falls back to the default suggestion when no rule matches', async () => {
    const { suggestion } = await mockStoreStore.suggest(['what is the weather']);
    expect(suggestion).toBe('Summarize what changed since your last run.');
  });

  it('falls back to the default suggestion for empty context', async () => {
    const { suggestion } = await mockStoreStore.suggest([]);
    expect(suggestion).toBe('Summarize what changed since your last run.');
  });
});
