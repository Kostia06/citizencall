import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { NotificationSummary } from '../../api';

function formatWhen(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_DOT: Record<string, string> = {
  done: 'bg-emerald-400/70',
  error: 'bg-red-400/70',
  running: 'bg-accent/80 animate-pulse',
};

/** Right-side slide-in drawer (same shell as history/HistoryDrawer.tsx)
 * listing routine-triggered runs from GET /api/notifications, newest first.
 * `seenBefore` is the lastSeen timestamp SNAPSHOT taken when the drawer
 * opened — rows newer than it keep their unread dot for this viewing even
 * though opening already marked everything seen. Clicking a row hands its
 * runId to `onSelect`, which deep-links into that run as a session. */
export default function NotificationsDrawer({
  open,
  items,
  loading,
  seenBefore,
  onSelect,
  onClose,
}: {
  open: boolean;
  items: NotificationSummary[];
  loading: boolean;
  seenBefore: number;
  onSelect(runId: string): void;
  onClose(): void;
}) {
  const reduceMotion = useReducedMotion();
  // Global Esc while open — mirrors HistoryDrawer (audit PARTIAL there).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="notif-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-30 bg-black/40"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="notif-panel"
            role="dialog"
            aria-label="Routine notifications"
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-white/10 bg-void/95 backdrop-blur"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Notifications</div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close notifications"
                className="rounded-lg px-2 py-1 text-[13px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {loading && <div className="px-2 py-6 text-center text-[12px] text-white/35">Loading…</div>}
              {!loading && items.length === 0 && (
                <div className="px-2 py-6 text-center text-[12px] text-white/35">
                  Nothing yet — scheduled routines will report their runs here.
                </div>
              )}
              {!loading &&
                items.map((n) => {
                  const unread = n.createdAt > seenBefore;
                  return (
                    <button
                      key={n.runId}
                      type="button"
                      onClick={() => onSelect(n.runId)}
                      className="mb-1 block w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-white/10 hover:bg-white/[0.05]"
                    >
                      <div className="flex items-center gap-2">
                        {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                        <span className="truncate text-[13px] leading-snug text-white/80">{n.routineName}</span>
                      </div>
                      {n.answerPreview && (
                        <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/45">{n.answerPreview}</div>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/30">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[n.status] ?? 'bg-white/30'}`} />
                        <span>{formatWhen(n.createdAt)}</span>
                        {n.totalCostUsd > 0 && (
                          <span>{n.totalCostUsd >= 0.01 ? `$${n.totalCostUsd.toFixed(2)}` : `$${n.totalCostUsd.toFixed(4)}`}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
