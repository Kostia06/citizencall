import { mockAuthStore } from '../src/api/mockAuthStore';

describe('mockAuthStore', () => {
  it('signs up and logs in with matching credentials', async () => {
    const email = `user-${Date.now()}@example.com`;
    await mockAuthStore.signup(email, 'a-strong-password');
    const session = await mockAuthStore.login(email, 'a-strong-password');
    expect(session.user.email).toBe(email.toLowerCase());
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
  });

  it('rejects login with the wrong password', async () => {
    const email = `user-${Date.now()}@example.com`;
    await mockAuthStore.signup(email, 'a-strong-password');
    await expect(mockAuthStore.login(email, 'wrong-password')).rejects.toThrow();
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const email = `user-${Date.now()}@example.com`;
    await mockAuthStore.signup(email, 'a-strong-password');
    const first = await mockAuthStore.login(email, 'a-strong-password');

    const refreshed = await mockAuthStore.refresh(first.refreshToken);
    expect(refreshed?.user.email).toBe(email.toLowerCase());
    expect(refreshed?.refreshToken).not.toBe(first.refreshToken);

    // presenting the already-rotated token again fails, mirroring the
    // reuse-detection contract in the auth design spec §4.
    const reused = await mockAuthStore.refresh(first.refreshToken);
    expect(reused).toBeNull();
  });

  it('returns null refreshing with no token', async () => {
    await expect(mockAuthStore.refresh(null)).resolves.toBeNull();
  });

  it('invalidates the session on logout', async () => {
    const email = `user-${Date.now()}@example.com`;
    await mockAuthStore.signup(email, 'a-strong-password');
    const session = await mockAuthStore.login(email, 'a-strong-password');
    await mockAuthStore.logout(session.refreshToken);
    await expect(mockAuthStore.refresh(session.refreshToken)).resolves.toBeNull();
  });
});
