import { expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../../src/auth/jwt';

const SECRET = 'test-secret-value-at-least-32-bytes-long!!';

it('signs and verifies an access token', async () => {
  const token = await signAccessToken(SECRET, { sub: 'u1', sid: 's1', emailVerified: true });
  const claims = await verifyAccessToken(SECRET, token);
  expect(claims).toMatchObject({ sub: 'u1', sid: 's1', emailVerified: true });
});

it('rejects a token signed with a different secret', async () => {
  const token = await signAccessToken(SECRET, { sub: 'u1', sid: 's1', emailVerified: false });
  expect(await verifyAccessToken('a-totally-different-secret-value-32b!!', token)).toBeNull();
});

it('rejects a garbage token', async () => {
  expect(await verifyAccessToken(SECRET, 'not.a.jwt')).toBeNull();
});
