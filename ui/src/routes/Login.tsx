import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { authApi, AuthError } from '../api';
import { useAuth } from '../auth/useAuth';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-surface-sunken px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/60';

/** design spec §3 / §7: centered glass card, email + password, generic error
 * on bad credentials (mirrors the API's no-enumeration behavior). */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authApi.forgotPassword(email);
    } finally {
      setSubmitting(false);
      setForgotSent(true); // always show the generic confirmation — no enumeration
    }
  }

  if (mode === 'forgot') {
    return (
      <AuthCard title="Reset your password" subtitle="We'll email you a reset link if an account exists.">
        {forgotSent ? (
          <p className="text-[13px] text-white/60">If an account exists for that email, a reset link is on its way.</p>
        ) : (
          <form onSubmit={handleForgot} className="flex flex-col gap-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent px-3.5 py-2.5 text-[14px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              Send reset link
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setForgotSent(false);
          }}
          className="mt-4 text-[13px] text-white/40 transition-colors hover:text-white/70"
        >
          ← back to log in
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Log in">
      <form onSubmit={handleLogin} className="flex flex-col gap-3">
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
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-[13px] text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent px-3.5 py-2.5 text-[14px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <div className="mt-4 flex items-center justify-between text-[13px]">
        <button type="button" onClick={() => setMode('forgot')} className="text-white/40 transition-colors hover:text-white/70">
          Forgot password?
        </button>
        <Link to="/signup" className="text-accent-bright transition-colors hover:text-accent">
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}
