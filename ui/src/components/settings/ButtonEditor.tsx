import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Reorder, useReducedMotion } from 'framer-motion';
import { FIXED_BUTTON_ACTIONS, ensureInputButton } from '../../store/types';
import type { Connection, FixedButtonAction, Routine, UserPrefsButton } from '../../store/types';
import { APPS } from '../../store/apps';
import type { ToolkitApp } from '../../store/apps';

// Connected-app actions are encoded as `toolkit:<slug>` in the same `action:
// string` field the fixed actions already use — no schema change, so a
// button can be "highly customizable" (bound to any connected Composio
// toolkit) without touching UserPrefsButton's shape.
const TOOLKIT_PREFIX = 'toolkit:';
const toolkitAction = (slug: string) => `${TOOLKIT_PREFIX}${slug}`;
const toolkitSlug = (action: string) => (action.startsWith(TOOLKIT_PREFIX) ? action.slice(TOOLKIT_PREFIX.length) : null);

// Same encoding trick, for a routine (RoutinesPanel.tsx) — Orbs.tsx resolves
// this the same way at render time.
const ROUTINE_PREFIX = 'routine:';
const routineAction = (id: string) => `${ROUTINE_PREFIX}${id}`;
const routineId = (action: string) => (action.startsWith(ROUTINE_PREFIX) ? action.slice(ROUTINE_PREFIX.length) : null);

const SLOT_LABELS: Record<string, string> = {
  github: 'GitHub orb',
  gmail: 'Gmail orb',
  policy: 'Policy orb',
  user: 'User orb',
  input: 'Input field',
};

function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.07.78 2.16 0 1.56-.02 2.81-.02 3.19 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function GmailGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
      <path d="M3.5 6l8.5 7 8.5-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Icon + short display name for each fixed action, shared by the mockup
// orbs and the action-picker grid so a chosen action reads identically in
// both places. Glyphs echo Orbs.tsx's own language (◆ policy, ◑ user).
const ACTION_META: Record<FixedButtonAction, { icon: ReactNode; name: string }> = {
  'connect:github': { icon: <GithubGlyph />, name: 'GitHub' },
  'connect:gmail': { icon: <GmailGlyph />, name: 'Gmail' },
  'toggle:user': { icon: <span className="text-[15px] leading-none">◑</span>, name: 'User' },
  'toggle:theme': { icon: <span className="text-[15px] leading-none">☾</span>, name: 'Theme' },
  run: { icon: <span className="text-[13px] leading-none">▶</span>, name: 'Run' },
  bypassCache: { icon: <span className="text-[15px] leading-none">⚡</span>, name: 'Bypass cache' },
  suggest: { icon: <span className="text-[15px] leading-none">✦</span>, name: 'Suggest' },
};

/** Small logo tile for a connected toolkit — mirrors ConnectionsPanel's
 * `AppTile` fallback (initials monogram if the hosted logo 404s), sized down
 * for the orb glyph / picker grid. */
function ToolkitIcon({ app, className = 'h-4 w-4' }: { app: ToolkitApp; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`flex items-center justify-center rounded-sm bg-white/10 text-[8px] font-bold text-white/70 ${className}`}>
        {app.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={app.logo}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      // Deliberately literal white backing (not the themed `ink` scale) —
      // toolkit PNGs assume a white tile regardless of app theme.
      className={`rounded-sm bg-paper object-contain p-0.5 ${className}`}
    />
  );
}

/** Resolves any action string (fixed, `toolkit:<slug>`, or `routine:<id>`)
 * to a display icon + name, shared by the mockup orbs and every
 * action-picker grid. Toolkit lookup falls back to the full catalog (not
 * just currently-connected apps) so a since-disconnected toolkit still
 * renders sensibly instead of a bare `?`. */
function resolveActionMeta(action: string, routines: Routine[], iconClassName = 'h-4 w-4'): { icon: ReactNode; name: string } {
  const fixed = ACTION_META[action as FixedButtonAction];
  if (fixed) return fixed;
  const slug = toolkitSlug(action);
  if (slug) {
    const app = APPS.find((a) => a.slug === slug);
    if (app) return { icon: <ToolkitIcon app={app} className={iconClassName} />, name: app.name };
    return { icon: <span className="text-[13px] leading-none">⬡</span>, name: slug };
  }
  const rid = routineId(action);
  if (rid) {
    const routine = routines.find((r) => r.id === rid);
    return { icon: <span className="text-[15px] leading-none">⟳</span>, name: routine?.name ?? 'Routine' };
  }
  return { icon: <span className="text-[10px] text-ink/30">?</span>, name: action };
}

