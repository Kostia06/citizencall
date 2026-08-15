// Mirrored from ui/src/auth/types.ts —
// docs/superpowers/specs/2026-08-14-auth-foundation-design.md §6.
export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: number;
}

export type AuthStatus = 'anon' | 'authed' | 'loading';

/** Native transport (design spec §4): both tokens travel in the JSON body,
 * no cookies. Web's equivalent only returns `accessToken` since the refresh
 * token rides a `__Host-` cookie instead. */
export interface NativeAuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
