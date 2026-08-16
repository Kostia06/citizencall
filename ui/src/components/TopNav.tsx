import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MOCK } from '../api';
import { useAuth } from '../auth/useAuth';
import { useTheme } from '../lib/theme';
import AuthNav from './AuthNav';

// Roster stays routable at /roster (judge-facing demo cold-open, linked from
// Benchmark) but is out of the everyday nav — Benchmark tells the same story.
const LINKS = [
  { to: '/benchmark', label: 'Benchmark' },
  { to: '/memory', label: 'Memory' },
  { to: '/settings', label: 'Settings' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path
        strokeLinecap="round"
        d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M20.4 14.7A8.6 8.6 0 1 1 9.3 3.6a7 7 0 0 0 11.1 11.1Z" />
    </svg>
  );
}

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

/** Sun/moon theme toggle — dark/light mode slice. Lives in the nav so it's
 * reachable from every page; `useTheme` is the whole controller, this is
 * just the button. */
function ThemeToggle({ className = '' }: { className?: string }) {
  const { authedFetch } = useAuth();
  const { theme, toggleTheme } = useTheme(authedFetch);
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/10 text-ink/50 transition-colors duration-200 hover:border-accent/40 hover:text-ink/80 ${className}`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

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
          <ThemeToggle />
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
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[12px] text-ink/50">Theme</span>
              <ThemeToggle />
            </div>
            <div className="px-1 pt-1">
              <AuthNav />
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
