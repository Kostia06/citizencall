import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { fetchRosterReport } from '../api';
import type { RosterModelEntry, RosterReport } from '../api';
import TopNav from '../components/TopNav';
import { formatMs, formatPct, formatUsd } from '../lib/format';
import { entranceStandardReduced, headlineVariants } from '../lib/motion';
import type { TaskKind } from '../types';

const KIND_LABEL: Record<TaskKind, string> = {
  classify: 'classify',
  extract_fields: 'extraction',
  summarize: 'summarization',
  normalize: 'normalization',
};

const ROLE_LABEL: Record<RosterModelEntry['role'], string> = {
  rung0: 'rung 0',
  rung1: 'rung 1',
  alternate: 'alternate',
};

function shortName(modelId: string): string {
  return modelId.split('/').pop() ?? modelId;
}

function combinedPrice(m: RosterModelEntry): number {
  return m.pricePerMTokIn + m.pricePerMTokOut;
}

/** $/1M tokens, compact: whole dollars get 2 decimals, sub-cent gets 3. */
function fmtMTok(n: number): string {
  return n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

/** Cold-open screen — SPEC.md §15 0:00–0:20. The live ladder: per task kind,
 * rung 0 (cheap, live-verified) escalating to rung 1 (frontier), plus the
 * probed alternates, with real prices and real usage stats from D1. */
export default function Roster() {
  const [report, setReport] = useState<RosterReport | null>(null);
  const reduceMotion = !!useReducedMotion();
  const { parent: headlineParent, line: headlineLine } = headlineVariants(reduceMotion);

  useEffect(() => {
    fetchRosterReport().then(setReport);
  }, []);

  // Headline: the widest live price gap between a rung-0 pick and the
  // frontier it escalates to.
  let headline: { rung0: RosterModelEntry; rung1: RosterModelEntry; kind: TaskKind } | null = null;
  if (report) {
    for (const k of report.kinds) {
      const r0 = k.models.find((m) => m.role === 'rung0');
      const r1 = k.models.find((m) => m.role === 'rung1');
      if (!r0 || !r1) continue;
      if (!headline || combinedPrice(r1) / combinedPrice(r0) > combinedPrice(headline.rung1) / combinedPrice(headline.rung0)) {
        headline = { rung0: r0, rung1: r1, kind: k.kind };
      }
    }
  }
  const ratio = headline ? combinedPrice(headline.rung1) / combinedPrice(headline.rung0) : null;

  return (
    <div className="min-h-screen w-full px-6 pb-24 pt-6">
      <div className="mx-auto max-w-3xl">
        <TopNav />

        {headline && report && (
          <motion.div className="mt-10" variants={headlineParent} initial="hidden" animate="show">
            <motion.p
              variants={headlineLine}
              className="text-[12px] font-medium uppercase tracking-[0.2em] text-accent-bright"
            >
              policy {report.policyVersion}
              {report.verifiedAt ? ` · live-verified ${report.verifiedAt}` : ''}
            </motion.p>
            <h1 className="mt-4 max-w-2xl text-headline-1 font-semibold leading-[1.1] text-ink">
              <motion.span variants={headlineLine} className="block">
                {ratio ? `${ratio.toFixed(0)}× cheaper per token.` : 'The live ladder.'}
              </motion.span>
              <motion.span variants={headlineLine} className="block">
                <span className="font-mono text-ink/90">{shortName(headline.rung0.modelId)}</span> before{' '}
                <span className="font-mono text-ink/60">{shortName(headline.rung1.modelId)}</span>.
              </motion.span>
            </h1>
            <motion.p variants={headlineLine} className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink/55">
              Every model below answered a real completion probe on Featherless before it earned a slot — prices
              are the live per-1M-token rates, stats are live totals from this deployment's runs.
            </motion.p>
          </motion.div>
        )}

        {report === null && (
          <div className="mt-12 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-ink/10 bg-ink/[0.03]" />
            ))}
          </div>
        )}

        <div className="mt-12 space-y-8">
          {report?.kinds.map((k, ki) => (
            <motion.section
              key={k.kind}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? entranceStandardReduced : { ...headlineLine.show.transition, delay: ki * 0.06 }}
            >
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink/40">
                {KIND_LABEL[k.kind]}
              </h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-ink/10">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ink/[0.03] text-[11px] uppercase tracking-wide text-ink/35">
                      <th className="px-4 py-2.5 font-medium">rung</th>
                      <th className="px-4 py-2.5 font-medium">model</th>
                      <th className="px-4 py-2.5 font-medium">$ / 1M in · out</th>
                      <th className="px-4 py-2.5 font-medium">runs</th>
                      <th className="px-4 py-2.5 font-medium">verify pass</th>
                      <th className="px-4 py-2.5 font-medium">avg latency</th>
                      <th className="px-4 py-2.5 font-medium">spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {k.models.map((m) => (
                      <tr
                        key={m.modelId}
                        className={`border-b border-ink/5 border-l-2 last:border-b-0 hover:bg-ink/[0.03] ${
                          m.role === 'rung0'
                            ? 'border-l-accent bg-accent/[0.04]'
                            : m.role === 'rung1'
                              ? 'border-l-ink/25'
                              : 'border-l-transparent'
                        }`}
                        style={{ transition: 'background-color 150ms ease-out' }}
                      >
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                              m.role === 'rung0'
                                ? 'bg-accent/15 text-accent-bright'
                                : m.role === 'rung1'
                                  ? 'bg-ink/10 text-ink/70'
                                  : 'bg-ink/[0.04] text-ink/40'
                            }`}
                          >
                            {ROLE_LABEL[m.role]}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-ink/90">
                          {shortName(m.modelId)}
                          <span className="ml-2 text-[11px] text-ink/30">{m.paramsB}B</span>
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-emerald-400/90">
                          {fmtMTok(m.pricePerMTokIn)} · {fmtMTok(m.pricePerMTokOut)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-ink/60">{m.stats.runs}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-ink/70">
                          {m.stats.passRate === null ? (
                            <span className="text-ink/25">—</span>
                          ) : (
                            formatPct(m.stats.passRate * 100)
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-ink/60">
                          {m.stats.avgLatencyMs === null ? (
                            <span className="text-ink/25">—</span>
                          ) : (
                            formatMs(m.stats.avgLatencyMs)
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-ink/60">
                          {m.stats.totalCostUsd > 0 ? formatUsd(m.stats.totalCostUsd) : <span className="text-ink/25">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.section>
          ))}
        </div>

        {report && (
          <p className="mt-8 text-[11px] text-ink/25">
            Rung 0 answers first; the verifier escalates failures to rung 1. Alternates are live-probed
            servable backups at other size/price points — wired in the policy, not yet routed.
          </p>
        )}
      </div>
    </div>
  );
}
