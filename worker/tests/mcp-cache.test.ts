// MCP caches (cache/mcp.ts) — tool lists per server URL, selection per
// (URL, instruction). One test on purpose: the module lazily provisions its
// tables behind a per-isolate guard, and vitest's per-test storage isolation
// would reset D1 between tests without resetting the guard.
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import {
  getCachedMcpSelection,
  getCachedMcpTools,
  putCachedMcpSelection,
  putCachedMcpTools,
} from '../src/cache/mcp';

const TOOLS = [
  { name: 'check_novelty', description: 'novelty', params: { required: ['idea_description'], properties: {} } },
];

it('round-trips tool lists (keyed by URL) and selections (keyed by URL + instruction)', async () => {
  expect(await getCachedMcpTools(env.DB, 'https://a.example/mcp')).toBeNull();
  await putCachedMcpTools(env.DB, 'https://a.example/mcp', TOOLS);
  expect(await getCachedMcpTools(env.DB, 'https://a.example/mcp')).toEqual(TOOLS);
  // A different server URL is a different cache entry.
  expect(await getCachedMcpTools(env.DB, 'https://b.example/mcp')).toBeNull();

  const value = { tool: 'check_novelty', args: { idea_description: 'an idea' } };
  await putCachedMcpSelection(env.DB, 'https://a.example/mcp', 'Check The Novelty', value);
  // Instruction match is case-insensitive; URL and instruction both key.
  expect(await getCachedMcpSelection(env.DB, 'https://a.example/mcp', 'check the novelty')).toEqual(value);
  expect(await getCachedMcpSelection(env.DB, 'https://a.example/mcp', 'different ask')).toBeNull();
  expect(await getCachedMcpSelection(env.DB, 'https://b.example/mcp', 'check the novelty')).toBeNull();
});
