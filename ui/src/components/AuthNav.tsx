import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

/** Initials for the avatar circle — first char of the local part, plus the
 * first char after a `.`/`_`/`-` separator if there is one (`kos.ilnkostia`
 * -> "KI"), else just one letter padded visually by the circle itself. */
function initials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts[1]?.[0];
  return (first + (second ?? '')).toUpperCase();
}

/** Top-nav auth affordance shared by every route via TopNav — anon gets a
 * "Log in" link; authed gets an avatar circle (initials) whose menu holds
 * settings / memory / log out. Email shows as the button's title (tooltip)
 * rather than inline text, keeping the nav compact on every breakpoint. */
export default function AuthNav() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (status === 'loading') return null;

  if (status !== 'authed' || !user) {
    return (
      <Link to="/login" className="text-ink/50 transition-colors hover:text-ink/80">
        Log in
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Account menu — ${user.email}`}
        aria-expanded={open}
        title={user.email}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-[11px] font-semibold text-accent-bright transition-colors hover:border-accent/60"
      >
        {initials(user.email)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 min-w-[11rem] rounded-lg border border-ink/10 bg-surface-raised/95 p-1 text-ink/70 shadow-lift backdrop-blur">
            <p className="truncate px-3 py-1.5 text-[11px] text-ink/35">{user.email}</p>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-1.5 text-[12px] transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              Settings
            </Link>
            <Link
              to="/memory"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-1.5 text-[12px] transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              Memory
            </Link>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await logout();
                navigate('/');
              }}
              className="block w-full rounded-md px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
