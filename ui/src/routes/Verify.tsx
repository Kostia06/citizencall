import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { authApi, AuthError } from '../api';

type State = 'verifying' | 'success' | 'failure';

/** Reads `?token=`, POSTs it to `/auth/verify`, shows success/failure —
 * design spec §3. */
export default function Verify() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<State>('verifying');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('failure');
      setMessage('This verification link is missing its token.');
      return;
    }
    let cancelled = false;
    authApi
      .verify(token)
      .then(() => {
        if (!cancelled) setState('success');
      })
      .catch((err) => {
        if (cancelled) return;
        setState('failure');
        setMessage(err instanceof AuthError ? err.message : 'This link is invalid or has expired.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthCard title="Email verification">
      {state === 'verifying' && <p className="text-[13px] text-white/50">Verifying…</p>}
      {state === 'success' && (
        <div>
          <p className="text-[13px] text-emerald-400">Your email is verified.</p>
          <Link to="/login" className="mt-4 inline-block text-[13px] text-accent-bright transition-colors hover:text-accent">
            Go to log in →
          </Link>
        </div>
      )}
      {state === 'failure' && (
        <div>
          <p className="text-[13px] text-red-400">{message}</p>
          <Link to="/login" className="mt-4 inline-block text-[13px] text-accent-bright transition-colors hover:text-accent">
            Back to log in
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
