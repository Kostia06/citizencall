import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import KeybindingEditor from '../components/settings/KeybindingEditor';
import ButtonEditor from '../components/settings/ButtonEditor';
import ConnectionsPanel from '../components/settings/ConnectionsPanel';
import CustomMcpsPanel from '../components/settings/CustomMcpsPanel';
import RoutinesPanel from '../components/settings/RoutinesPanel';
import ProvidersPanel from '../components/settings/ProvidersPanel';
import TopNav from '../components/TopNav';
import { ToastStack, useToasts } from '../components/Toast';
import { AuthError, DEFAULT_PREFS, MOCK, storeApi } from '../api';
import type { Connection, Routine, UserPrefs } from '../api';
import { useAuth } from '../auth/useAuth';
import { MACOS_DMG_URL } from '../lib/downloads';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';
import { syncThemeFromPrefs } from '../lib/theme';

type SaveState = 'idle' | 'saving' | 'saved' | 'needs-login';

type TabId = 'bar' | 'apps' | 'automation' | 'personal';
// "Personal" is also the mount point for the future Models & API keys
// section — it slots in as another SectionCard under that panel.
const TABS: { id: TabId; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'apps', label: 'Apps' },
  { id: 'automation', label: 'Automation' },
  { id: 'personal', label: 'Personal' },
];

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-surface/60 p-6 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-[12.5px] leading-relaxed text-ink/40">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0 pt-0.5">{action}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Customization editor — web UI design spec §5, a calm sectioned panel (not
 * kinetic-heavy — §7). Loads `UserPrefs` via `storeApi.getSettings()`
 * (falling back to `DEFAULT_PREFS` for anon/errors). Sections are grouped
 * into four tabs (deep-linked via ?tab=) and EVERY edit auto-saves through
 * the same debounced PUT the bar arranger already used — there is no Save
 * button to miss. All tab panels stay mounted (hidden, not unmounted) so
 * panel-owned state — routines mirror, connect flows, in-progress forms —
 * survives tab switches. */
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
  // Mirrored from RoutinesPanel (which owns the actual CRUD/loading state)
  // so ButtonEditor's "Routines" picker group stays live as routines are
  // added/edited/deleted, without a second independent fetch of the same list.
  const [routines, setRoutines] = useState<Routine[]>([]);

  // ?tab= is the source of truth for the active tab so OAuth returns and
  // shared links land on the right panel. Unknown/absent values → 'bar'.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'bar';
  function selectTab(id: TabId) {
    setSearchParams(id === 'bar' ? {} : { tab: id }, { replace: true });
  }

  // Every edit applies INSTANTLY — bar-layout keys mirror to localStorage
  // first so the home bar reflects them even before the debounced account
  // PUT lands. The old bottom Save was too easy to miss: "the buttons don't
  // reflect the home and they don't save", reported live after arranging
  // and navigating away without scrolling down to Save.
  const putTimerRef = useRef<number | undefined>(undefined);
  const savedTimerRef = useRef<number | undefined>(undefined);
  const pendingPatchRef = useRef<Partial<UserPrefs>>({});
  function schedulePut(patch: Partial<UserPrefs>) {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    setSaveState('saving');
    if (putTimerRef.current) window.clearTimeout(putTimerRef.current);
    putTimerRef.current = window.setTimeout(async () => {
      const toSend = pendingPatchRef.current;
      pendingPatchRef.current = {};
      try {
        await storeApi.putSettings(authedFetch, toSend);
        setSaveState('saved');
        if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), 1600);
      } catch (err) {
        if (err instanceof AuthError && err.status === 401) {
          setSaveState('needs-login');
        } else {
          setSaveState('idle');
          push('Saved on this device — account sync failed');
        }
      }
    }, 600);
  }
  // Navigating away inside the debounce window must not lose the account
  // sync — the home bar re-fetches server prefs on mount and would override
  // the fresher localStorage with the stale row.
  useEffect(() => {
    return () => {
      if (putTimerRef.current) window.clearTimeout(putTimerRef.current);
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
      const pending = pendingPatchRef.current;
      if (Object.keys(pending).length > 0) storeApi.putSettings(authedFetch, pending).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Single auto-save path for every pref: local draft, localStorage mirror
   * for the bar-boot keys, then the debounced account PUT. */
  function updatePrefs(patch: Partial<UserPrefs>) {
    setDraft((d) => ({ ...d, ...patch }));
    if (patch.buttons) localStorage.setItem('understudy:bar-buttons', JSON.stringify(patch.buttons));
    if (patch.barAlignment) localStorage.setItem('understudy:bar-alignment', patch.barAlignment);
    schedulePut(patch);
  }

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
    // Wait for the silent session restore — fetching while auth is still
    // 'loading' returned the ANON cookie's data for a logged-in user on
    // hard reload (audit FAIL #6).
    if (status === 'loading') return;
    let cancelled = false;
    (async () => {
      try {
        const prefs = await storeApi.getSettings(authedFetch);
        if (!cancelled) {
          setDraft(prefs);
          // Dark/light plumbing: adopt the account's saved theme into this
          // browser (no-ops if the user already made an explicit local
          // choice) — the toggle itself lives in TopNav, not here.
          syncThemeFromPrefs(prefs.theme);
        }
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
  }, [authedFetch, status]);

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

  // /oauth/done redirects here with ?connected=<toolkit>&status=... — greet
  // the returning user with the outcome, land them on the Apps tab, then
  // strip the params so a reload doesn't re-toast.
  useEffect(() => {
    const toolkit = searchParams.get('connected');
    if (!toolkit) return;
    const status = searchParams.get('status');
    push(status === 'success' ? `${toolkit} connected` : `Connecting ${toolkit} ${status ? `ended: ${status}` : 'did not complete'}`);
    refreshConnections();
    setSearchParams({ tab: 'apps' }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleConnect(toolkit: string) {
    setConnectLoginRequired(null);
    setConnectPending(toolkit);
    try {
      const { url } = await storeApi.connect(authedFetch, toolkit);
      await refreshConnections();
      // `composio.stub` links come from a worker running WITHOUT its
      // Composio key (stub mode) — never send a real browser there, it's a
      // dead domain. Treat it as the demo connect it is.
      if (url && url !== '#' && !url.includes('composio.stub')) {
        window.location.assign(url);
      } else if (url?.includes('composio.stub')) {
        push(`${toolkit} connected (demo mode — backend has no Composio key)`);
      }
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
        className="mx-auto mt-10 max-w-2xl"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold text-ink">Settings</h1>
          <div className="h-5 text-[12.5px]" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {saveState === 'saving' && (
                <motion.span
                  key="saving"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={entranceStandardReduced}
                  className="text-ink/30"
                >
                  Saving…
                </motion.span>
              )}
              {saveState === 'saved' && (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={entranceStandardReduced}
                  className="text-accent-bright"
                >
                  ✓ Saved
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="mt-1 text-[13px] text-ink/40">
          {!loaded && 'Loading…'}
          {loaded && saveState === 'needs-login' && (
            <>
              Saved to this browser —{' '}
              <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
                log in
              </Link>{' '}
              to save to your account.
            </>
          )}
          {loaded && saveState !== 'needs-login' && (
            <>
              Changes save automatically.
              {!MOCK && status !== 'authed' && (
                <span className="text-ink/30">
                  {' '}
                  <Link to="/login" className="text-ink/40 underline decoration-ink/20 underline-offset-2 transition-colors hover:text-ink/70">
                    Log in
                  </Link>{' '}
                  to sync across devices.
                </span>
              )}
            </>
          )}
        </p>

        <div role="tablist" aria-label="Settings sections" className="mt-7 flex gap-6 border-b border-ink/10">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`settings-panel-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                className={`relative pb-2.5 text-[13px] transition-colors ${
                  active ? 'font-medium text-ink' : 'text-ink/40 hover:text-ink/70'
                }`}
              >
                {tab.label}
                {active && (
                  <motion.span
                    layoutId="settings-tab-underline"
                    transition={reduceMotion ? { duration: 0 } : entranceStandard}
                    className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-accent"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Panels stay mounted (hidden, not unmounted): RoutinesPanel feeds
            the routines mirror ButtonEditor's picker needs, and in-progress
            forms/flows survive tab switches. */}
        <div className="mt-6">
          {/* NB: the display class must toggle too — `flex` would override the
              `hidden` attribute's UA display:none. */}
          <div id="settings-panel-bar" role="tabpanel" hidden={activeTab !== 'bar'} className={`flex-col gap-5 ${activeTab === 'bar' ? 'flex' : 'hidden'}`}>
            <SectionCard
              title="Layout"
              subtitle="Arrange the orbs and the input, pick each orb's action. Changes apply instantly on the home bar."
            >
              <ButtonEditor
                buttons={draft.buttons}
                onChange={(buttons) => updatePrefs({ buttons })}
                connections={connections}
                routines={routines}
                onCreateSpecial={async (name, prompt) => {
                  try {
                    const routine = await storeApi.createRoutine(authedFetch, { name, prompt, schedule: 'none', enabled: true });
                    // Keep the picker's Routines group live; RoutinesPanel owns
                    // its own list and re-fetches on mount, so it catches up on
                    // the next visit.
                    setRoutines((rs) => [...rs, routine]);
                    return routine;
                  } catch {
                    push('Could not create the special button — try again.');
                    return null;
                  }
                }}
              />
              {/* "Bar placement" removed (user request) — barAlignment still
                  round-trips in prefs for existing rows; the bar defaults to
                  center and honors any previously saved value. */}
            </SectionCard>

            <SectionCard title="Keybindings" subtitle="Click Record, then press a combo — or type one directly.">
              <KeybindingEditor keybindings={draft.keybindings} onChange={(keybindings) => updatePrefs({ keybindings })} />
            </SectionCard>

            <SectionCard
              title="Suggestions"
              subtitle="Context-aware next-action ghost text in the command bar."
              action={
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.suggestions}
                  aria-label="Next-action suggestions"
                  onClick={() => updatePrefs({ suggestions: !draft.suggestions })}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                    draft.suggestions ? 'bg-accent' : 'bg-ink/10'
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-paper transition-transform duration-200 ${
                      draft.suggestions ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              }
            />
          </div>

          <div id="settings-panel-apps" role="tabpanel" hidden={activeTab !== 'apps'} className={`flex-col gap-5 ${activeTab === 'apps' ? 'flex' : 'hidden'}`}>
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
          </div>

          <div id="settings-panel-automation" role="tabpanel" hidden={activeTab !== 'automation'} className={`flex-col gap-5 ${activeTab === 'automation' ? 'flex' : 'hidden'}`}>
            <SectionCard
              title="Routines"
              subtitle="Saved prompts you can run on demand or bind to a bar button — optionally on a schedule."
            >
              <RoutinesPanel authedFetch={authedFetch} onRoutinesChange={setRoutines} />
            </SectionCard>
          </div>

          <div id="settings-panel-personal" role="tabpanel" hidden={activeTab !== 'personal'} className={`flex-col gap-5 ${activeTab === 'personal' ? 'flex' : 'hidden'}`}>
            <SectionCard title="Context prompt" subtitle="Prepended to every run this session.">
              <textarea
                value={draft.contextPrompt}
                onChange={(e) => updatePrefs({ contextPrompt: e.target.value })}
                rows={4}
                placeholder="e.g. Always check the roster policy before merging."
                className="w-full resize-none rounded-lg border border-ink/10 bg-surface-sunken px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
              />
            </SectionCard>

            <SectionCard
              title="Models & API keys"
              subtitle="Bring your own model key — it becomes the fallback when the built-in models fail a check."
            >
              <ProvidersPanel authedFetch={authedFetch} />
            </SectionCard>

            <SectionCard
              title="macOS app"
              subtitle="A Spotlight-style overlay bar — press ⌥Space anywhere. Shows just the answer; full steps stay here on the web."
              action={
                <a
                  href={MACOS_DMG_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-accent/40 px-3 py-1.5 text-[12.5px] text-accent-bright transition-colors hover:bg-accent/10"
                >
                  Download for macOS (.dmg)
                </a>
              }
            >
              <p className="text-[11.5px] text-ink/35">
                Apple Silicon, unsigned dev build — right-click → Open the first time.
              </p>
            </SectionCard>
          </div>
        </div>
      </motion.div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
