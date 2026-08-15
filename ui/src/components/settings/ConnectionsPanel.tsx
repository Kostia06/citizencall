import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, TOP_CATEGORIES, storeApi } from '../../api';
import type { Connection, ToolkitApp } from '../../api';

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
  onConnect,
  onDisconnect,
}: {
  app: ToolkitApp;
  connected: boolean;
  pending: boolean;
  onConnect(slug: string): void;
  onDisconnect(slug: string): void;
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
        aria-label={connected ? `${app.name} — connected. Click to disconnect.` : `Connect ${app.name}`}
        disabled={pending}
        onClick={() => (connected ? onDisconnect(app.slug) : onConnect(app.slug))}
        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 disabled:opacity-40 ${
          connected
            ? 'border-accent/70 bg-accent/10 shadow-glow-accent'
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
            className={`h-6 w-6 rounded-sm bg-white/95 object-contain p-0.5 transition-opacity duration-200 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {connected && (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold leading-none text-black">
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
 * search, or via the "browse all" select. Connect/disconnect wiring is
 * unchanged — a per-toolkit inline "log in to connect" prompt still appears
 * when the call 401s. */
export default function ConnectionsPanel({
  connections,
  onConnect,
  onDisconnect,
  pendingToolkit,
  loginRequiredFor,
}: {
  connections: Connection[];
  onConnect(toolkit: string): void;
  onDisconnect(toolkit: string): void;
  pendingToolkit: string | null;
  loginRequiredFor: string | null;
}) {
  const [apps, setApps] = useState<ToolkitApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

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

  const capped = filtered.length > RENDER_CAP;
  const visible = capped ? filtered.slice(0, RENDER_CAP) : filtered;

  const loginRequiredApp = loginRequiredFor ? apps.find((a) => a.slug === loginRequiredFor) : undefined;

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
            : capped
              ? `${apps.length.toLocaleString()} apps · showing ${RENDER_CAP} · connected ${connectedSlugs.size} — refine search to see more`
              : `${filtered.length === apps.length ? apps.length.toLocaleString() : `${filtered.length} of ${apps.length.toLocaleString()}`} apps · ${connectedSlugs.size} connected`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip label="All" active={category === null} onClick={() => setCategory(null)} />
        {topCategories.map((c) => (
          <FilterChip key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? null : c)} />
        ))}
      </div>

      {loading ? (
        <div className="flex flex-wrap gap-2.5 py-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="h-11 w-11 shrink-0 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-[13px] text-white/35">No apps match your filters.</p>
      ) : (
        <div className="flex max-h-80 flex-wrap gap-2.5 overflow-y-auto py-1 pr-1">
          {visible.map((app) => (
            <AppTile
              key={app.slug}
              app={app}
              connected={connectedSlugs.has(app.slug)}
              pending={pendingToolkit === app.slug}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
            />
          ))}
        </div>
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
