import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, storeApi } from '../../api';
import type { Connection, ToolkitApp } from '../../api';

/** Icon-only connect tile — app name lives in `title`/`aria-label` plus a
 * CSS hover tooltip, never as a visible label (grid requirement). Tries the
 * Simple Icons brand mark first, falls back to the Clearbit logo if that
 * 404s, and finally falls back to a neutral initials monogram (no color) if
 * both image sources fail (offline demo, ad-blocker, unlisted brand). */
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
  const [iconStage, setIconStage] = useState<'icon' | 'logo' | 'fallback'>('icon');

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
        {iconStage === 'fallback' ? (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-[9px] font-bold text-white/70"
            aria-hidden
          >
            {app.name.slice(0, 2).toUpperCase()}
          </span>
        ) : (
          <img
            src={iconStage === 'icon' ? app.icon : app.logo}
            alt=""
            aria-hidden
            loading="lazy"
            onError={() => setIconStage((stage) => (stage === 'icon' ? 'logo' : 'fallback'))}
            className="h-6 w-6 rounded-sm bg-white/95 object-contain p-0.5"
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
      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors duration-150 ${
        active
          ? 'border-accent/60 bg-accent/15 text-accent-bright'
          : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'
      }`}
    >
      {label}
    </button>
  );
}

/** Connections section — searchable icon-only grid of 100+ apps (web UI
 * design spec §6, reworked). Loads the toolkit catalog via
 * `storeApi.toolkits()` (bundled 100+ app list in MOCK mode — store/apps.ts
 * — or a live `/api/toolkits` catalog), filters client-side by name/slug and
 * category. Connect/disconnect wiring is unchanged from before — a
 * per-toolkit inline "log in to connect" prompt still appears when the call
 * 401s. */
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

  const categories = useMemo(() => {
    const fromApps = [...new Set(apps.map((a) => a.category))];
    return fromApps.length ? fromApps.sort() : CATEGORIES;
  }, [apps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((app) => {
      if (q && !app.name.toLowerCase().includes(q) && !app.slug.toLowerCase().includes(q)) return false;
      if (category && app.category !== category) return false;
      return true;
    });
  }, [apps, query, category]);

  const loginRequiredApp = loginRequiredFor ? apps.find((a) => a.slug === loginRequiredFor) : undefined;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          aria-label="Search apps by name"
          className="w-full max-w-xs rounded-lg border border-white/10 bg-surface-sunken px-3 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
        />
        <span className="text-[11.5px] text-white/35">
          {loading
            ? 'Loading…'
            : `${filtered.length === apps.length ? apps.length : `${filtered.length} of ${apps.length}`} apps · ${connectedSlugs.size} connected`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip label="All" active={category === null} onClick={() => setCategory(null)} />
        {categories.map((c) => (
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
          {filtered.map((app) => (
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
