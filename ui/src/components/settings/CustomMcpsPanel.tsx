import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthError, storeApi } from '../../api';
import type { AuthedFetch, UserMcp } from '../../api';

type HeaderRow = { key: string; value: string };

function emptyRow(): HeaderRow {
  return { key: '', value: '' };
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> | undefined {
  const entries = rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function headersToRows(headers?: Record<string, string>): HeaderRow[] {
  const entries = headers ? Object.entries(headers) : [];
  return entries.length ? entries.map(([key, value]) => ({ key, value })) : [emptyRow()];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

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
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper transition-transform duration-200 ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function HeaderRows({ rows, onChange }: { rows: HeaderRow[]; onChange(rows: HeaderRow[]): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={row.key}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
            placeholder="Header"
            className="w-1/3 rounded-md border border-white/10 bg-surface-sunken px-2 py-1 text-[12px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
            placeholder="Value"
            className="flex-1 rounded-md border border-white/10 bg-surface-sunken px-2 py-1 text-[12px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
          <button
            type="button"
            aria-label="Remove header"
            onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyRow()])}
            className="shrink-0 px-1 text-[13px] text-white/30 transition-colors hover:text-white/70"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, emptyRow()])}
        className="self-start text-[11.5px] text-white/40 transition-colors hover:text-white/70"
      >
        + Add header
      </button>
    </div>
  );
}

/** One MCP row — view mode by default, switches to an inline edit form
 * (name/url/headers, mirroring the add form) when `editing`. */
