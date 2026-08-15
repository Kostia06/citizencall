import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import DropZone from './DropZone';
import Mic from './Mic';
import { layoutFlow, layoutFlowReduced, magneticSnappy } from '../lib/motion';
import { useBurst } from '../lib/useBurst';
import type { RunAttachment } from '../types';

const GHOST = "Summarize this week's repository changes and draft a PR description.";

const SUGGESTIONS = [
  "Summarize this week's repository changes and draft a PR description.",
  'List open pull requests assigned to me and classify their risk.',
  'Extract action items from unread emails from the last 3 days.',
];

// Auto-grow ceiling — DESIGN.md's body token is 15px/1.5, so ~6 lines caps
// the pill before it scrolls internally instead of eating the page.
const MAX_LINES = 6;

export type Attachment = RunAttachment;

interface CommandBarProps {
  running: boolean;
  /** Bumped once per `escalate` trace event — spikes the conic border's
   * spin speed for 400ms. DESIGN.md §5 Command bar. */
  escalateTick: number;
  onSubmit(text: string, opts: { bypassCache: boolean; source: 'text' | 'voice'; attachments: Attachment[] }): void;
  onFilesDropped(files: File[]): void;
  onToast(message: string): void;
}

let attachmentSeq = 0;
function nextAttachmentId(kind: string): string {
  attachmentSeq += 1;
  return `${kind}-${Date.now().toString(36)}-${attachmentSeq}`;
}

function fileToAttachment(file: File, kind: Attachment['kind']): Attachment {
  return {
    id: nextAttachmentId(kind),
    name: file.name || (kind === 'clipboard-image' ? `clipboard-image-${attachmentSeq}.png` : 'clipboard file'),
    kind,
    size: file.size,
    mimeType: file.type || undefined,
  };
}

/** The pinned glass pill — SPEC.md §6. Owns its own input state so the mic
 * can stream words in live; only hands the final text (+ attachments) up on
 * submit. The textarea auto-grows up to MAX_LINES, then scrolls internally. */
