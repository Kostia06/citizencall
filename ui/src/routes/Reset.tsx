import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { authApi, AuthError } from '../api';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-surface-sunken px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/60';

const MIN_PASSWORD_LENGTH = 12;

/** Reads `?token=`, new-password form → `POST /auth/password/reset` —
 * design spec §3. A successful reset revokes all sessions server-side. */
export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'This link is invalid or has expired.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Reset password">
        <p className="text-[13px] text-red-400">This reset link is missing its token.</p>
        <Link to="/login" className="mt-4 inline-block text-[13px] text-accent-bright transition-colors hover:text-accent">
          Back to log in
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password reset" subtitle="You've been signed out everywhere for safety — log in again.">
        <Link to="/login" className="text-[13px] text-accent-bright transition-colors hover:text-accent">
          Go to log in →
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          required
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          placeholder="new password (min 12 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          required
          placeholder="confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-[13px] text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent px-3.5 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </AuthCard>
  );
}
