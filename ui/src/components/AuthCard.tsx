import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';

/** Centered glass card on the animated gradient-mesh background — the auth
 * screens' shared chrome. DESIGN.md §7: "same command-bar aesthetic" — a
 * `bar-pill`-style glass surface, just not pill-shaped. */
export default function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const reduceMotion = !!useReducedMotion();
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center px-6">
      <div className="absolute inset-x-0 top-0 px-6 pt-6 text-[11px] text-white/30">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Link to="/" className="transition-colors hover:text-white/70">
            understudy
          </Link>
        </div>
      </div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.955, filter: 'blur(6px)' }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={reduceMotion ? entranceStandardReduced : entranceStandard}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-surface/70 p-8 shadow-lift backdrop-blur-[34px]"
        style={{ backdropFilter: 'blur(34px) saturate(180%)' }}
      >
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13px] text-white/50">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </motion.div>
    </div>
  );
}
