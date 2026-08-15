import { Link, useLocation } from 'react-router-dom';
import { MOCK } from '../api';
import AuthNav from './AuthNav';

const LINKS = [
  { to: '/roster', label: 'roster' },
  { to: '/benchmark', label: 'benchmark' },
  { to: '/settings', label: 'settings' },
];

/** Shared top nav — identical chrome on Bar, Roster, Benchmark, and
 * Settings. Left: brand, home. Right: roster/benchmark/settings (current
 * route highlighted), the MOCK badge when on, and the auth area (log in,
 * or the user's email + a Settings/Log out menu). Callers own their own
 * `mx-auto max-w-*` wrapper so nav width matches each page's content. */
export default function TopNav() {
  const location = useLocation();
  return (
    <nav className="flex items-center justify-between text-[11px] text-white/30">
      <Link to="/" className="font-medium transition-colors hover:text-white/70">
        understudy
      </Link>
      <div className="flex items-center gap-4">
        {MOCK && (
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent-bright">
            MOCK
          </span>
        )}
        {LINKS.map((link) => {
          const active = location.pathname === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              aria-current={active ? 'page' : undefined}
              className={`transition-colors hover:text-white/70 ${active ? 'text-white/80' : ''}`}
            >
              {link.label}
            </Link>
          );
        })}
        <AuthNav />
      </div>
    </nav>
  );
}
