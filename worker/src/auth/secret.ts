import type { Env } from '../env';

// Fail closed: never sign or verify a token with a public, well-known
// default. A missing AUTH_JWT_SECRET must break auth loudly, not silently
// downgrade to a forgeable constant.
export function authSecret(env: Env): string {
  const s = env.AUTH_JWT_SECRET;
  if (typeof s === 'string' && s.length > 0) return s;
  throw new Error('AUTH_JWT_SECRET is not set — refusing to sign/verify tokens with a default.');
}
