// POST /api/suggest (worker/src/index.ts + src/pipeline/suggest.ts). No
// FEATHERLESS_API_KEY is set in vitest.config.ts's bindings, so every
// request here exercises the stub path — same convention as the rest of the
// suite (SPEC.md's "never needs a real key" guarantee).
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../src/index';
import { applyAuthSchema } from '../src/db';
import { cheapestAvailableModel } from '../src/pipeline/suggest';
import { candidates } from '../src/policy';

beforeAll(async () => {
  await applyAuthSchema(env.DB); // /api/suggest's per-IP throttle uses auth_attempts
});

const post = (body: unknown) =>
  app.request('/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);

describe('POST /api/suggest', () => {
  it('returns a suggestion string derived from the last context line (stub path, no key)', async () => {
    const res = await post({ context: ['looked at the roster', 'opened the connect picker'] });
    expect(res.status).toBe(200);
    const body = await res.json<{ suggestion: string }>();
    expect(typeof body.suggestion).toBe('string');
    expect(body.suggestion.length).toBeGreaterThan(0);
    expect(body.suggestion).toContain('opened the connect picker');
  });

  it('still returns a sensible suggestion for empty context', async () => {
    const res = await post({ context: [] });
    expect(res.status).toBe(200);
    const body = await res.json<{ suggestion: string }>();
    expect(body.suggestion.length).toBeGreaterThan(0);
  });

  it('400s on a malformed body', async () => {
    const res = await post({ context: 'not an array' });
    expect(res.status).toBe(400);
  });

  it('anonymous-friendly: no Authorization header required', async () => {
    const res = await app.request(
      '/api/suggest',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ['x'] }) },
      env
    );
    expect(res.status).toBe(200);
  });
});

describe('cheapestAvailableModel()', () => {
  it('picks the lowest pricePerMTokOut among warm, on-plan candidates', () => {
    const id = cheapestAvailableModel(candidates);
    const chosen = candidates.find((m) => m.id === id);
    expect(chosen).toBeDefined();
    expect(chosen!.availability).toBe('warm');
    expect(chosen!.availableOnPlan).toBe(true);
    for (const m of candidates) {
      if (m.availability === 'warm' && m.availableOnPlan) {
        expect(m.pricePerMTokOut).toBeGreaterThanOrEqual(chosen!.pricePerMTokOut);
      }
    }
  });

  it('falls back to a fixed tiny model id when nothing is eligible', () => {
    expect(cheapestAvailableModel([])).toBe('Qwen/Qwen3-0.6B');
  });
});