export default function CommandBar({ running, escalateTick, onSubmit, onFilesDropped, onToast }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'text' | 'voice'>('text');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [ghostAccepting, setGhostAccepting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [ringSpike, setRingSpike] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const maxHeightRef = useRef(168); // ~6 lines + vertical padding, refined on mount
  const [confirmPulsing, fireConfirmPulse] = useBurst(200);
  const [emberFlashing, fireEmberFlash] = useBurst(150);
  const [focusPulsing, fireFocusPulse] = useBurst(400);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
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

  // Measure the real line-height (+ vertical padding, now that padding
  // lives on the textarea itself rather than the pill row) once mounted so
  // the 6-line cap tracks the actual rendered font instead of a guessed
  // constant.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight);
    const paddingY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    if (Number.isFinite(lineHeight) && lineHeight > 0) {
      maxHeightRef.current = lineHeight * MAX_LINES + (Number.isFinite(paddingY) ? paddingY : 0);
    }
  }, []);

  // Auto-grow: collapse then re-measure scrollHeight so we never overshoot,
  // clamp to MAX_LINES. The `.bar-textarea` CSS transition (index.css) is
  // what turns this into a smooth reflow rather than a snap.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, maxHeightRef.current);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeightRef.current ? 'auto' : 'hidden';
  }, [value]);

  const showSuggestions = focused && !running && value.trim().length === 0;
  const filtered = SUGGESTIONS;
  const ghostSuffix =
    value.length > 0 && GHOST.toLowerCase().startsWith(value.toLowerCase()) ? GHOST.slice(value.length) : value.length === 0 ? GHOST : '';

  function runNow(text: string, bypassCache: boolean) {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    fireConfirmPulse();
    if (bypassCache) fireEmberFlash();
    onSubmit(trimmed, { bypassCache, source, attachments });
    // This is a chat now — the submitted prompt reappears as its own bubble
    // in the transcript (ConversationTurn.tsx), so the bar clears and is
    // immediately ready for the next turn instead of sitting frozen with
    // the old text while the run plays out below.
    setValue('');
    setAttachments([]);
    setSource('text');
  }

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => v + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function addAttachments(next: Attachment[]) {
    if (next.length === 0) return;
    setAttachments((prev) => [...prev, ...next]);
  }

  async function handleClipboardButton() {
    if (running) return;
    const clipboard = navigator.clipboard as (Clipboard & { read?(): Promise<ClipboardItem[]> }) | undefined;
    try {
      if (clipboard?.read) {
        const items = await clipboard.read();
        const newAttachments: Attachment[] = [];
        let insertedText = false;
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              newAttachments.push({
                id: nextAttachmentId('clipboard-image'),
                name: `clipboard-image-${newAttachments.length + 1}.${type.split('/')[1] ?? 'png'}`,
                kind: 'clipboard-image',
                size: blob.size,
                mimeType: type,
              });
            } else if (type === 'text/plain' && !insertedText) {
              const blob = await item.getType(type);
              const text = (await blob.text()).trim();
              if (text) {
                insertAtCursor(text);
                insertedText = true;
              }
            }
          }
        }
        addAttachments(newAttachments);
        if (!insertedText && newAttachments.length === 0) onToast('Clipboard is empty');
      } else if (clipboard?.readText) {
        const text = (await clipboard.readText()).trim();
        if (text) insertAtCursor(text);
        else onToast('Clipboard is empty');
      } else {
        onToast('Clipboard access unavailable in this browser');
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      onToast(name === 'NotAllowedError' ? 'Clipboard permission denied' : 'Could not read clipboard');
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const fileItems = Array.from(items).filter((it) => it.kind === 'file');
    if (fileItems.length === 0) return; // plain text — let the browser paste it normally
    e.preventDefault();
    const newAttachments = fileItems
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null)
      .map((f) => fileToAttachment(f, f.type.startsWith('image/') ? 'clipboard-image' : 'file'));
    if (newAttachments.length === 0) return;
    addAttachments(newAttachments);
    onToast(`${newAttachments.length} item${newAttachments.length === 1 ? '' : 's'} attached from clipboard`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
      if (e.shiftKey) return; // newline — let the textarea handle it
      e.preventDefault();
      const bypassCache = e.metaKey || e.ctrlKey;
      const text = showSuggestions && highlight >= 0 ? filtered[highlight] : value;
      if (text !== undefined) runNow(text, bypassCache);
    }
  }

  return (
    <DropZone
      onFiles={(dropped) => {
        addAttachments(dropped.map((f) => fileToAttachment(f, 'file')));
        onFilesDropped(dropped);
      }}
    >
      {({ isDragOver }) => (
        <div className="w-full">
          <motion.div
            layout={!reduceMotion}
            transition={reduceMotion ? layoutFlowReduced : layoutFlow}
            className={`bar-shell ${running ? 'is-running' : ''}`}
            style={ringSpike ? ({ '--ring-duration': '1.2s' } as React.CSSProperties) : undefined}
          >
            <motion.div
              layout={!reduceMotion}
              transition={reduceMotion ? layoutFlowReduced : layoutFlow}
              className={`bar-pill relative animate-bar-in ${isDragOver ? 'is-dragover' : ''} ${
                confirmPulsing ? 'animate-confirm-pulse' : ''
              } ${emberFlashing ? 'animate-ember-edge-flash' : ''} ${focusPulsing ? 'animate-focus-glow-pulse' : ''}`}
            >
              {/* Icons are anchored to the bottom-right of the pill, not
                  centered inline with the text row — that's what keeps them
                  clear of wrapped text on every line, not just the first.
                  The textarea's pr-24 reserves their width uniformly, so a
                  2+ line prompt never runs underneath them. */}
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={value}
                  disabled={running}
                  rows={1}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={() => {
                    setFocused(true);
                    fireFocusPulse();
                  }}
                  onBlur={() => window.setTimeout(() => setFocused(false), 120)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  spellCheck={false}
                  aria-label="Command"
                  className={`bar-textarea relative z-10 block w-full origin-left resize-none overflow-hidden bg-transparent py-[18px] pl-4 pr-24 text-[15px] leading-[1.5] text-white placeholder:text-white/25 outline-none transition-[transform,opacity] duration-100 ease-out disabled:opacity-50 ${
                    clearing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
                  }`}
                />
                {ghostSuffix && (
                  <div className="pointer-events-none absolute inset-0 top-0 flex items-start whitespace-pre-wrap py-[18px] pl-4 pr-24 text-[15px] leading-[1.5]">
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

              <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={running}
                  aria-label="Paste from clipboard"
                  onClick={handleClipboardButton}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8E8E93] transition-colors hover:text-white disabled:opacity-30"
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                    <rect x="7" y="3.5" width="10" height="4" rx="1.2" />
                    <path
                      d="M7 5.5H5.5a1.5 1.5 0 0 0-1.5 1.5v12.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

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
            </motion.div>
          </motion.div>

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

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="animate-chip-pop flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[12px] text-accent-bright"
                >
                  <AttachmentIcon kind={a.kind} mimeType={a.mimeType} />
                  <span className="max-w-[180px] truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
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

function AttachmentIcon({ kind, mimeType }: { kind: Attachment['kind']; mimeType?: string }) {
  const isImage = kind === 'clipboard-image' || mimeType?.startsWith('image/');
  if (isImage) {
    return (
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="M21 16l-5.5-5.5a1.5 1.5 0 0 0-2.12 0L3 20" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'clipboard-text') {
    return (
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="6" y="3.5" width="12" height="4" rx="1" />
        <path
          d="M6 5.5H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 21.5h14a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 19 5.5h-1"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinejoin="round" />
    </svg>
  );
}
