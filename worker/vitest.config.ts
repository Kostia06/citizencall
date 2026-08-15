import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Bindings are declared inline (not via wrangler: { configPath }) because the
// wrangler version vendored inside @cloudflare/vitest-pool-workers is older
// than our own and rejects wrangler.jsonc's array-form `run_worker_first`
// (SPEC.md §13 — required as an array for the /api/* + /oauth/* fix, not
// negotiable). This mirrors wrangler.jsonc's runtime config without parsing
// the file that trips that unrelated schema check.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: './src/index.ts',
        miniflare: {
          compatibilityDate: '2025-08-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          durableObjects: { RUN: 'RunDO' },
          bindings: { DEMO_USERS: 'demo_kos,demo_teammate' },
        },
      },
    },
  },
});
