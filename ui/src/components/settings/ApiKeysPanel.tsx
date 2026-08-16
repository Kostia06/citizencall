// Developer API keys — create (full key shown once, copy button), list with
// per-key usage (requests · cost · last used), delete. Full-auth only: the
// worker's /api/keys routes are gated, so anon/unverified actors see the
// sign-in hint instead of a broken form.
import { useEffect, useState } from 'react';
import { storeApi, type ApiKeySummary } from '../../api';
import { useAuth } from '../../auth/useAuth';

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ApiKeysPanel({ refreshToken = 0, onToast }: { refreshToken?: number; onToast(msg: string): void }) {
  const { user, authedFetch } = useAuth();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  /** The one-time full key from the last create — cleared on dismiss. */
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    storeApi
      .listApiKeys(authedFetch)
      .then((rows) => {
        if (!cancelled) setKeys(rows);
      })
      .catch(() => {
        if (!cancelled) setKeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authedFetch, refreshToken]);

  if (!user) {
    return <p className="text-[12px] text-ink/35">Sign in (verified email) to create API keys.</p>;
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const created = await storeApi.createApiKey(authedFetch, trimmed);
      setFreshKey({ name: created.name, key: created.key });
      setName('');
      setKeys((prev) => [
        { id: created.id, name: created.name, masked: created.masked, createdAt: created.createdAt, lastUsedAt: null, requests: 0, costUsd: 0 },
        ...(prev ?? []),
      ]);
    } catch {
      onToast('Could not create the key');
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    setKeys((prev) => (prev ? prev.filter((k) => k.id !== id) : prev));
    try {
      await storeApi.deleteApiKey(authedFetch, id);
      onToast('Key deleted');
    } catch {
      onToast('Could not delete the key');
      storeApi.listApiKeys(authedFetch).then(setKeys).catch(() => undefined);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] leading-relaxed text-ink/35">
        Call CitizenCall programmatically:{' '}
        <code className="rounded bg-ink/10 px-1 py-0.5 text-[10.5px]">POST https://citizencall.dev/v1/ask</code> with{' '}
        <code className="rounded bg-ink/10 px-1 py-0.5 text-[10.5px]">Authorization: Bearer &lt;key&gt;</code> and{' '}
        <code className="rounded bg-ink/10 px-1 py-0.5 text-[10.5px]">{'{"text":"…"}'}</code>. Long runs return 202 —
        poll <code className="rounded bg-ink/10 px-1 py-0.5 text-[10.5px]">GET /v1/runs/:id</code>.
      </p>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
          placeholder="Key name (e.g. my-script)"
          className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-surface-sunken px-3.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
        />
        <button
          type="button"
          disabled={!name.trim() || creating}
          onClick={() => void create()}
          className="shrink-0 rounded-lg border border-accent/40 px-3.5 py-2 text-[12.5px] text-accent-bright transition-colors hover:bg-accent/10 disabled:opacity-40"
        >
          Create key
        </button>
      </div>

      {freshKey && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-3">
          <p className="text-[11.5px] text-ink/60">
            <span className="font-medium text-ink/85">{freshKey.name}</span> — copy it now, it won't be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[11.5px] text-ink/90">
              {freshKey.key}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(freshKey.key).then(() => onToast('Key copied'));
              }}
              className="shrink-0 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[11.5px] text-ink/70 transition-colors hover:border-ink/30"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setFreshKey(null)}
              className="shrink-0 rounded-lg px-2 py-1.5 text-[11.5px] text-ink/40 transition-colors hover:text-ink/70"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {keys === null && <p className="text-[12px] text-ink/35">Loading keys…</p>}
      {keys?.length === 0 && !freshKey && <p className="text-[12px] text-ink/35">No keys yet.</p>}
      {keys?.map((k) => (
        <div key={k.id} className="flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink/80">
              {k.name} <span className="ml-1.5 font-mono text-[11px] text-ink/40">{k.masked}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink/35">
              {k.requests} request{k.requests === 1 ? '' : 's'} · ${k.costUsd.toFixed(4)} ·{' '}
              {k.lastUsedAt ? `last used ${formatWhen(k.lastUsedAt)}` : 'never used'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void remove(k.id)}
            className="shrink-0 rounded-lg border border-ink/15 px-2.5 py-1 text-[11.5px] text-ink/55 transition-colors hover:border-red-400/50 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
