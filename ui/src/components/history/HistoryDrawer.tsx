import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { SessionSummary } from '../../api';

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

/** Right-side slide-in drawer listing the actor's past sessions, newest
 * first (GET /api/sessions; in MOCK mode Bar passes this session's own
 * turns). Clicking a row hands its id to `onSelect`, which restores that
 * run read-only into the transcript. Backdrop click or Esc closes. */
export default function HistoryDrawer({
  open,
  sessions,
  loading,
  onSelect,
  onDelete,
  onClose,
}: {
  open: boolean;
  sessions: SessionSummary[];
  loading: boolean;
  onSelect(id: string): void;
  /** Permanently removes one past run from history. Absent in MOCK mode. */
  onDelete?(id: string): void;
  onClose(): void;
}) {
  const reduceMotion = useReducedMotion();
  // Global Esc while open — the drawer previously closed only when focus
  // happened to be inside it (audit PARTIAL).
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
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-30 bg-black/40"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="history-panel"
            role="dialog"
            aria-label="Past sessions"
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-white/10 bg-void/95 backdrop-blur"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">History</div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close history"
                className="rounded-lg px-2 py-1 text-[13px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {loading && <div className="px-2 py-6 text-center text-[12px] text-white/35">Loading…</div>}
              {!loading && sessions.length === 0 && (
                <div className="px-2 py-6 text-center text-[12px] text-white/35">
                  No past sessions yet — run something first.
                </div>
              )}
              {!loading &&
                sessions.map((s) => (
                  <div key={s.id} className="group relative mb-1">
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="block w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-white/10 hover:bg-white/[0.05]"
                    >
                      <div className="truncate pr-7 text-[13px] leading-snug text-white/80">{s.requestText}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/30">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status] ?? 'bg-white/30'}`} />
                        <span>{formatWhen(s.createdAt)}</span>
                        {s.totalCostUsd > 0 && (
                          <span>{s.totalCostUsd >= 0.01 ? `$${s.totalCostUsd.toFixed(2)}` : `$${s.totalCostUsd.toFixed(4)}`}</span>
                        )}
                      </div>
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        aria-label="Delete this session"
                        title="Delete this session"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(s.id);
                        }}
                        className="absolute right-2 top-2.5 hidden h-6 w-6 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/10 hover:text-white/80 group-hover:flex"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
