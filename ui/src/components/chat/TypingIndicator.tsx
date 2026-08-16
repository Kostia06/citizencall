import { motion, useReducedMotion } from 'framer-motion';
import { entranceStandard, entranceStandardReduced } from '../../lib/motion';

/** ChatGPT-style "assistant is typing" cue — the very first thing shown the
 * instant a turn starts, before any trace event has arrived to narrate
 * progress. Same shell as the eventual answer bubble (StatusLine/AnswerBubble
 * take over from here) so the swap never jumps. */
export default function TypingIndicator() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? entranceStandardReduced : entranceStandard}
      className="mx-auto mt-4 w-full max-w-2xl px-1"
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-white/25">understudy</div>
      <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-accent/20 bg-accent/[0.05] px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse"
            style={{ animationDelay: `${i * 160}ms`, animationDuration: '1s' }}
          />
        ))}
      </div>
    </motion.div>
  );
}
