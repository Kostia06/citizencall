import { useEffect, useRef, useState } from 'react';
import DropZone from './DropZone';
import Mic from './Mic';

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
  onSubmit(text: string, opts: { bypassCache: boolean; source: 'text' | 'voice' }): void;
  onFilesDropped(files: File[]): void;
  onToast(message: string): void;
}

/** The pinned 60px glass pill — SPEC.md §6. Owns its own input state so the
 * mic can stream words in live; only hands the final text up on submit. */
export default function CommandBar({ running, onSubmit, onFilesDropped, onToast }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'text' | 'voice'>('text');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const showSuggestions = focused && !running && value.trim().length === 0;
  const filtered = SUGGESTIONS;
  const ghostSuffix =
    value.length > 0 && GHOST.toLowerCase().startsWith(value.toLowerCase()) ? GHOST.slice(value.length) : value.length === 0 ? GHOST : '';

  function runNow(text: string, bypassCache: boolean) {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    onSubmit(trimmed, { bypassCache, source });
    setSource('text');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab' && ghostSuffix) {
      e.preventDefault();
      setValue(GHOST);
      return;
    }
    if (e.key === 'Escape') {
      setValue('');
      setHighlight(-1);
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
          <div className={`bar-shell ${running ? 'is-running' : ''}`}>
            <div
              className={`bar-pill relative flex h-[60px] items-center gap-2 px-3 animate-bar-in ${
                isDragOver ? 'is-dragover' : ''
              }`}
            >
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={value}
                  disabled={running}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => window.setTimeout(() => setFocused(false), 120)}
                  onKeyDown={handleKeyDown}
                  placeholder={value ? '' : ''}
                  spellCheck={false}
                  aria-label="Command"
                  className="relative z-10 w-full bg-transparent text-[15px] text-white placeholder:text-white/25 outline-none disabled:opacity-50"
                />
                {ghostSuffix && (
                  <div className="pointer-events-none absolute inset-0 flex items-center whitespace-pre text-[15px]">
                    <span className="invisible">{value}</span>
                    <span className="ghost-text">{ghostSuffix}</span>
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
            <div className="mx-1 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-surface-raised/95 backdrop-blur-xl">
              {filtered.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runNow(s, false)}
                  className={`block w-full truncate px-4 py-2.5 text-left text-[13px] transition-colors ${
                    i === highlight ? 'bg-accent/15 text-white' : 'text-white/55 hover:bg-white/5'
                  }`}
                >
                  {s}
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
