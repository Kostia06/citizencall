import { useEffect, useState } from 'react';
import type { AuthedFetch } from '../../api';

/** Wire shape of GET/POST /api/providers — the key only ever arrives
 * masked (`…last4`); the full key is write-only. */
interface ProviderRow {
  id: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string | null;
  apiKeyMasked: string;
  enabled: boolean;
  createdAt: number;
}

type ProviderKind = 'anthropic' | 'openai' | 'custom';

const KIND_META: Record<ProviderKind, { label: string; modelPlaceholder: string }> = {
  anthropic: { label: 'Anthropic', modelPlaceholder: 'claude-sonnet-5' },
  openai: { label: 'OpenAI', modelPlaceholder: 'gpt-4o-mini' },
  custom: { label: 'Custom URL', modelPlaceholder: 'llama-3.1-8b-instruct' },
};

const inputClass =
  'rounded-lg border border-ink/10 bg-surface-sunken px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60';

function Toggle({ on, onClick, label }: { on: boolean; onClick(): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-ink/10'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper transition-transform duration-200 ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** "Models & API keys" Settings section — bring-your-own model keys
 * (Anthropic / OpenAI / any OpenAI-compatible URL). An enabled provider
 * becomes the pipeline's final escalation rung, so the row list doubles as
 * "which model backs me up". CRUD talks to /api/providers directly (own
 * fetch helpers, not storeApi — the routes are new here); anon sessions can
 * save too and claim-on-login re-parents the rows. */
export default function ProvidersPanel({ authedFetch }: { authedFetch: AuthedFetch }) {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<ProviderKind>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/providers');
        if (!res.ok) throw new Error(String(res.status));
        const list = (await res.json()) as ProviderRow[];
        if (!cancelled) setProviders(list);
      } catch {
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authedFetch]);

  async function handleAdd() {
    if (!model.trim() || !apiKey.trim() || saving) return;
    if (kind === 'custom' && !/^https:\/\//i.test(baseUrl.trim())) {
      setError('Custom providers need an https base URL.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch('/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          model: model.trim(),
          apiKey: apiKey.trim(),
          ...(kind === 'custom' ? { baseUrl: baseUrl.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === 'invalid provider' ? 'That provider looks invalid — check the fields.' : 'Could not save — try again.');
        return;
      }
      const saved = (await res.json()) as ProviderRow;
      setProviders((list) => [saved, ...list]);
      setModel('');
      setApiKey(''); // never keep the key around longer than the request
      setBaseUrl('');
    } catch {
      setError('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(p: ProviderRow) {
    const next = !p.enabled;
    setProviders((list) => list.map((row) => (row.id === p.id ? { ...row, enabled: next } : row)));
    try {
      const res = await authedFetch(`/api/providers/${p.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: next }) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setProviders((list) => list.map((row) => (row.id === p.id ? { ...row, enabled: p.enabled } : row)));
    }
  }

  async function handleDelete(p: ProviderRow) {
    setProviders((list) => list.filter((row) => row.id !== p.id));
    try {
      const res = await authedFetch(`/api/providers/${p.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
    } catch {
      setProviders((list) => [p, ...list]); // restore on failure
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <p className="text-[12.5px] text-ink/35">Loading…</p>
      ) : providers.length === 0 ? (
        <p className="text-[12.5px] text-ink/35">No keys yet — add one below to give runs a fallback model of your own.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {providers.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-ink/10 bg-surface-sunken/60 px-3.5 py-2.5">
              <span className="shrink-0 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent-bright">
                {KIND_META[p.kind]?.label ?? p.kind}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{p.model}</p>
                <p className="truncate font-mono text-[11.5px] text-ink/35">
                  {p.apiKeyMasked}
                  {p.baseUrl ? ` · ${p.baseUrl}` : ''}
                </p>
              </div>
              <Toggle on={p.enabled} onClick={() => handleToggle(p)} label={`${p.model} enabled`} />
              <button
                type="button"
                aria-label={`Delete ${p.model}`}
                onClick={() => handleDelete(p)}
                className="shrink-0 px-1 text-[15px] leading-none text-ink/30 transition-colors hover:text-ink/70"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ProviderKind);
              setError(null);
            }}
            aria-label="Provider kind"
            className={`${inputClass} shrink-0`}
          >
            {(Object.keys(KIND_META) as ProviderKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={KIND_META[kind].modelPlaceholder}
            aria-label="Model"
            autoComplete="off"
            className={`${inputClass} w-44 flex-1`}
          />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key"
            aria-label="API key"
            // "new-password" (not "off"): browsers ignore "off" on password
            // fields and autofill saved logins into the key box.
            autoComplete="new-password"
            className={`${inputClass} w-44 flex-1`}
          />
        </div>
        {kind === 'custom' && (
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://my-host.example.com/v1 (OpenAI-compatible)"
            aria-label="Base URL"
            className={inputClass}
          />
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!model.trim() || !apiKey.trim() || saving}
            className="w-fit rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Adding…' : 'Add key'}
          </button>
          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>
        <p className="text-[11.5px] text-ink/30">
          Keys are stored server-side and shown masked. An enabled model steps in when the built-in models fail a check.
        </p>
      </div>
    </div>
  );
}