const orbBase =
  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-ink/70 outline-none transition-colors duration-200';

function MockOrb({
  button,
  selected,
  reduceMotion,
  routines,
  onSelect,
}: {
  button: UserPrefsButton;
  selected: boolean;
  reduceMotion: boolean;
  routines: Routine[];
  onSelect(): void;
}) {
  const meta = resolveActionMeta(button.action, routines, 'h-5 w-5');
  // The input pseudo-slot drags like an orb but renders as a mini text pill
  // — its position in `buttons` is where the real bar puts the text field.
  if (button.id === 'input') {
    return (
      <Reorder.Item
        as="div"
        value={button}
        drag={reduceMotion ? false : 'x'}
        dragListener={!reduceMotion}
        whileDrag={reduceMotion ? undefined : { scale: 1.05, zIndex: 1 }}
        className="cursor-grab active:cursor-grabbing"
      >
        <button
          type="button"
          aria-label={`Input field — position among the orbs${selected ? ' (selected)' : ''}. Drag to move it.`}
          aria-pressed={selected}
          onClick={onSelect}
          className={`flex h-11 w-32 items-center rounded-full border px-4 text-[12px] transition-colors ${
            selected
              ? 'border-accent/70 bg-accent/15 text-ink/70 shadow-glow-accent'
              : 'border-ink/10 bg-ink/[0.04] text-ink/30 hover:bg-ink/[0.08]'
          }`}
        >
          <span className="truncate">Ask anything…</span>
        </button>
      </Reorder.Item>
    );
  }
  return (
    <Reorder.Item
      as="div"
      value={button}
      drag={reduceMotion ? false : 'x'}
      dragListener={!reduceMotion}
      whileDrag={reduceMotion ? undefined : { scale: 1.1, zIndex: 1 }}
      className="cursor-grab active:cursor-grabbing"
    >
      <button
        type="button"
        aria-label={`${SLOT_LABELS[button.id] ?? button.id} — ${meta.name}${selected ? ' (selected)' : ''}. Click to change its action.`}
        aria-pressed={selected}
        onClick={onSelect}
        className={`${orbBase} ${
          selected
            ? 'border-accent/70 bg-accent/15 shadow-glow-accent'
            : 'border-ink/10 bg-ink/[0.04] hover:-translate-y-0.5 hover:bg-ink/[0.08]'
        }`}
      >
        {meta.icon}
      </button>
    </Reorder.Item>
  );
}

/** Buttons section, reskinned as a live command-bar mockup — the four fixed
 * orb slots (github/gmail/policy/user) are the configurable buttons.
 * Clicking an orb selects it and opens a visual action picker below; the
 * orb's glyph updates live. Dragging the orbs (pointer-based, disabled under
 * reduced motion) reorders `buttons`; left/right move controls give the same
 * reorder keyboard- and reduced-motion-safe. The picker offers the fixed
 * action list plus, when the user has active connections, each connected
 * toolkit as a bindable action (`toolkit:<slug>`) — still a plain `action:
 * string` on `UserPrefsButton`, so Settings' Save flow and the prefs schema
 * are untouched. */
