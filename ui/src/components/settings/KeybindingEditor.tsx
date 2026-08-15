import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DEFAULT_PREFS, KEYBINDING_ACTIONS } from '../../store/types';
import { Keycap, comboToKeys } from './Keycap';

const LABELS: Record<(typeof KEYBINDING_ACTIONS)[number], string> = {
  run: 'Run',
  newline: 'Newline',
  bypassCache: 'Bypass cache',
  focus: 'Focus command bar',
  clear: 'Clear',
};

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt']);

/** Formats a keydown into the `Mod+Key` combo string the prefs schema uses
 * (spec's own example: `{ run: 'Enter', bypassCache: 'Mod+Enter' }`). `Mod`
 * covers both Cmd (mac) and Ctrl (win/linux) — the same convention the
 * command bar's own shortcuts already follow. Returns '' for a bare
 * modifier press, so the recorder waits for the real key. */
function formatCombo(e: ReactKeyboardEvent): string {
  if (MODIFIER_KEYS.has(e.key)) return '';
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('Mod');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}

/** One row's keycap cluster — record button showing the current combo as a
 * row of physical keycaps, a pulsing "press a combo…" placeholder while
 * recording, and a shake+red-tint on a fresh duplicate. Reduced motion:
 * all animation here rides Tailwind CSS keyframes, which `index.css`'s
 * global `prefers-reduced-motion` rule already collapses to a single static
 * frame — so this component needs no explicit motion gating of its own. */
function KeycapRow({
  action,
  label,
  combo,
  isDuplicate,
  isRecording,
  onStartRecording,
  onCaptureKey,
  onStopRecording,
  onReset,
  canReset,
}: {
  action: string;
  label: string;
  combo: string;
  isDuplicate: boolean;
  isRecording: boolean;
  onStartRecording(): void;
  onCaptureKey(e: ReactKeyboardEvent<HTMLButtonElement>): void;
  onStopRecording(): void;
  onReset(): void;
  canReset: boolean;
}) {
  const keys = comboToKeys(combo);
  // Only replay the shake burst when the row *becomes* a duplicate, not on
  // every re-render while it stays one — a CSS class only restarts its
  // keyframe animation when freshly applied.
  const wasDuplicate = useRef(isDuplicate);
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (isDuplicate && !wasDuplicate.current) {
      setShaking(true);
      const t = window.setTimeout(() => setShaking(false), 450);
      wasDuplicate.current = isDuplicate;
      return () => window.clearTimeout(t);
    }
    wasDuplicate.current = isDuplicate;
  }, [isDuplicate]);

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-surface-sunken/60 px-4 py-3 transition-colors">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-white/80">{label}</span>
        {isDuplicate && <span className="text-[11px] text-red-400">duplicate combo — another action uses this too</span>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={
            isRecording
              ? `Recording keybinding for ${label} — press a combo`
              : `Record keybinding for ${label}${combo ? `, currently ${combo}` : ', none set'}`
          }
          onClick={onStartRecording}
          onKeyDown={onCaptureKey}
          onBlur={onStopRecording}
          className={`flex min-w-[7rem] items-center gap-1.5 rounded-lg px-1.5 py-1 outline-none transition-shadow ${
            isRecording ? 'ring-2 ring-accent/70 animate-focus-glow-pulse' : 'focus-visible:ring-2 focus-visible:ring-accent/50'
          } ${shaking ? 'animate-shake-glow' : ''}`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {isRecording ? (
              <motion.span
                key="recording"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="animate-pulse px-2 text-[12px] font-medium text-accent-bright"
              >
                press a combo…
              </motion.span>
            ) : keys.length > 0 ? (
              keys.map((k, i) => (
                <span key={`${combo}-${i}`} className="animate-chip-pop">
                  <Keycap tone={isDuplicate ? 'warning' : 'default'}>{k}</Keycap>
                </span>
              ))
            ) : (
              <Keycap tone="ghost">—</Keycap>
            )}
          </AnimatePresence>
        </button>

        <button
          type="button"
          disabled={!canReset}
          onClick={onReset}
          title="Reset to default"
          aria-label={`Reset ${label} keybinding to default`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[13px] text-white/40 transition-colors hover:border-accent/40 hover:text-white/80 disabled:opacity-25 disabled:hover:border-white/10 disabled:hover:text-white/40"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

/** Keybindings section, reskinned as physical keycap chips — press-to-record
 * instead of a text input. Click a row to enter record mode (keycaps glow),
 * press a combo, it pops in as fresh keycaps; a combo already used elsewhere
 * shakes + red-tints. Same `Record<action, combo>` shape as before, so
 * Settings' Save flow is untouched. */
export default function KeybindingEditor({
  keybindings,
  onChange,
}: {
  keybindings: Record<string, string>;
  onChange(next: Record<string, string>): void;
}) {
  const [recording, setRecording] = useState<string | null>(null);

  const counts = new Map<string, number>();
  for (const combo of Object.values(keybindings)) {
    if (!combo) continue;
    counts.set(combo, (counts.get(combo) ?? 0) + 1);
  }

  function handleCaptureKey(action: string, e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (recording !== action) return;
    e.preventDefault();
    const combo = formatCombo(e);
    if (!combo) return;
    onChange({ ...keybindings, [action]: combo });
    setRecording(null);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {KEYBINDING_ACTIONS.map((action) => {
        const combo = keybindings[action] ?? '';
        const isDuplicate = combo !== '' && (counts.get(combo) ?? 0) > 1;
        return (
          <KeycapRow
            key={action}
            action={action}
            label={LABELS[action]}
            combo={combo}
            isDuplicate={isDuplicate}
            isRecording={recording === action}
            onStartRecording={() => setRecording(action)}
            onCaptureKey={(e) => handleCaptureKey(action, e)}
            onStopRecording={() => setRecording((r) => (r === action ? null : r))}
            onReset={() => onChange({ ...keybindings, [action]: DEFAULT_PREFS.keybindings[action] ?? '' })}
            canReset={combo !== (DEFAULT_PREFS.keybindings[action] ?? '')}
          />
        );
      })}
    </div>
  );
}
