// Augments cloudflare:test's ProvidedEnv with our own Env shape so `env.DB`,
// `env.RUN`, etc. are typed inside test files without per-test casts.
import type { Env } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
