// In-memory auth stub — keeps the SPA fully demoable with no backend
// (MOCK mode, or the real Worker being unreachable). State lives only for
// the page's lifetime: a reload starts fresh, matching "session restored
// via refresh cookie" being unavailable without a real server. See
// docs/superpowers/specs/2026-08-14-web-ui-design.md §4.
import type { AuthUser } from './types';

interface MockAccount {
  id: string;
  email: string;
  password: string;
  emailVerified: boolean;
  createdAt: number;
}

interface MockChallenge {
  userId: string;
  code: string;
}

const accounts = new Map<string, MockAccount>(); // keyed by lowercased email
const challenges = new Map<string, MockChallenge>(); // keyed by challengeId
let session: { userId: string; accessToken: string } | null = null;

// Fixed so MOCK mode is demoable without an inbox — every mock login goes
// through a 2FA challenge (mirrors an account with 2FA enabled), and the
// devCode surfaces in the UI's dev-hint chip so the flow completes without
// a real email.
const MOCK_2FA_CODE = '000000';

function makeToken(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toAuthUser(account: MockAccount): AuthUser {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.emailVerified,
    createdAt: account.createdAt,
  };
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export const mockAuthStore = {
  async signup(email: string, password: string): Promise<{ userId: string }> {
    const key = normalize(email);
    const existing = accounts.get(key);
    if (existing) return { userId: existing.id };
    const account: MockAccount = {
      id: makeToken('user'),
      email: key,
      password,
      // There's no confirmation step at all now — accounts are verified
      // on creation and signup logs the user straight in.
      emailVerified: true,
      createdAt: Date.now(),
    };
    accounts.set(key, account);
    return { userId: account.id };
  },

  async login(
    email: string,
    password: string,
  ): Promise<{ requires2fa: true; challengeId: string; devCode: string }> {
    const key = normalize(email);
    const account = accounts.get(key);
    if (!account || account.password !== password) {
      throw new Error('Invalid email or password');
    }
    const challengeId = makeToken('2fa');
    challenges.set(challengeId, { userId: account.id, code: MOCK_2FA_CODE });
    return { requires2fa: true, challengeId, devCode: MOCK_2FA_CODE };
  },

  async verify2fa(challengeId: string, code: string): Promise<{ accessToken: string; user: AuthUser }> {
    const challenge = challenges.get(challengeId);
    if (!challenge) throw new Error('That code has expired — request a new one.');
    if (code !== challenge.code) throw new Error('Incorrect code');
    const account = [...accounts.values()].find((a) => a.id === challenge.userId);
    if (!account) throw new Error('Account not found');
    challenges.delete(challengeId);
    const accessToken = makeToken('access');
    session = { userId: account.id, accessToken };
    return { accessToken, user: toAuthUser(account) };
  },

  async resend2fa(challengeId: string): Promise<{ ok: true; retryAfterSec: number }> {
    if (!challenges.has(challengeId)) throw new Error('That code has expired — request a new one.');
    return { ok: true, retryAfterSec: 30 };
  },

  async refresh(): Promise<{ accessToken: string; user: AuthUser } | null> {
    if (!session) return null;
    const account = [...accounts.values()].find((a) => a.id === session?.userId);
    if (!account) {
      session = null;
      return null;
    }
    const accessToken = makeToken('access');
    session = { userId: account.id, accessToken };
    return { accessToken, user: toAuthUser(account) };
  },

  async logout(): Promise<void> {
    session = null;
  },

  async forgotPassword(_email: string): Promise<void> {
    // Real endpoint is always-200 generic; mock mirrors that, no-op.
  },

  async resetPassword(token: string, password: string): Promise<void> {
    if (!token) throw new Error('Missing reset token');
    if (password.length < 12) throw new Error('Password must be at least 12 characters');
    // Mock mode has no token→account mapping (no email was ever sent); if a
    // session is active, reset that account's password so the flow is
    // exercisable end to end.
    if (session) {
      const account = [...accounts.values()].find((a) => a.id === session?.userId);
      if (account) account.password = password;
    }
  },
};
