import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { AuthError } from '../api';
import { useAuth } from '../auth/useAuth';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-surface-sunken px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/60';

const MIN_PASSWORD_LENGTH = 12; // NIST 800-63B alignment — auth-foundation spec §3

/** Signup creates an unverified user (201 `{userId}`) — it does NOT log the
 * user in. design spec §3. */
export default function Signup() {
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
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
      await signup(email, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not create your account. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Check your email" subtitle="We sent a verification link — click it, then log in.">
        <Link to="/login" className="text-[13px] text-accent-bright transition-colors hover:text-accent">
          Go to log in →
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          placeholder="password (min 12 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          required
          placeholder="confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-[13px] text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent px-3.5 py-2.5 text-[14px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-[13px] text-white/40">
        Already have an account?{' '}
        <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
