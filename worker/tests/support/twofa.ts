// Test helper: complete the full login → 2FA-verify flow. The vitest env has
// no RESEND_API_KEY, so /auth/login exposes devCode and the second step can
// be driven without a mailbox.
import { expect } from 'vitest';

type App = { request: (path: string, init?: any, env?: any) => Promise<Response> | Response };

export const jsonInit = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/**
 * Logs in through the 2FA challenge. Returns the challenge body from
 * /auth/login plus the token-issuing /auth/2fa/verify response (`res`) and
 * its parsed body — the shape existing tests used to get from /auth/login.
 */
export async function twofaLogin(
  app: App,
  env: unknown,
  email: string,
  password: string,
  headers: Record<string, string> = {}
) {
  const login = await app.request('/auth/login', jsonInit({ email, password }, headers), env);
  expect(login.status).toBe(200);
  const challenge = (await login.json()) as any;
  expect(challenge.requires2fa).toBe(true);
  const res = await app.request(
    '/auth/2fa/verify',
    jsonInit({ challengeId: challenge.challengeId, code: challenge.devCode }, headers),
    env
  );
  expect(res.status).toBe(200);
  return { login, challenge, res, body: (await res.json()) as any };
}
