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

const accounts = new Map<string, MockAccount>(); // keyed by lowercased email
let session: { userId: string; accessToken: string } | null = null;

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
      // Mock mode has no email provider — auto-verify so the demo isn't
      // blocked on a link that can never arrive. Verify.tsx still renders
      // and works for anyone who navigates there with a token.
      emailVerified: true,
      createdAt: Date.now(),
    };
    accounts.set(key, account);
    return { userId: account.id };
  },

  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const key = normalize(email);
    const account = accounts.get(key);
    if (!account || account.password !== password) {
      throw new Error('Invalid email or password');
    }
    const accessToken = makeToken('access');
    session = { userId: account.id, accessToken };
    return { accessToken, user: toAuthUser(account) };
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

  async verify(token: string): Promise<void> {
    if (!token) throw new Error('Missing verification token');
    // No real email round-trip in mock mode — accepting any non-empty token
    // lets the Verify screen demo its success state without a backend.
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
