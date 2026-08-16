import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MOCK } from '../api';
import AuthNav from './AuthNav';
import NotificationsBell from './notifications/NotificationsBell';

// Roster stays routable at /roster (judge-facing demo cold-open, linked from
// Benchmark) but is out of the everyday nav — Benchmark tells the same story.
const LINKS = [
  { to: '/benchmark', label: 'Benchmark' },
  { to: '/memory', label: 'Memory' },
  { to: '/settings', label: 'Settings' },
];

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Theme toggle removed — the app is dark-only by decision (lib/theme.ts).

/** Shared top nav — identical chrome on Bar, Roster, Benchmark, and
 * Settings. Left: brand, home. Right (wide): nav links with a clear active
 * state, the theme toggle, the MOCK badge (only when the build is actually
 * running in forced-mock mode), and the auth area. Narrow: links + theme
 * toggle collapse into a single menu button. Callers own their own
 * `mx-auto max-w-*` wrapper so nav width matches each page's content. */
export default function TopNav() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Esc closes the narrow-screen menu (audit PARTIAL).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <nav className="relative flex items-center justify-between text-[12px] text-ink/40">
      <Link to="/" className="shrink-0 font-semibold tracking-tight text-ink/70 transition-colors hover:text-ink">
        home
      </Link>

      {/* Right side. The bell lives OUTSIDE the two breakpoint containers so
          exactly one instance mounts — two would double-fetch and hold
          desynced unread badges (localStorage isn't reactive). */}
      <div className="flex items-center gap-2">
        <NotificationsBell />

        {/* Wide layout — links, theme toggle, MOCK badge, auth, all inline. */}
        <div className="hidden items-center gap-1 sm:flex">
          {LINKS.map((link) => {
            const active = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-3 py-1 transition-colors ${
                  active ? 'bg-ink/10 text-ink' : 'text-ink/45 hover:bg-ink/5 hover:text-ink/80'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <div className="ml-2 flex items-center gap-3">
            {/* dark-only */}
            {MOCK && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent-bright">
                MOCK
              </span>
            )}
            <AuthNav />
          </div>
        </div>

        {/* Narrow layout — everything behind one menu button. */}
        <div className="flex items-center gap-2 sm:hidden">
          {MOCK && (
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent-bright">
              MOCK
            </span>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/10 text-ink/60 transition-colors hover:border-accent/40 hover:text-ink"
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30 sm:hidden" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-10 z-40 flex w-56 flex-col gap-1 rounded-xl border border-ink/10 bg-surface-raised/95 p-2 shadow-lift backdrop-blur sm:hidden">
            {LINKS.map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2 text-[13px] transition-colors ${
                    active ? 'bg-ink/10 text-ink' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="my-1 h-px bg-ink/10" />
            <div className="px-1 pt-1">
              <AuthNav />
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