function McpRow({
  mcp,
  onToggle,
  onSave,
  onDelete,
  busy,
}: {
  mcp: UserMcp;
  onToggle(): void;
  onSave(patch: { name: string; url: string; headers?: Record<string, string> }): void;
  onDelete(): void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(mcp.name);
  const [url, setUrl] = useState(mcp.url ?? '');
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => headersToRows(mcp.headers));
  const [urlError, setUrlError] = useState<string | null>(null);

  function startEdit() {
    setName(mcp.name);
    setUrl(mcp.url ?? '');
    setHeaderRows(headersToRows(mcp.headers));
    setUrlError(null);
    setEditing(true);
  }

  function submit() {
    if (!isHttpUrl(url)) {
      setUrlError('Needs a valid http(s) URL');
      return;
    }
    onSave({ name: name.trim() || mcp.name, url, headers: rowsToHeaders(headerRows) });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-accent/30 bg-white/[0.03] p-3.5">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-white/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            placeholder="https://example.com/mcp"
            className="rounded-md border border-white/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
          {urlError && <p className="text-[11.5px] text-red-400">{urlError}</p>}
          {!mcp.url && (
            <p className="text-[11px] text-white/30">
              This server didn't return the saved URL — re-enter it here to update.
            </p>
          )}
          <HeaderRows rows={headerRows} onChange={setHeaderRows} />
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-black transition-colors hover:bg-accent-bright"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-[12.5px] text-white/50 transition-colors hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
      <Toggle on={mcp.enabled} onClick={onToggle} label={`${mcp.enabled ? 'Disable' : 'Enable'} ${mcp.name}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-white">{mcp.name}</p>
        <p className="truncate text-[11.5px] text-white/35">{mcp.url ?? 'URL not shown — edit to set it'}</p>
      </div>
      {!mcp.id.startsWith('temp-') && (
        <span className="text-[10px] uppercase tracking-wide text-white/25">saved</span>
      )}
      {mcp.id.startsWith('temp-') && <span className="text-[10px] uppercase tracking-wide text-white/30">unsaved</span>}
      <button
        type="button"
        disabled={busy}
        onClick={startEdit}
        aria-label={`Edit ${mcp.name}`}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-white/50 transition-colors hover:text-white disabled:opacity-40"
      >
        Edit
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        aria-label={`Delete ${mcp.name}`}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-white/50 transition-colors hover:text-red-400 disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  );
}

/** "Custom MCPs" Settings section — lets a user register their own MCP
 * server(s) (name + URL + optional headers), independent of the Composio
 * toolkit catalog. CRUD hits `storeApi.{list,create,update,delete}Mcp`;
 * MOCK mode (or an anonymous/unverified caller getting a 401) keeps
 * everything in local state only, flagged "unsaved" — same "log in to
 * save" pattern as the rest of Settings, per web UI design spec §5. */
export default function CustomMcpsPanel({ authedFetch }: { authedFetch: AuthedFetch }) {
  const [mcps, setMcps] = useState<UserMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([emptyRow()]);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await storeApi.listMcps(authedFetch);
        if (!cancelled) setMcps(list);
      } catch {
        if (!cancelled) setMcps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authedFetch]);

  async function handleAdd() {
    if (!name.trim()) return;
    if (!isHttpUrl(url)) {
      setUrlError('Needs a valid http(s) URL');
      return;
    }
    const headers = rowsToHeaders(headerRows);
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: UserMcp = { id: tempId, name: name.trim(), url, headers, enabled: true, createdAt: Date.now() };
    setMcps((list) => [...list, optimistic]);
    setName('');
    setUrl('');
    setHeaderRows([emptyRow()]);
    setUrlError(null);

    try {
      const saved = await storeApi.createMcp(authedFetch, { name: optimistic.name, url, headers });
      setMcps((list) => list.map((m) => (m.id === tempId ? saved : m)));
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        setLoginRequired(true); // keep the optimistic row — session-only, per spec
      } else {
        setMcps((list) => list.filter((m) => m.id !== tempId));
      }
    }
  }

  async function handleToggle(mcp: UserMcp) {
    const next = !mcp.enabled;
    setMcps((list) => list.map((m) => (m.id === mcp.id ? { ...m, enabled: next } : m)));
    if (mcp.id.startsWith('temp-')) return; // never persisted — nothing to patch
    setBusyId(mcp.id);
    try {
      await storeApi.updateMcp(authedFetch, mcp.id, { enabled: next });
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) setLoginRequired(true);
      else setMcps((list) => list.map((m) => (m.id === mcp.id ? { ...m, enabled: mcp.enabled } : m)));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveEdit(mcp: UserMcp, patch: { name: string; url: string; headers?: Record<string, string> }) {
    setMcps((list) => list.map((m) => (m.id === mcp.id ? { ...m, ...patch } : m)));
    if (mcp.id.startsWith('temp-')) return;
    setBusyId(mcp.id);
    try {
      await storeApi.updateMcp(authedFetch, mcp.id, patch);
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) setLoginRequired(true);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(mcp: UserMcp) {
    setMcps((list) => list.filter((m) => m.id !== mcp.id));
    if (mcp.id.startsWith('temp-')) return;
    try {
      await storeApi.deleteMcp(authedFetch, mcp.id);
    } catch {
      // Deletion is best-effort here — worst case a stale row reappears on
      // next real reload, which is far less harmful than resurrecting it in
      // this session against the user's action.
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {loading ? (
        <p className="text-[12.5px] text-white/35">Loading…</p>
      ) : mcps.length === 0 ? (
        <p className="text-[12.5px] text-white/35">No custom MCPs yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {mcps.map((mcp) => (
            <McpRow
              key={mcp.id}
              mcp={mcp}
              busy={busyId === mcp.id}
              onToggle={() => handleToggle(mcp)}
              onSave={(patch) => handleSaveEdit(mcp, patch)}
              onDelete={() => handleDelete(mcp)}
            />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
        <p className="mb-2 text-[12px] font-medium text-white/60">Add an MCP server</p>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-white/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            placeholder="https://example.com/mcp"
            className="rounded-md border border-white/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
          {urlError && <p className="text-[11.5px] text-red-400">{urlError}</p>}
          <HeaderRows rows={headerRows} onChange={setHeaderRows} />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim() || !url.trim()}
            className="mt-1 self-start rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-40"
          >
            Add MCP
          </button>
        </div>
      </div>

      {loginRequired && (
        <p className="text-[12px] text-white/40">
          Kept for this session —{' '}
          <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
            log in
          </Link>{' '}
          to save.
        </p>
      )}
    </div>
  );
}
