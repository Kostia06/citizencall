// Refresh token persistence — design spec §4: native keeps the refresh
// token in secure storage, never AsyncStorage/plain storage, and sends the
// access token as a bearer header. The access token itself stays in memory
// only (AuthContext state), never persisted.
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'understudy.refreshToken';

export const tokenStorage = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