export default function ButtonEditor({
  buttons,
  onChange,
  connections = [],
  routines = [],
  onCreateSpecial,
}: {
  buttons: UserPrefsButton[];
  onChange(next: UserPrefsButton[]): void;
  /** Creates a "special button": persists the mini prompt as a routine and
   * returns it so the selected orb can bind `routine:<id>`. Null = creation
   * failed (caller already toasted). Omitted (e.g. tests) hides the form. */
  onCreateSpecial?(name: string, prompt: string): Promise<Routine | null>;
  /** Active Composio connections (Settings already fetches these for the
   * Connections panel) — offered as extra bindable actions so an orb can
   * point at any connected app, not just the fixed list. Empty/anonymous
   * degrades gracefully to the fixed actions only. */
  connections?: Connection[];
  /** The user's routines (RoutinesPanel, same page) — offered as a third
   * bindable-action group so a bar button can trigger one directly. */
  routines?: Routine[];
}) {
  const reduceMotion = !!useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [specialPrompt, setSpecialPrompt] = useState('');
  const [specialBusy, setSpecialBusy] = useState(false);

  const connectedApps = useMemo(() => {
    const slugs = new Set(connections.filter((c) => c.status === 'active').map((c) => c.toolkit));
    return APPS.filter((a) => slugs.has(a.slug));
  }, [connections]);

  // The input field participates as a draggable pseudo-slot (`id:'input'`)
  // — normalize older saved prefs that predate it so it always has a slot.
  const editorButtons = ensureInputButton(buttons);

  const selected = editorButtons.find((b) => b.id === selectedId) ?? null;
  const selectedIndex = selected ? editorButtons.indexOf(selected) : -1;

  function update(id: string, patch: Partial<UserPrefsButton>) {
    onChange(editorButtons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function move(direction: -1 | 1) {
    if (selectedIndex < 0) return;
    const target = selectedIndex + direction;
    if (target < 0 || target >= editorButtons.length) return;
    const next = editorButtons.slice();
    [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
    onChange(next);
  }

  function addButton() {
    // New orbs start on a harmless fixed action and open the picker so the
    // very next click chooses what it does.
    const id = `btn-${Date.now().toString(36)}`;
    onChange([...editorButtons, { id, action: 'suggest' }]);
    setSelectedId(id);
  }

  function removeSelected() {
    if (!selected || selected.id === 'input') return;
    onChange(editorButtons.filter((b) => b.id !== selected.id));
    setSelectedId(null);
  }

  async function createSpecial() {
    if (!onCreateSpecial || !selected || specialBusy) return;
    const prompt = specialPrompt.trim();
    if (!prompt) return;
    const name = selected.label?.trim() || (prompt.length > 28 ? `${prompt.slice(0, 28)}…` : prompt);
    setSpecialBusy(true);
    const routine = await onCreateSpecial(name, prompt);
    setSpecialBusy(false);
    if (!routine) return;
    update(selected.id, { action: routineAction(routine.id), label: selected.label ?? routine.name });
    setSpecialPrompt('');
  }

  return (
    <div className="flex flex-col gap-5">
      {/* The mockup — a miniature echo of the real bar pill + orbs. */}
      <div className="flex items-center justify-center gap-4 rounded-full border border-ink/10 bg-ink/[0.03] px-5 py-3 shadow-lift backdrop-blur-soft">
        <Reorder.Group
          as="div"
          axis="x"
          values={editorButtons}
          onReorder={onChange}
          className="flex items-center gap-2.5"
        >
          {editorButtons.map((button) => (
            <MockOrb
              key={button.id}
              button={button}
              selected={button.id === selectedId}
              reduceMotion={reduceMotion}
              routines={routines}
              onSelect={() => setSelectedId((id) => (id === button.id ? null : button.id))}
            />
          ))}
        </Reorder.Group>
        <button
          type="button"
          onClick={addButton}
          aria-label="Add a button"
          title="Add a button"
          className={`${orbBase} border-dashed border-ink/20 bg-transparent text-ink/35 hover:border-accent/50 hover:text-ink/70`}
        >
          <span className="text-lg leading-none">+</span>
        </button>
      </div>
      <p className="-mt-2 text-center text-[11px] text-ink/25">
        {reduceMotion ? 'Select an orb, then use the move controls to place it.' : 'Drag an orb to reorder, or click one to change its action.'}
      </p>

      {/* Placement + action picker for the selected orb. */}
      {selected && (
        <div className="animate-chip-pop rounded-xl border border-accent/30 bg-surface-sunken/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-medium text-ink/70">
              {SLOT_LABELS[selected.id] ?? selected.id} — position {selectedIndex + 1} of {editorButtons.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => move(-1)}
                disabled={selectedIndex <= 0}
                aria-label={`Move ${SLOT_LABELS[selected.id] ?? selected.id} left`}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/10 text-[12px] text-ink/50 transition-colors hover:border-accent/40 hover:text-ink/80 disabled:opacity-25 disabled:hover:border-ink/10 disabled:hover:text-ink/50"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                disabled={selectedIndex < 0 || selectedIndex >= editorButtons.length - 1}
                aria-label={`Move ${SLOT_LABELS[selected.id] ?? selected.id} right`}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/10 text-[12px] text-ink/50 transition-colors hover:border-accent/40 hover:text-ink/80 disabled:opacity-25 disabled:hover:border-ink/10 disabled:hover:text-ink/50"
              >
                →
              </button>
              {selected.id !== 'input' && (
                <button
                  type="button"
                  onClick={removeSelected}
                  aria-label={`Remove ${SLOT_LABELS[selected.id] ?? selected.id}`}
                  className="ml-1 flex h-7 items-center rounded-lg border border-ink/10 px-2 text-[11px] text-ink/45 transition-colors hover:border-red-400/50 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {/* The input slot is position-only — no action to rebind, no label. */}
          {selected.id !== 'input' && (
          <>
          <p className="mt-3 text-[10.5px] uppercase tracking-wide text-ink/30">Actions</p>
          <div className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {FIXED_BUTTON_ACTIONS.map((action) => {
              const meta = ACTION_META[action];
              const active = selected.action === action;
              return (
                <button
                  key={action}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update(selected.id, { action })}
                  title={meta.name}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[10.5px] transition-colors ${
                    active
                      ? 'border-accent/70 bg-accent/15 text-paper shadow-glow-accent'
                      : 'border-ink/10 bg-ink/[0.02] text-ink/50 hover:border-ink/25 hover:text-ink/80'
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center">{meta.icon}</span>
                  <span className="w-full truncate text-center">{meta.name}</span>
                </button>
              );
            })}
          </div>

          {connectedApps.length > 0 && (
            <>
              <p className="mt-3 text-[10.5px] uppercase tracking-wide text-ink/30">Connected apps</p>
              <div className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-7">
                {connectedApps.map((app) => {
                  const action = toolkitAction(app.slug);
                  const active = selected.action === action;
                  return (
                    <button
                      key={app.slug}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update(selected.id, { action })}
                      title={app.name}
                      className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[10.5px] transition-colors ${
                        active
                          ? 'border-accent/70 bg-accent/15 text-paper shadow-glow-accent'
                          : 'border-ink/10 bg-ink/[0.02] text-ink/50 hover:border-ink/25 hover:text-ink/80'
                      }`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center">
                        <ToolkitIcon app={app} className="h-5 w-5" />
                      </span>
                      <span className="w-full truncate text-center">{app.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {routines.length > 0 && (
            <>
              <p className="mt-3 text-[10.5px] uppercase tracking-wide text-ink/30">Routines</p>
              <div className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-7">
                {routines.map((routine) => {
                  const action = routineAction(routine.id);
                  const active = selected.action === action;
                  return (
                    <button
                      key={routine.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update(selected.id, { action })}
                      title={routine.name}
                      className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[10.5px] transition-colors ${
                        active
                          ? 'border-accent/70 bg-accent/15 text-paper shadow-glow-accent'
                          : 'border-ink/10 bg-ink/[0.02] text-ink/50 hover:border-ink/25 hover:text-ink/80'
                      }`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center text-[15px] leading-none">⟳</span>
                      <span className="w-full truncate text-center">{routine.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {onCreateSpecial && (
            <>
              <p className="mt-3 text-[10.5px] uppercase tracking-wide text-ink/30">Special button</p>
              <p className="mt-1 text-[11.5px] text-ink/35">
                A tiny prompt this orb fires — it can span several tools ("summarize my open GitHub PRs and post the list
                to Discord"). Unconnected tools pause with a connect card.
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="text"
                  value={specialPrompt}
                  onChange={(e) => setSpecialPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createSpecial();
                  }}
                  placeholder="e.g. check my email and github notifications"
                  aria-label="Special button prompt"
                  className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-surface-sunken px-3 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
                />
                <button
                  type="button"
                  onClick={() => void createSpecial()}
                  disabled={specialBusy || specialPrompt.trim().length === 0}
                  className="shrink-0 rounded-lg border border-accent/40 px-3 py-1.5 text-[12px] text-accent-bright transition-colors hover:bg-accent/10 disabled:opacity-30"
                >
                  {specialBusy ? 'Creating…' : 'Create & bind'}
                </button>
              </div>
            </>
          )}

          <input
            type="text"
            value={selected.label ?? ''}
            onChange={(e) => update(selected.id, { label: e.target.value })}
            placeholder="Label (optional)"
            aria-label={`Label for ${SLOT_LABELS[selected.id] ?? selected.id}`}
            className="mt-3 w-full rounded-lg border border-ink/10 bg-surface-sunken px-3 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
          />
          </>
          )}
        </div>
      )}
    </div>
  );
}
