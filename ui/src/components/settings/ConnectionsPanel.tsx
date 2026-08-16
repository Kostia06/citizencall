import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CATEGORIES, TOP_CATEGORIES, storeApi } from '../../api';
import type { AuthedFetch, Connection, ToolkitApp } from '../../api';
import ToolCustomizePanel from './ToolCustomizePanel';
import { entranceStandard, entranceStandardReduced } from '../../lib/motion';

const POPOVER_WIDTH = 224; // px — w-56, used to clamp the portal's fixed position on-screen

// Rendering all ~1,201 tiles at once would mount 1,201 <img> nodes and fire
// 1,201 simultaneous image loads — a real jank/memory cost for zero benefit,
// since a human can't usefully scan that many icons anyway. Search/category
// narrow the set; this cap applies after filtering, so it only ever bites on
// broad/empty queries and the count line says so explicitly.
const RENDER_CAP = 150;

/** Icon-only connect tile — app name lives in `title`/`aria-label` plus a CSS
 * hover tooltip, never as a visible label (grid requirement). Composio's own
 * hosted `logo` is the authoritative source for every app in the catalog, so
 * there's no clearbit/favicon fallback chain to walk — just a neutral
 * initials monogram if the logo itself 404s (offline demo, ad-blocker). */
function AppTile({
  app,
  connected,
  pending,
  active,
  onOpen,
}: {
  app: ToolkitApp;
  connected: boolean;
  pending: boolean;
  active: boolean;
  onOpen(slug: string, anchor: HTMLButtonElement): void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Show the initials monogram until the real logo has painted (or if it
  // 404s / is absent) — otherwise the img's own light backing renders as a
  // blank white square during load, which reads as "no app there" across a
  // grid of 150 tiles.
  const showMonogram = !app.logo || failed || !loaded;

  return (
    <div className="group relative">
      <button
        type="button"
        title={app.name}
        aria-label={connected ? `${app.name} — connected. Click to manage.` : `Connect ${app.name}`}
        aria-haspopup="dialog"
        disabled={pending}
        onClick={(e) => onOpen(app.slug, e.currentTarget)}
        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 disabled:opacity-40 ${
          connected
            ? `border-accent/70 bg-accent/10 shadow-glow-accent ${active ? 'ring-2 ring-accent/70' : ''}`
            : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.07]'
        }`}
      >
        {showMonogram && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-[9px] font-bold text-white/70">
              {app.name.slice(0, 2).toUpperCase()}
            </span>
          </span>
        )}
        {app.logo && !failed && (
          <img
            src={app.logo}
            alt=""
            aria-hidden
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`h-6 w-6 rounded-sm bg-paper object-contain p-0.5 transition-opacity duration-200 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {connected && (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold leading-none text-paper">
            ✓
          </span>
        )}
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-surface-raised px-2 py-1 text-[11px] text-white opacity-0 shadow-lift transition-opacity duration-150 group-hover:opacity-100">
        {app.name}
      </span>
    </div>
  );
}

/** Small confirm popover anchored to a tile — replaces the old
 * click-straight-to-OAuth / click-straight-to-panel behavior. Rendered via a
 * portal at `position: fixed` (computed from the tile's own bounding rect at
 * open time) rather than absolutely inside the grid, so it's never clipped
 * by the grid's `overflow-y-auto`/`max-h-80`. Esc closes; the primary action
 * is autofocused so Enter confirms it (native button behavior — no extra
 * keydown wiring needed). Closes automatically if the grid scrolls or the
 * window resizes, since a stale fixed-position rect would otherwise drift
 * away from the tile it's meant to anchor to. */
function ConnectPopover({
  app,
  connected,
  pending,
  anchorRect,
  onConnect,
  onDisconnect,
  onCustomize,
  onClose,
}: {
  app: ToolkitApp;
  connected: boolean;
  pending: boolean;
  anchorRect: DOMRect;
  onConnect(): void;
  onDisconnect(): void;
  onCustomize(): void;
  onClose(): void;
}) {
  const reduceMotion = !!useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2, 8 + POPOVER_WIDTH / 2),
    window.innerWidth - 8 - POPOVER_WIDTH / 2,
  );
  const top = anchorRect.bottom + 8;

  return createPortal(
    <>
      {/* Full-viewport transparent backdrop — the click-away-to-close
          surface; sits below the popover in stacking order. */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={connected ? `Manage ${app.name}` : `Connect ${app.name}`}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.96 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.96 }}
        transition={reduceMotion ? entranceStandardReduced : entranceStandard}
        style={{ position: 'fixed', left, top, transform: 'translateX(-50%)', width: POPOVER_WIDTH }}
        className="z-50 rounded-xl border border-white/10 bg-surface-raised/95 p-3 shadow-lift backdrop-blur-xl"
      >
        <div className="flex items-center gap-2">
          {app.logo && (
            <img src={app.logo} alt="" aria-hidden className="h-6 w-6 shrink-0 rounded-sm bg-paper object-contain p-0.5" />
          )}
          <p className="truncate text-[13px] font-medium text-white">{app.name}</p>
        </div>

        {connected ? (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-[11.5px] text-white/40">Connected</p>
            <button
              type="button"
              onClick={onCustomize}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-left text-[12.5px] text-white/70 transition-colors hover:border-white/25 hover:text-white"
            >
              Customize tools
            </button>
            <button
              type="button"
              autoFocus
              disabled={pending}
              onClick={onDisconnect}
              className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[12.5px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              {pending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[12.5px] text-white/50">Connect {app.name}?</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                autoFocus
                disabled={pending}
                onClick={onConnect}
                className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-paper transition-colors hover:bg-accent-bright disabled:opacity-50"
              >
                {pending ? 'Connecting…' : 'Connect'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-white/60 transition-colors hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>,
    document.body,
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11.5px] capitalize transition-colors duration-150 ${
        active
          ? 'border-accent/60 bg-accent/15 text-accent-bright'
          : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'
      }`}
    >
      {label}
    </button>
  );
}

/** Connections section — searchable icon-only grid over the full ~1,201-app
 * Composio catalog (web UI design spec §6, reworked for full-catalog scale).
 * Loads the toolkit list via `storeApi.toolkits()` (bundled catalog in MOCK
 * mode — store/apps.ts / composio-apps.json — or a live `/api/toolkits`
 * catalog), filters client-side by name/slug/category, and renders only the
 * top `RENDER_CAP` of the filtered set so the DOM never has to hold more
 * than ~150 tiles at once. Only the top 10 categories (by app count) get a
 * chip — the rest of the 82 are reachable by typing the category name into
 * search, or via the "browse all" select. Clicking ANY tile opens a small
 * `ConnectPopover` confirm dialog anchored to it — "Connect NAME?" for an
 * unconnected app, or app name + Disconnect + "Customize tools" for a
 * connected one — rather than acting immediately; a per-toolkit inline
 * "log in to connect" prompt still appears below the grid when the call
 * 401s. "Customize tools" opens `ToolCustomizePanel` (per-tool enable/
 * disable), which also hosts its own Disconnect action for parity with the
 * pre-popover flow. */
export default function ConnectionsPanel({
  connections,
  onConnect,
  onDisconnect,
  pendingToolkit,
  loginRequiredFor,
  authedFetch,
}: {
  connections: Connection[];
  onConnect(toolkit: string): void;
  onDisconnect(toolkit: string): void;
  pendingToolkit: string | null;
  loginRequiredFor: string | null;
  authedFetch: AuthedFetch;
}) {
  const [apps, setApps] = useState<ToolkitApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [customizeSlug, setCustomizeSlug] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ slug: string; anchorRect: DOMRect } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // A fixed-position popover computed from a snapshot rect goes stale the
  // moment the anchor moves — close it rather than let it drift away from
  // the tile it's meant to point at.
  useEffect(() => {
    if (!popover) return;
    const grid = gridRef.current;
    function close() {
      setPopover(null);
    }
    grid?.addEventListener('scroll', close);
    window.addEventListener('resize', close);
    return () => {
      grid?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [popover]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { toolkits } = await storeApi.toolkits();
      if (!cancelled) {
        setApps(toolkits);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedSlugs = useMemo(
    () => new Set(connections.filter((c) => c.status === 'active').map((c) => c.toolkit)),
    [connections],
  );

  const topCategories = TOP_CATEGORIES.length ? TOP_CATEGORIES : [];
  const allCategories = useMemo(() => {
    const fromApps = [...new Set(apps.map((a) => a.category))];
    return fromApps.length ? fromApps.sort() : CATEGORIES;
  }, [apps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((app) => {
      if (
        q &&
        !app.name.toLowerCase().includes(q) &&
        !app.slug.toLowerCase().includes(q) &&
        !app.category.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (category && app.category !== category) return false;
      return true;
    });
  }, [apps, query, category]);

  // Incremental rendering, not a hard wall — the old fixed 150-tile cap read
  // as "the catalog only has 150 apps" (reported live). A sentinel div at
  // the bottom of the grid raises the limit as it scrolls into view, so all
  // 1,200+ apps are reachable while the DOM still grows in steps.
  const [renderLimit, setRenderLimit] = useState(RENDER_CAP);
  useEffect(() => {
    setRenderLimit(RENDER_CAP); // narrowing/widening the filter restarts paging
  }, [query, category]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const canRenderMore = filtered.length > renderLimit;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canRenderMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setRenderLimit((l) => l + RENDER_CAP);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [canRenderMore]);
  const visible = canRenderMore ? filtered.slice(0, renderLimit) : filtered;

  // Connected apps get their own pinned section above the catalog — the
  // user must always SEE what's connected without hunting/searching for it
  // (and a connected app deep in the catalog past the render cap would
  // otherwise be invisible entirely).
  const connectedApps = useMemo(
    () => apps.filter((a) => connectedSlugs.has(a.slug)),
    [apps, connectedSlugs],
  );

  const loginRequiredApp = loginRequiredFor ? apps.find((a) => a.slug === loginRequiredFor) : undefined;
  const customizeApp = customizeSlug ? apps.find((a) => a.slug === customizeSlug) : undefined;
  const popoverApp = popover ? apps.find((a) => a.slug === popover.slug) : undefined;

  // Close the customize panel if its toolkit stops being connected — either
  // disconnected from inside the panel itself, or out-of-band (another tab,
  // focus refresh).
  useEffect(() => {
    if (customizeSlug && !connectedSlugs.has(customizeSlug)) setCustomizeSlug(null);
  }, [customizeSlug, connectedSlugs]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps or categories…"
          aria-label="Search apps by name or category"
          className="w-full max-w-xs rounded-lg border border-white/10 bg-surface-sunken px-3 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
        />
        <select
          value={category ?? ''}
          onChange={(e) => setCategory(e.target.value || null)}
          aria-label="Browse all categories"
          className="rounded-lg border border-white/10 bg-surface-sunken px-2 py-1.5 text-[12px] capitalize text-white/70 outline-none transition-colors focus:border-accent/60"
        >
          <option value="">All categories</option>
          {allCategories.map((c) => (
            <option key={c} value={c} className="capitalize">
              {c}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-white/35">
          {loading
            ? 'Loading…'
            : `${filtered.length === apps.length ? apps.length.toLocaleString() : `${filtered.length} of ${apps.length.toLocaleString()}`} apps · ${connectedSlugs.size} connected`}
        </span>
      </div>

      <p className="text-[11.5px] text-white/30">Click an app to connect it — click a connected app to manage it.</p>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip label="All" active={category === null} onClick={() => setCategory(null)} />
        {topCategories.map((c) => (
          <FilterChip key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? null : c)} />
        ))}
      </div>

      {!loading && connectedApps.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/35">
            Connected · {connectedApps.length}
          </div>
          <div className="flex flex-wrap gap-2.5 rounded-xl border border-accent/20 bg-accent/[0.04] p-2.5">
            {connectedApps.map((app) => (
              <AppTile
                key={`connected-${app.slug}`}
                app={app}
                connected
                pending={pendingToolkit === app.slug}
                active={popover?.slug === app.slug || customizeSlug === app.slug}
                onOpen={(slug, anchor) =>
                  setPopover((p) => (p?.slug === slug ? null : { slug, anchorRect: anchor.getBoundingClientRect() }))
                }
              />
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-wrap gap-2.5 py-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="h-11 w-11 shrink-0 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-[13px] text-white/35">No apps match your filters.</p>
      ) : (
        <div ref={gridRef} className="flex max-h-80 flex-wrap gap-2.5 overflow-y-auto py-1 pr-1">
          {visible.map((app) => (
            <AppTile
              key={app.slug}
              app={app}
              connected={connectedSlugs.has(app.slug)}
              pending={pendingToolkit === app.slug}
              active={popover?.slug === app.slug || customizeSlug === app.slug}
              onOpen={(slug, anchor) =>
                setPopover((p) => (p?.slug === slug ? null : { slug, anchorRect: anchor.getBoundingClientRect() }))
              }
            />
          ))}
          {canRenderMore && (
            <div ref={sentinelRef} className="flex w-full items-center justify-center py-2">
              <span className="text-[11px] text-white/25">
                Loading more… {visible.length.toLocaleString()} of {filtered.length.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {popoverApp && popover && (
          <ConnectPopover
            app={popoverApp}
            connected={connectedSlugs.has(popoverApp.slug)}
            pending={pendingToolkit === popoverApp.slug}
            anchorRect={popover.anchorRect}
            onConnect={() => {
              onConnect(popoverApp.slug);
              setPopover(null);
            }}
            onDisconnect={() => {
              onDisconnect(popoverApp.slug);
              setPopover(null);
            }}
            onCustomize={() => {
              setCustomizeSlug(popoverApp.slug);
              setPopover(null);
            }}
            onClose={() => setPopover(null)}
          />
        )}
      </AnimatePresence>

      {customizeApp && (
        <ToolCustomizePanel
          app={customizeApp}
          authedFetch={authedFetch}
          onClose={() => setCustomizeSlug(null)}
          onDisconnect={(slug) => {
            onDisconnect(slug);
            setCustomizeSlug(null);
          }}
          disconnectPending={pendingToolkit === customizeApp.slug}
        />
      )}

      {loginRequiredFor && (
        <p className="text-[12px] text-white/40">
          <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
            Log in
          </Link>{' '}
          to connect {loginRequiredApp?.name ?? loginRequiredFor}.
        </p>
      )}
    </div>
  );
}
