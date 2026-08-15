import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { verifyAccessToken } from './jwt';
import { authSecret } from './secret';

export type AuthVars = { authUserId?: string; authSessionId?: string; authEmailVerified?: boolean };

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
  // Dev bypass: only when explicitly enabled with the exact string 'true'
  // (never in production). Any other value — including the truthy strings
  // 'false'/'0' — must NOT bypass auth.
  if (c.env.DEV_AUTH_BYPASS === 'true') {
    const devUser = c.req.header('X-Dev-User');
    if (devUser) {
      c.set('authUserId', devUser);
      c.set('authSessionId', 'dev');
      c.set('authEmailVerified', true);
      return next();
    }
  }
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const claims = token ? await verifyAccessToken(authSecret(c.env), token) : null;
  if (!claims) return c.json({ error: 'Unauthorized.' }, 401);
  c.set('authUserId', claims.sub);
  c.set('authSessionId', claims.sid);
  c.set('authEmailVerified', claims.emailVerified);
  return next();
});

export const requireVerified = createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
  if (c.get('authEmailVerified') !== true) return c.json({ error: 'Email not verified.' }, 403);
  return next();
});
