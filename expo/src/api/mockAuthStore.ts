// Ported from ui/src/auth/mockAuthStore.ts — in-memory auth stub so the app
// is fully demoable with no backend (MOCK mode, or the Worker being
// unreachable). Extended with a mock refresh token, since native's token
// contract (design spec §4) carries both tokens in the body, not a cookie.
import type { AuthUser } from '../types/auth';

interface MockAccount {
  id: string;
  email: string;
  password: string;
  emailVerified: boolean;
  createdAt: number;
}

const accounts = new Map<string, MockAccount>();
const sessionsByRefreshToken = new Map<string, string>(); // refreshToken -> userId

function makeToken(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toAuthUser(account: MockAccount): AuthUser {
  return { id: account.id, email: account.email, emailVerified: account.emailVerified, createdAt: account.createdAt };
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function startSession(account: MockAccount): { accessToken: string; refreshToken: string; user: AuthUser } {
  const accessToken = makeToken('access');
  const refreshToken = makeToken('refresh');
  sessionsByRefreshToken.set(refreshToken, account.id);
  return { accessToken, refreshToken, user: toAuthUser(account) };
}

export const mockAuthStore = {
  async signup(email: string, password: string): Promise<{ userId: string }> {
    const key = normalize(email);
    const existing = accounts.get(key);
    if (existing) return { userId: existing.id };
    const account: MockAccount = { id: makeToken('user'), email: key, password, emailVerified: true, createdAt: Date.now() };
    accounts.set(key, account);
    return { userId: account.id };
  },

  async login(email: string, password: string) {
    const key = normalize(email);
    const account = accounts.get(key);
    if (!account || account.password !== password) throw new Error('Invalid email or password');
    return startSession(account);
  },

  /** Native has no cookie to fall back on — refresh always needs the
   * caller's stored refresh token explicitly. Returns null on an unknown or
   * already-consumed token (rotation semantics, design spec §4). */
  async refresh(refreshToken: string | null) {
    if (!refreshToken) return null;
    const userId = sessionsByRefreshToken.get(refreshToken);
    if (!userId) return null;
    const account = [...accounts.values()].find((a) => a.id === userId);
    if (!account) return null;
    sessionsByRefreshToken.delete(refreshToken); // rotate: old token dies
    return startSession(account);
  },

  async logout(refreshToken: string | null): Promise<void> {
    if (refreshToken) sessionsByRefreshToken.delete(refreshToken);
  },
};
