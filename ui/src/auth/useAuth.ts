import { useContext } from 'react';
import { AuthContext } from './AuthProvider';
import type { AuthContextValue } from './AuthProvider';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
