// Auth types mirrored from the `/auth/*` contract —
// docs/superpowers/specs/2026-08-14-auth-foundation-design.md §6. `user`
// objects never carry the password hash or refresh token.
export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: number;
}

export type AuthStatus = 'anon' | 'authed' | 'loading';
