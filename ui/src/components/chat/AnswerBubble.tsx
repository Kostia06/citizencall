import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { entranceStandard, entranceStandardReduced } from '../../lib/motion';
import TypewriterText from './TypewriterText';
import { renderMarkdownLite } from './MarkdownLite';

/** The turn's primary content — ANSWER FIRST, per the redesign: full-width,
 * comfortable type. Two reveal modes:
 *  - `streamed` — the text arrives as real `answer_delta` chunks from the
 *    worker; render it raw as it grows, with a blinking caret while the run
 *    is still in flight. No TypewriterText: replaying a client-side reveal
 *    over text the user already watched stream would double-animate it.
 *  - default — the answer arrived whole (replay, restored, mock): the
 *    word-by-word typewriter fakes the streaming feel (instant for restored
 *    turns / reduced motion).
 * Copy is always available on hover (or always-on for touch, via the `sm:`
 * breakpoint on the toolbar's opacity); Stop only while the run backing this
 * turn is still in flight; Regenerate (↻) only once it isn't. */
export default function AnswerBubble({
  text,
  instant = false,
  running = false,
  streamed = false,
  onStop,
  onRegenerate,
  regenerateDisabled = false,
}: {
  text: string;
  instant?: boolean;
  running?: boolean;
  streamed?: boolean;
  onStop?: () => void;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? entranceStandardReduced : entranceStandard}
      className="group mx-auto mt-4 w-full max-w-2xl px-1"
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-white/25">understudy</div>
      <div className="w-full whitespace-pre-wrap rounded-2xl rounded-bl-md border border-accent/20 bg-accent/[0.05] px-4 py-3 text-[13.5px] leading-relaxed text-white/90">
        {streamed ? (
          <>
            {renderMarkdownLite(text)}
            {running && (
              <span
                className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle"
                aria-hidden
              />
            )}
          </>
        ) : (
          <TypewriterText text={text} instant={instant || !!reduceMotion} />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3 px-1 text-[11px] text-white/35 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button type="button" onClick={handleCopy} className="transition-colors hover:text-white/70">
          {copied ? 'copied ✓' : 'copy'}
        </button>
        {!running && onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerateDisabled}
            title="Regenerate (bypasses cache)"
            aria-label="Regenerate (bypasses cache)"
            className="transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-white/35"
          >
            ↻ regenerate
          </button>
        )}
        {running && onStop && (
          <button type="button" onClick={onStop} className="transition-colors hover:text-white/70">
            stop
          </button>
        )}
      </div>
    </motion.div>
  );
}
