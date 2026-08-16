import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { authApi, AuthError } from '../api';
import { useAuth } from '../auth/useAuth';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-surface-sunken px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/60';

const CODE_LENGTH = 6;

/** Six individual digit boxes — auto-advance on input, backspace steps back,
 * a paste of the full code splits across all boxes, and filling the last box
 * fires `onComplete`. `resetSignal` bumping (a failed attempt) refocuses box
 * 0 — also covers the initial autofocus on mount, since it fires on mount
 * too. */
function CodeDigits({
  digits,
  onChange,
  onComplete,
  error,
  disabled,
  resetSignal,
}: {
  digits: string[];
  onChange(next: string[]): void;
  onComplete(code: string): void;
  error: boolean;
  disabled: boolean;
  resetSignal: number;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    boxes.current[0]?.focus();
  }, [resetSignal]);

  function setDigit(i: number, raw: string) {
    const char = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = char;
    onChange(next);
    if (char && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
    if (next.every((d) => d)) onComplete(next.join(''));
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = Array.from({ length: CODE_LENGTH }, (_, i) => text[i] ?? '');
    onChange(next);
    boxes.current[Math.max(Math.min(text.length, CODE_LENGTH) - 1, 0)]?.focus();
    if (text.length === CODE_LENGTH) onComplete(text);
  }

  return (
    <div className={`flex justify-between gap-2 ${error ? 'animate-shake-glow' : ''}`} role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
          value={d}
          disabled={disabled}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="h-12 w-11 rounded-lg border border-white/10 bg-surface-sunken text-center text-[18px] font-medium text-white outline-none transition-colors focus:border-accent/60 disabled:opacity-50"
        />
      ))}
    </div>
  );
}

/** design spec §3 / §7: centered glass card, email + password, generic error
 * on bad credentials (mirrors the API's no-enumeration behavior). A 2FA
 * challenge swaps the card into a "Check your email" code step rather than
 * routing to a separate page — same glass-card aesthetic throughout. */
export default function Login() {
  const { login, verify2fa, resend2fa } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // 2FA step
  // A signup that couldn't auto-verify (production email flow) hands its
  // challenge over via router state — land directly on the code step.
  const location = useLocation();
  const handedOff = (location.state ?? null) as { pending2fa?: { challengeId: string; devCode?: string }; email?: string } | null;
  const [challengeId, setChallengeId] = useState<string | null>(handedOff?.pending2fa?.challengeId ?? null);
  const [devCode, setDevCode] = useState<string | null>(handedOff?.pending2fa?.devCode ?? null);
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [codeAttempt, setCodeAttempt] = useState(0); // bumped on wrong-code to refocus box 0
  const [codeError, setCodeError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldown]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result && 'requires2fa' in result) {
        setChallengeId(result.challengeId);
        setDevCode(result.devCode ?? null);
        setDigits(Array(CODE_LENGTH).fill(''));
        setCodeError(false);
        setCodeAttempt((n) => n + 1);
        setResendCooldown(30);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode(code: string) {
    if (!challengeId || verifying) return;
    setVerifying(true);
    setCodeError(false);
    try {
      await verify2fa(challengeId, code);
      navigate('/');
    } catch {
      setCodeError(true);
      setDigits(Array(CODE_LENGTH).fill(''));
      setCodeAttempt((n) => n + 1);
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!challengeId || resendCooldown > 0 || resending) return;
    setResending(true);
    try {
      const { retryAfterSec } = await resend2fa(challengeId);
      setResendCooldown(retryAfterSec);
    } catch {
      setError('Could not resend the code — try again.');
    } finally {
      setResending(false);
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
              className="rounded-lg bg-accent px-3.5 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-accent-bright disabled:opacity-50"
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

  if (challengeId) {
    return (
      <AuthCard title="Check your email" subtitle={`Enter the 6-digit code we sent${email ? ` to ${email}` : ''}.`}>
        <div className="flex flex-col gap-4">
          <CodeDigits
            digits={digits}
            onChange={setDigits}
            onComplete={submitCode}
            error={codeError}
            disabled={verifying}
            resetSignal={codeAttempt}
          />
          {codeError && <p className="text-[13px] text-red-400">Incorrect code — try again.</p>}
          {verifying && <p className="text-[12px] text-white/40">Verifying…</p>}
          {devCode && (
            <span className="self-start rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent-bright">
              Dev code: {devCode}
            </span>
          )}
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || resending}
            className="text-[13px] text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
          >
            {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : resending ? 'Resending…' : 'Resend code'}
          </button>
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          <button
            type="button"
            onClick={() => {
              setChallengeId(null);
              setDevCode(null);
              setError(null);
            }}
            className="text-[13px] text-white/40 transition-colors hover:text-white/70"
          >
            ← back to log in
          </button>
        </div>
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
          className="rounded-lg bg-accent px-3.5 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-accent-bright disabled:opacity-50"
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
