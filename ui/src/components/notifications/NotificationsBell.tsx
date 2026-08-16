import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storeApi, type NotificationSummary } from '../../api';
import { useAuth } from '../../auth/useAuth';
import NotificationsDrawer from './NotificationsDrawer';

/** localStorage key for the newest-notification timestamp the user has seen.
 * Rows newer than it are "unread": they badge the bell and dot their drawer
 * row. Opening the drawer marks everything seen. */
const SEEN_KEY = 'understudy:notifSeen';

function readSeen(): number {
  const raw = Number(localStorage.getItem(SEEN_KEY));
  return Number.isFinite(raw) ? raw : 0;
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.5 19a1.8 1.8 0 0 0 3 0"
      />
    </svg>
  );
}

/** Bell button + drawer for routine-run notifications (TopNav). Fetches the
 * feed on mount for the badge count, refetches on open, and deep-links a
 * clicked row to `/?restore=<runId>` — Bar.tsx's useRestoreParam hook picks
 * that up and restores the run as a session in the home transcript. */
export default function NotificationsBell() {
  const { authedFetch } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSeen, setLastSeen] = useState(readSeen);
  // Snapshot of lastSeen taken as the drawer opens, so rows keep their
  // unread dots for the viewing that just marked them seen.
  const [seenBefore, setSeenBefore] = useState(lastSeen);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await storeApi.listNotifications(authedFetch));
    } catch {
      // Badge is best-effort chrome — never surface a fetch error here.
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void refresh();
    // Live indicator (user request 2026-08-16): a routine finishing while the
    // page sits open must light the badge on its own — the cron sweep runs
    // every 15 min, so a 60s poll notices within a minute of the run landing.
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const unread = items.filter((n) => n.createdAt > lastSeen).length;

  const openDrawer = () => {
    setSeenBefore(lastSeen);
    setOpen(true);
    void refresh();
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setLastSeen(now);
  };

  const handleSelect = (runId: string) => {
    setOpen(false);
    navigate(`/?restore=${encodeURIComponent(runId)}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDrawer())}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-ink/10 text-ink/60 transition-colors hover:border-accent/40 hover:text-ink"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-void">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <NotificationsDrawer
        open={open}
        items={items}
        loading={loading}
        seenBefore={seenBefore}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
