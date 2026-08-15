import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

/** Top-nav auth affordance shared by Bar/Roster/Benchmark — design spec §3:
 * a "Log in" link when anon; when authed, the user's email + a menu with
 * "Log out" and a placeholder "Settings" link (the `/settings` route itself
 * is a later slice — the link is included per the task's either-or call,
 * since a stale link just renders nothing rather than erroring). */
export default function AuthNav() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (status === 'loading') return null;

  if (status !== 'authed' || !user) {
    return (
      <Link to="/login" className="transition-colors hover:text-white/70">
        Log in
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="max-w-[14ch] truncate transition-colors hover:text-white/70"
        title={user.email}
      >
        {user.email}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-20 min-w-[9rem] rounded-lg border border-white/10 bg-surface-raised/95 p-1 text-white/70 shadow-lift backdrop-blur">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-1.5 text-[12px] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Settings
            </Link>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await logout();
                navigate('/');
              }}
              className="block w-full rounded-md px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
