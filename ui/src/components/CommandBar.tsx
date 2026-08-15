import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import DropZone from './DropZone';
import Mic from './Mic';
import { magneticSnappy } from '../lib/motion';
import { useBurst } from '../lib/useBurst';

const GHOST = "Summarize this week's repository changes and draft a PR description.";

const SUGGESTIONS = [
  "Summarize this week's repository changes and draft a PR description.",
  'List open pull requests assigned to me and classify their risk.',
  'Extract action items from unread emails from the last 3 days.',
];

export interface DroppedFile {
  id: string;
  name: string;
  size: number;
}

interface CommandBarProps {
  running: boolean;
  /** Bumped once per `escalate` trace event — spikes the conic border's
   * spin speed for 400ms. DESIGN.md §5 Command bar. */
  escalateTick: number;
  /** 'spotlight' strips the bar to a search field: a leading glyph, an empty
   * input, and nothing else. No ghost completion, no idle suggestion list —
   * macOS Spotlight shows you a cursor and waits. Used by the Electron
   * overlay; the browser route keeps the default, which is unchanged. */
  variant?: 'default' | 'spotlight';
  onSubmit(text: string, opts: { bypassCache: boolean; source: 'text' | 'voice' }): void;
  onFilesDropped(files: File[]): void;
  onToast(message: string): void;
}

/** The pinned 60px glass pill — SPEC.md §6. Owns its own input state so the
 * mic can stream words in live; only hands the final text up on submit. */
export default function CommandBar({
  running,
  escalateTick,
  variant = 'default',
  onSubmit,
  onFilesDropped,
  onToast,
}: CommandBarProps) {
  const isSpotlight = variant === 'spotlight';
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'text' | 'voice'>('text');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [ghostAccepting, setGhostAccepting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [ringSpike, setRingSpike] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmPulsing, fireConfirmPulse] = useBurst(200);
  const [emberFlashing, fireEmberFlash] = useBurst(150);
  const [focusPulsing, fireFocusPulse] = useBurst(400);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Ring speed spike on escalation — DESIGN.md §5 Command bar. Skip the
  // initial mount (escalateTick starts at 0).
  useEffect(() => {
    if (escalateTick === 0) return;
    setRingSpike(true);
    const id = window.setTimeout(() => setRingSpike(false), 400);
    return () => window.clearTimeout(id);
  }, [escalateTick]);

  const showSuggestions = !isSpotlight && focused && !running && value.trim().length === 0;
  const filtered = SUGGESTIONS;
  const ghostSuffix = isSpotlight
    ? ''
    : value.length > 0 && GHOST.toLowerCase().startsWith(value.toLowerCase())
      ? GHOST.slice(value.length)
      : value.length === 0
        ? GHOST
        : '';

  function runNow(text: string, bypassCache: boolean) {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    fireConfirmPulse();
    if (bypassCache) fireEmberFlash();
    onSubmit(trimmed, { bypassCache, source });
    setSource('text');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab' && ghostSuffix) {
      e.preventDefault();
      setGhostAccepting(true);
      window.setTimeout(() => {
        setValue(GHOST);
        setGhostAccepting(false);
      }, 120);
      return;
    }
    if (e.key === 'Escape') {
      if (!value) {
        setHighlight(-1);
        return;
      }
      setClearing(true);
      window.setTimeout(() => {
        setValue('');
        setHighlight(-1);
        setClearing(false);
      }, 100);
      return;
    }
    if (showSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => (h + dir + filtered.length) % filtered.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = showSuggestions && highlight >= 0 ? filtered[highlight] : value;
      runNow(text, e.shiftKey);
    }
  }

  return (
    <DropZone
      onFiles={(dropped) => {
        setFiles((prev) => [
          ...prev,
          ...dropped.map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}`, name: f.name, size: f.size })),
        ]);
        onFilesDropped(dropped);
      }}
    >
      {({ isDragOver }) => (
        <div className="w-full">
          <div
            className={`bar-shell ${running ? 'is-running' : ''}`}
            style={ringSpike ? ({ '--ring-duration': '1.2s' } as React.CSSProperties) : undefined}
          >
            <div
              className={`bar-pill relative flex items-center animate-bar-in ${
                isSpotlight ? 'h-[64px] gap-3 pl-5 pr-3' : 'h-[60px] gap-2 px-3'
              } ${isDragOver ? 'is-dragover' : ''} ${confirmPulsing ? 'animate-confirm-pulse' : ''} ${
                emberFlashing ? 'animate-ember-edge-flash' : ''
              } ${focusPulsing ? 'animate-focus-glow-pulse' : ''}`}
            >
              {isSpotlight && (
                // Leading glyph instead of placeholder copy — the field reads
                // as a search field without a word of instruction in it.
                <svg
                  viewBox="0 0 24 24"
                  width="19"
                  height="19"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="shrink-0 text-white/35"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.6-3.6" />
                </svg>
              )}
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={value}
                  disabled={running}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={() => {
                    setFocused(true);
                    fireFocusPulse();
                  }}
                  onBlur={() => window.setTimeout(() => setFocused(false), 120)}
                  onKeyDown={handleKeyDown}
                  placeholder=""
                  spellCheck={false}
                  aria-label="Command"
                  className={`relative z-10 w-full origin-left bg-transparent text-white placeholder:text-white/25 outline-none transition-[transform,opacity] duration-100 ease-out disabled:opacity-50 ${
                    isSpotlight ? 'text-[19px] font-light tracking-[-0.01em]' : 'text-[15px]'
                  } ${clearing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}
                />
                {ghostSuffix && (
                  <div className="pointer-events-none absolute inset-0 flex items-center whitespace-pre text-[15px]">
                    <span className="invisible">{value}</span>
                    <span
                      className={`ghost-text transition-colors duration-[120ms] ${
                        ghostAccepting ? '!text-white' : ''
                      }`}
                    >
                      {ghostSuffix}
                    </span>
                  </div>
                )}
              </div>

              <Mic
                disabled={running}
                onInterim={(text) => {
                  setSource('voice');
                  setValue(text);
                }}
                onFinal={(text) => {
                  setSource('voice');
                  setValue(text);
                }}
                onToast={onToast}
              />
            </div>
          </div>

          {showSuggestions && (
            <div className="relative mx-1 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-surface-raised/95 backdrop-blur-xl">
              {filtered.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runNow(s, false)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`relative block w-full truncate px-4 py-2.5 text-left text-[13px] transition-colors ${
                    i === highlight ? 'text-white' : 'text-white/55 hover:bg-white/5'
                  }`}
                >
                  {i === highlight && (
                    <motion.div
                      layoutId={reduceMotion ? undefined : 'suggestion-highlight'}
                      className="absolute inset-0 bg-accent/15"
                      transition={reduceMotion ? { duration: 0 } : magneticSnappy}
                    />
                  )}
                  <span className="relative z-10">{s}</span>
                </button>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {files.map((f) => (
                <span
                  key={f.id}
                  className="animate-chip-pop flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[12px] text-accent-bright"
                >
                  {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                    className="text-accent-bright/60 hover:text-accent-bright"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </DropZone>
  );
}
