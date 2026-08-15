import { SignJWT, jwtVerify } from 'jose';

export type AccessClaims = { sub: string; sid: string; emailVerified: boolean };
const ACCESS_TTL = '15m';

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, emailVerified: claims.emailVerified })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(key(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid, emailVerified: payload.emailVerified === true };
  } catch {
    return null;
  }
}
