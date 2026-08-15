import { motion, useReducedMotion } from 'framer-motion';
import TracePipeline from './TracePipeline';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';
import type { Turn } from '../lib/traceReducer';

/** One turn in the chat transcript: the submitted prompt as a right-aligned
 * bubble, followed by that run's TracePipeline output. Mounts once per turn
 * and never remounts — TracePipeline reads live off the turn's own
 * TraceState as events stream in, so re-renders (not remounts) drive the
 * trace forward. DESIGN.md's entrance-standard spring plays once when the
 * turn is appended to the transcript. */
export default function ConversationTurn({ turn }: { turn: Turn }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? entranceStandardReduced : entranceStandard}
      className="mb-8"
    >
      <div className="mb-1.5 flex justify-end px-1 text-[10px] uppercase tracking-wide text-white/25">
        {turn.source === 'voice' ? 'you · voice' : 'you'}
      </div>
      <div className="flex justify-end px-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] leading-snug text-white/85">
          {turn.prompt}
        </div>
      </div>
      <TracePipeline state={turn.trace} className="mx-auto mt-4 w-full max-w-2xl" />
    </motion.div>
  );
}
