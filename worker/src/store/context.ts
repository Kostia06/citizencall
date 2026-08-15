import { listConnections } from './connections';
import { listToolOverrides } from './tools';
import { getSettings } from './settings';

export async function loadUserContext(db: D1Database, userId: string) {
  const [connections, overrides, settings] = await Promise.all([
    listConnections(db, userId),
    listToolOverrides(db, userId),
    getSettings(db, userId),
  ]);
  return {
    connections: connections.map((c) => ({ toolkit: c.toolkit, status: c.status })),
    disabledTools: overrides.filter((o) => !o.enabled).map((o) => ({ toolkit: o.toolkit, tool: o.tool })),
    contextPrompt: settings.contextPrompt,
  };
}
