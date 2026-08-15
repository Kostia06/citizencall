import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { fetchBenchmark, fetchRoster } from '../api';
import { formatDownloads, formatPct, formatUsd, timeAgo } from '../lib/format';
import { entranceStandardReduced, headlineVariants } from '../lib/motion';
import type { RosterEntry, TaskKind } from '../types';

const KIND_LABEL: Record<TaskKind, string> = {
  classify: 'classify',
  extract_fields: 'extraction',
  summarize: 'summarization',
  normalize: 'normalization',
};

function shortName(modelId: string): string {
  return modelId.split('/').pop() ?? modelId;
}

/** Cold-open screen — SPEC.md §15 0:00–0:20. Must land the surprise before
 * anyone explains anything: a near-unused model, measured, promoted. */
export default function Roster() {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [frontierCostPer1k, setFrontierCostPer1k] = useState<number | null>(null);
  const reduceMotion = !!useReducedMotion();
  const { parent: headlineParent, line: headlineLine } = headlineVariants(reduceMotion);

  useEffect(() => {
    fetchRoster().then(setRoster);
    fetchBenchmark().then((b) => setFrontierCostPer1k(b.baselines.glm_only.costPer1k));
  }, []);

  const headline =
    roster && roster.length > 0
      ? roster.reduce((min, r) => (r.hfDownloads < min.hfDownloads ? r : min), roster[0])
      : undefined;
  const ratio = headline && frontierCostPer1k ? frontierCostPer1k / headline.costPer1k : null;

  return (
    <div className="min-h-screen w-full px-6 pb-24 pt-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between text-[11px] text-white/30">
          <span>understudy</span>
          <Link to="/" className="transition-colors hover:text-white/70">
            ← bar
          </Link>
        </div>

        {headline && (
          <motion.div className="mt-10" variants={headlineParent} initial="hidden" animate="show">
            <motion.p
              variants={headlineLine}
              className="text-[12px] font-medium uppercase tracking-[0.2em] text-accent-bright"
            >
              promoted from 34,504 tool-use-capable open models
            </motion.p>
            {/* Cold-open headline — the one screen that should feel like a
                title card, not a UI screen. Each line staggers in 60ms apart
                via entrance-standard — DESIGN.md §5 Roster. */}
            <h1 className="mt-4 max-w-2xl text-headline-1 font-semibold leading-[1.1] text-white">
              <motion.span variants={headlineLine} className="block">
                {formatDownloads(headline.hfDownloads)} downloads.
              </motion.span>
              <motion.span variants={headlineLine} className="block">
                Nobody uses <span className="font-mono text-white/90">{shortName(headline.modelId)}</span>.
              </motion.span>
            </h1>
            <motion.p variants={headlineLine} className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/55">
              On {KIND_LABEL[headline.taskKind]} it matches{' '}
              <span className="font-mono text-white/70">{shortName(headline.displacedModelId)}</span> at
              {ratio ? ` ${ratio.toFixed(0)}×` : ''} lower price per 1,000 calls — and we didn't pick it. We
              measured it, against labels we wrote ourselves.
            </motion.p>
          </motion.div>
        )}

        <div className="mt-12 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-wide text-white/35">
                <th className="px-4 py-3 font-medium">task</th>
                <th className="px-4 py-3 font-medium">model</th>
                <th className="px-4 py-3 font-medium">hf downloads</th>
                <th className="px-4 py-3 font-medium">displaced</th>
                <th className="px-4 py-3 font-medium">accuracy (95% CI)</th>
                <th className="px-4 py-3 font-medium">cost / 1k</th>
                <th className="px-4 py-3 font-medium">promoted</th>
              </tr>
            </thead>
            <tbody>
              {roster === null &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-3 w-full animate-pulse rounded bg-white/5" />
                    </td>
                  </tr>
                ))}
              {roster?.map((r, i) => (
                <motion.tr
                  key={`${r.taskKind}-${r.modelId}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion ? entranceStandardReduced : { ...headlineLine.show.transition, delay: i * 0.04 }
                  }
                  className={`relative border-b border-white/5 border-l-2 border-l-transparent hover:border-l-accent hover:bg-white/[0.03] ${
                    r.modelId === headline?.modelId ? 'bg-accent/[0.05]' : ''
                  }`}
                  style={{ transition: 'border-color 150ms ease-out, background-color 150ms ease-out' }}
                >
                  <td className="px-4 py-3.5 text-white/60">{KIND_LABEL[r.taskKind]}</td>
                  <td className="px-4 py-3.5 font-mono text-white/90">{shortName(r.modelId)}</td>
                  <td className="px-4 py-3.5 font-mono tabular-nums text-white/60">
                    {formatDownloads(r.hfDownloads)}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-white/45">{shortName(r.displacedModelId)}</td>
                  <td className="px-4 py-3.5 font-mono tabular-nums text-white/70">
                    {formatPct(r.accuracy * 100)}{' '}
                    <span className="text-white/30">
                      [{formatPct(r.ciLo * 100)}, {formatPct(r.ciHi * 100)}]
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono tabular-nums text-emerald-400/90">
                    {formatUsd(r.costPer1k)}
                  </td>
                  <td className="px-4 py-3.5 text-white/35">{timeAgo(r.promotedAt)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
