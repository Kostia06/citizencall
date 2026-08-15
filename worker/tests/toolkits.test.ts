// GET /api/toolkits (worker/src/index.ts + src/providers/composio-catalog.ts).
// No COMPOSIO_API_KEY is set in vitest.config.ts's bindings, so this always
// exercises the bundled fallback list — the live path is smoke-tested
// manually (see the task report), not in CI, since it needs a real key.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { resetToolkitCatalogCacheForTests } from '../src/providers/composio-catalog';

beforeEach(() => resetToolkitCatalogCacheForTests());

describe('GET /api/toolkits', () => {
  it('returns 100+ toolkits from the fallback list with the right shape', async () => {
    const res = await app.request('/api/toolkits', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ toolkits: Array<{ slug: string; name: string; category: string; logo: string }>; source: string }>();

    expect(body.source).toBe('fallback');
    expect(body.toolkits.length).toBeGreaterThanOrEqual(100);

    for (const t of body.toolkits) {
      expect(typeof t.slug).toBe('string');
      expect(t.slug.length).toBeGreaterThan(0);
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.category).toBe('string');
      expect(t.logo).toMatch(/^https:\/\//);
    }

    // Every slug is unique — a picker keyed on slug would silently drop
    // duplicates otherwise.
    const slugs = body.toolkits.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    // Spans multiple categories rather than being one giant bucket.
    const categories = new Set(body.toolkits.map((t) => t.category));
    expect(categories.size).toBeGreaterThan(5);
  });

  it('includes well-known popular apps', async () => {
    const res = await app.request('/api/toolkits', {}, env);
    const body = await res.json<{ toolkits: Array<{ slug: string }> }>();
    const slugs = new Set(body.toolkits.map((t) => t.slug));
    expect(slugs.has('github')).toBe(true);
    expect(slugs.has('slack')).toBe(true);
    expect(slugs.has('notion')).toBe(true);
  });

  it('is cached in-module across requests within the same isolate', async () => {
    const first = await app.request('/api/toolkits', {}, env);
    const firstBody = await first.json();
    const second = await app.request('/api/toolkits', {}, env);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
  });
});
