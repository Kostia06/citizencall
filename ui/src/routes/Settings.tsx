import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import KeybindingEditor from '../components/settings/KeybindingEditor';
import ButtonEditor from '../components/settings/ButtonEditor';
import ConnectionsPanel from '../components/settings/ConnectionsPanel';
import CustomMcpsPanel from '../components/settings/CustomMcpsPanel';
import TopNav from '../components/TopNav';
import { ToastStack, useToasts } from '../components/Toast';
import { AuthError, DEFAULT_PREFS, MOCK, storeApi } from '../api';
import type { Connection, UserPrefs } from '../api';
import { useAuth } from '../auth/useAuth';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';

type SaveState = 'idle' | 'saving' | 'saved' | 'needs-login' | 'error';

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-surface/60 p-6 backdrop-blur-xl">
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      {subtitle && <p className="mt-1 text-[12.5px] text-white/40">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Customization editor — web UI design spec §5, a calm sectioned panel (not
 * kinetic-heavy — §7). Loads `UserPrefs` via `storeApi.getSettings()`
 * (falling back to `DEFAULT_PREFS` for anon/errors); edits live in local
 * `draft` state and Save persists via `storeApi.putSettings`. Anonymous
 * edits stay in-memory for the session — Save shows an inline "log in to
 * save" prompt instead of erroring (spec §5). */
export default function Settings() {
  const { authedFetch, status } = useAuth();
  const reduceMotion = !!useReducedMotion();
  const { toasts, push } = useToasts();

  const [draft, setDraft] = useState<UserPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectPending, setConnectPending] = useState<string | null>(null);
  const [connectLoginRequired, setConnectLoginRequired] = useState<string | null>(null);

  const refreshConnections = useCallback(async () => {
    try {
      const list = await storeApi.listConnections(authedFetch);
      setConnections(list);
    } catch {
      setConnections([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await storeApi.getSettings(authedFetch);
        if (!cancelled) setDraft(prefs);
      } catch {
        if (!cancelled) setDraft(DEFAULT_PREFS);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    refreshConnections();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch]);

  // Connections can change out-of-band (the Composio OAuth redirect returns
  // to a fresh page load, but refreshing on focus also covers a same-tab
  // back-navigation or a second tab completing the flow).
  useEffect(() => {
    function onFocus() {
      refreshConnections();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshConnections]);

  async function handleSave() {
    setSaveState('saving');
    try {
      const saved = await storeApi.putSettings(authedFetch, draft);
      setDraft(saved);
      setSaveState('saved');
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        setSaveState('needs-login');
      } else {
        setSaveState('error');
      }
    }
  }

  async function handleConnect(toolkit: string) {
    setConnectLoginRequired(null);
    setConnectPending(toolkit);
    try {
      const { url } = await storeApi.connect(authedFetch, toolkit);
      await refreshConnections();
      if (url && url !== '#') window.location.assign(url);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        setConnectLoginRequired(toolkit);
      } else {
        push(`Couldn't connect ${toolkit} — try again.`);
      }
    } finally {
      setConnectPending(null);
    }
  }

  async function handleDisconnect(toolkit: string) {
    setConnectPending(toolkit);
    try {
      await storeApi.disconnect(authedFetch, toolkit);
      await refreshConnections();
    } catch {
      push(`Couldn't disconnect ${toolkit} — try again.`);
    } finally {
      setConnectPending(null);
    }
  }

  return (
    <div className="relative min-h-screen w-full px-6 pb-24 pt-6">
      <div className="mx-auto max-w-2xl">
        <TopNav />
      </div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduceMotion ? entranceStandardReduced : entranceStandard}
        className="mx-auto mt-10 flex max-w-2xl flex-col gap-5"
      >
        <div>
          <h1 className="text-xl font-semibold text-white">Settings</h1>
          <p className="mt-1 text-[13px] text-white/40">
            {loaded ? 'Keybindings, bar buttons, and the default context prompt.' : 'Loading…'}
          </p>
        </div>

        <SectionCard title="Keybindings" subtitle="Click Record, then press a combo — or type one directly.">
          <KeybindingEditor
            keybindings={draft.keybindings}
            onChange={(keybindings) => setDraft((d) => ({ ...d, keybindings }))}
          />
        </SectionCard>

        <SectionCard title="Buttons" subtitle="The four bar orbs — arrange them and pick each one's action.">
          <ButtonEditor
            buttons={draft.buttons}
            onChange={(buttons) => setDraft((d) => ({ ...d, buttons }))}
            connections={connections}
          />
        </SectionCard>

        <SectionCard title="Suggestions" subtitle="Context-aware next-action ghost text in the command bar.">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={draft.suggestions}
              onClick={() => setDraft((d) => ({ ...d, suggestions: !d.suggestions }))}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                draft.suggestions ? 'bg-accent' : 'bg-white/10'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${
                  draft.suggestions ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-[13px] text-white/60">
              Next-action suggestions: <span className="text-white">{draft.suggestions ? 'on' : 'off'}</span>
            </span>
          </div>
        </SectionCard>

        <SectionCard title="Context prompt" subtitle="Prepended to every run this session.">
          <textarea
            value={draft.contextPrompt}
            onChange={(e) => setDraft((d) => ({ ...d, contextPrompt: e.target.value }))}
            rows={4}
            placeholder="e.g. Always check the roster policy before merging."
            className="w-full resize-none rounded-lg border border-white/10 bg-surface-sunken px-3.5 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
        </SectionCard>

        <SectionCard
          title="Connections"
          subtitle="Connect apps via OAuth — connected toolkits light their orb. Click a connected app to customize its tools."
        >
          <ConnectionsPanel
            connections={connections}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            pendingToolkit={connectPending}
            loginRequiredFor={connectLoginRequired}
            authedFetch={authedFetch}
          />
        </SectionCard>

        <SectionCard title="Custom MCPs" subtitle="Bring your own MCP server — name, URL, and optional auth headers.">
          <CustomMcpsPanel authedFetch={authedFetch} />
        </SectionCard>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="rounded-lg bg-accent px-4 py-2.5 text-[14px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {saveState === 'saved' && <span className="text-[13px] text-accent-bright">Saved.</span>}
          {saveState === 'error' && <span className="text-[13px] text-red-400">Couldn't save — try again.</span>}
          {saveState === 'needs-login' && (
            <span className="text-[13px] text-white/50">
              Edits kept for this session —{' '}
              <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
                log in
              </Link>{' '}
              to save.
            </span>
          )}
          {!MOCK && status !== 'authed' && saveState === 'idle' && (
            <span className="text-[13px] text-white/30">Anonymous — edits apply to this session only.</span>
          )}
        </div>
      </motion.div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
