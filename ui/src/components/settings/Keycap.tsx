import type { ReactNode } from 'react';

// Display glyphs for the non-printable tokens `formatCombo` (KeybindingEditor)
// emits — mirrors the `Mod+Key` convention already used by the prefs schema
// and the command bar's own shortcuts.
const KEY_GLYPHS: Record<string, string> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Control: 'Ctrl',
  Enter: '⏎',
  Escape: 'Esc',
  Space: 'Space',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Splits a `Mod+Shift+Enter`-style combo string into display tokens, one per
 * keycap — special keys resolve to their glyph, single characters uppercase. */
export function comboToKeys(combo: string): string[] {
  if (!combo) return [];
  return combo.split('+').map((part) => KEY_GLYPHS[part] ?? (part.length === 1 ? part.toUpperCase() : part));
}

/** One physical-feeling keycap — inset glass face, top-edge highlight, mono
 * label. Purely presentational (the interactive surface is the row button
 * that wraps a group of these); DESIGN.md glass/elevation tokens. */
export function Keycap({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'ghost' | 'warning' }) {
  const toneClass =
    tone === 'warning'
      ? 'border-red-400/50 bg-red-400/10 text-red-200'
      : tone === 'ghost'
        ? 'border-white/10 bg-white/[0.02] text-white/25'
        : 'border-white/15 bg-white/[0.07] text-white/85';
  return (
    <span
      className={`relative flex h-8 min-w-[2rem] items-center justify-center rounded-lg border px-2 font-mono text-[13px] font-medium leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_5px_rgba(0,0,0,0.45)] ${toneClass}`}
    >
      <span className="pointer-events-none absolute inset-x-1 top-[3px] h-px rounded-full bg-white/25" />
      {children}
    </span>
  );
}
