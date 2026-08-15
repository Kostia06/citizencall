import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthError, storeApi } from '../../api';
import type { AuthedFetch, ToolkitApp } from '../../api';
import { ALL_TOOLS_SENTINEL, STATIC_TOOLS } from '../../store/toolCatalog';

function Toggle({ on, onClick, label }: { on: boolean; onClick(): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-white/10'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function toolLabel(tool: string): string {
  return tool === ALL_TOOLS_SENTINEL ? 'All tools' : tool.replace(/_/g, ' ');
}

/** Per-app tool customization — opens when a connected tile is clicked
 * (ConnectionsPanel). Shows enable/disable switches for that toolkit's
 * tools, backed by `storeApi.{list,set}ToolOverride` (`user_tools`, default-
 * on unless a row says otherwise). Toolkits with a known tool list
 * (`STATIC_TOOLS`) get one switch per tool; everything else degrades to a
 * single "All tools" switch rather than a broken or empty panel. */
export default function ToolCustomizePanel({
  app,
  authedFetch,
  onClose,
  onDisconnect,
  disconnectPending,
}: {
  app: ToolkitApp;
  authedFetch: AuthedFetch;
  onClose(): void;
  onDisconnect(slug: string): void;
  disconnectPending: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [pendingTool, setPendingTool] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState(false);

  const tools = useMemo(() => STATIC_TOOLS[app.slug] ?? [ALL_TOOLS_SENTINEL], [app.slug]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await storeApi.listToolOverrides(authedFetch);
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const o of list) if (o.toolkit === app.slug) map[o.tool] = o.enabled;
        setOverrides(map);
      } catch {
        if (!cancelled) setOverrides({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.slug, authedFetch]);

  async function toggle(tool: string) {
    const current = overrides[tool] ?? true; // default-on, mirrors worker isToolEnabled
    const next = !current;
    setOverrides((m) => ({ ...m, [tool]: next }));
    setPendingTool(tool);
    setToggleError(false);
    try {
      await storeApi.setToolOverride(authedFetch, app.slug, tool, next);
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        setLoginRequired(true); // kept for this session, same pattern as elsewhere in Settings
      } else {
        setOverrides((m) => ({ ...m, [tool]: current }));
        setToggleError(true);
      }
    } finally {
      setPendingTool(null);
    }
  }

  return (
    <div className="rounded-xl border border-accent/25 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {app.logo && (
            <img src={app.logo} alt="" aria-hidden className="h-6 w-6 rounded-sm bg-white/95 object-contain p-0.5" />
          )}
          <div>
            <p className="text-[13.5px] font-medium text-white">{app.name}</p>
            <p className="text-[11.5px] text-white/35">
              {tools[0] === ALL_TOOLS_SENTINEL ? 'No per-tool list for this app' : `${tools.length} tools`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-white/40 transition-colors hover:text-white/80"
        >
          Close
        </button>
      </div>

      <div className="mt-3.5 flex flex-col gap-1.5">
        {loading ? (
          <p className="text-[12px] text-white/35">Loading…</p>
        ) : (
          tools.map((tool) => {
            const on = overrides[tool] ?? true;
            return (
              <div
                key={tool}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <span className="truncate text-[12.5px] capitalize text-white/70">{toolLabel(tool)}</span>
                <Toggle
                  on={on}
                  onClick={() => toggle(tool)}
                  label={`${on ? 'Disable' : 'Enable'} ${toolLabel(tool)} for ${app.name}`}
                />
              </div>
            );
          })
        )}
      </div>

      {pendingTool && <p className="mt-2 text-[11px] text-white/30">Saving…</p>}
      {toggleError && <p className="mt-2 text-[12px] text-red-400">Couldn't save that change — try again.</p>}
      {loginRequired && (
        <p className="mt-2 text-[12px] text-white/40">
          Kept for this session —{' '}
          <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
            log in
          </Link>{' '}
          to save.
        </p>
      )}

      <button
        type="button"
        disabled={disconnectPending}
        onClick={() => onDisconnect(app.slug)}
        className="mt-3.5 text-[12px] text-white/40 transition-colors hover:text-red-400 disabled:opacity-40"
      >
        Disconnect {app.name}
      </button>
    </div>
  );
}
