// Devices & sessions — the signed-in user's active auth sessions
// (GET /auth/sessions), each revocable (DELETE /auth/sessions/:id), plus
// "Sign out everywhere" (POST /auth/logout-all, which also ends this
// session — the provider's logout() then clears local state).
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';

interface AuthSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  lastUsedAt: number;
}

/** "Mozilla/5.0 (Macintosh; …) Chrome/126…" → "Chrome · Mac" */
function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : 'Browser';
  const os = /Macintosh/.test(ua)
    ? 'Mac'
    : /Windows/.test(ua)
      ? 'Windows'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SessionsPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const { user, authedFetch, logout } = useAuth();
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    authedFetch('/auth/sessions')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const rows = (await res.json()) as AuthSession[];
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authedFetch, refreshToken]);

  if (!user) {
    return <p className="text-[12px] text-ink/35">Sign in to see and revoke your active sessions.</p>;
  }
  if (error) return <p className="text-[12px] text-ink/35">Could not load sessions.</p>;
  if (!sessions) return <p className="text-[12px] text-ink/35">Loading sessions…</p>;

  async function revoke(id: string) {
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    await authedFetch(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  async function signOutEverywhere() {
    await authedFetch('/auth/logout-all', { method: 'POST' }).catch(() => undefined);
    await logout();
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.length === 0 && <p className="text-[12px] text-ink/35">No active sessions.</p>}
      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink/80">{describeAgent(s.userAgent)}</p>
            <p className="mt-0.5 text-[11px] text-ink/35">
              {s.ip ?? 'unknown IP'} · last used {formatWhen(s.lastUsedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void revoke(s.id)}
            className="shrink-0 rounded-lg border border-ink/15 px-2.5 py-1 text-[11.5px] text-ink/55 transition-colors hover:border-red-400/50 hover:text-red-300"
          >
            Revoke
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => void signOutEverywhere()}
        className="mt-1 self-start rounded-lg border border-red-400/30 px-3 py-1.5 text-[12.5px] text-red-300/90 transition-colors hover:bg-red-400/10"
      >
        Sign out everywhere
      </button>
    </div>
  );
}
