import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { KEYBINDING_ACTIONS } from '../../store/types';

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

/** Keybindings section — click "Record" then press a combo; the input
 * doubles as a text fallback (spec §5/§10: "recorder with a text fallback").
 * Warns inline on a duplicate combo across actions. */
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

  function handleKeyDown(action: string, e: ReactKeyboardEvent<HTMLInputElement>) {
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
        const isRecording = recording === action;
        return (
          <div key={action} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-[13px] text-white/60">{LABELS[action]}</span>
            <input
              type="text"
              value={isRecording ? 'Press a key…' : combo}
              readOnly={isRecording}
              onChange={(e) => onChange({ ...keybindings, [action]: e.target.value })}
              onKeyDown={(e) => handleKeyDown(action, e)}
              onFocus={() => setRecording(action)}
              onBlur={() => setRecording((r) => (r === action ? null : r))}
              placeholder="none"
              className={`w-40 rounded-lg border bg-surface-sunken px-3 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 ${
                isDuplicate ? 'border-red-400/60' : 'border-white/10 focus:border-accent/60'
              }`}
            />
            <button
              type="button"
              onClick={() => setRecording(action)}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-white/50 transition-colors hover:border-accent/40 hover:text-white/80"
            >
              {isRecording ? 'Recording…' : 'Record'}
            </button>
            {isDuplicate && <span className="text-[12px] text-red-400">duplicate combo</span>}
          </div>
        );
      })}
    </div>
  );
}
