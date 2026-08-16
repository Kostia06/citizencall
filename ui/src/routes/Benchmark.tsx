import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { fetchBenchmarkReport } from '../api';
import type { BenchmarkReport } from '../api';
import TopNav from '../components/TopNav';
import { formatMs, formatPct, formatUsd, timeAgo, useCountUp } from '../lib/format';

/** Live benchmark — SPEC.md §10, §15 1:05–1:35. The bars are the headline
 * (frontier baseline vs cheap-default vs CitizenCall, from real D1 runs); the
 * totals row and the run table below are the receipts. */
export default function Benchmark() {
  const [data, setData] = useState<BenchmarkReport | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    fetchBenchmarkReport().then(setData);
  }, []);

  const hasRuns = !!data && data.totals.runs > 0;
  const maxCost = hasRuns ? Math.max(...data.bars.map((b) => b.costUsd), Number.EPSILON) : 1;

  return (
    <div className="min-h-screen w-full px-6 pb-24 pt-6">
      <div className="mx-auto max-w-3xl">
        <TopNav />

        <div className="mt-8">
          <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-accent-bright">
            live · policy {data?.policyVersion ?? '…'}
          </p>
          <h1 className="mt-3 text-[clamp(1.5rem,3.5vw,2.25rem)] font-semibold text-ink">
            What this deployment actually spent
          </h1>
        <p className="mt-1 text-[12px] text-ink/35">
          Full specialist roster (per-kind ladder, prices, provenance):{' '}
          <Link to="/roster" className="text-accent-bright hover:text-accent">/roster</Link>
        </p>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink/50">
            Every run's measured cost vs the frontier baseline measured alongside it — and the honest
            comparison, the same tokens repriced at the obvious cheap default.
          </p>
        </div>

        {data === null && (
          <div className="mt-12 grid grid-cols-3 items-end gap-4" style={{ height: 280 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex h-full flex-col justify-end">
                <div className="w-full animate-pulse rounded-t-xl bg-ink/5" style={{ height: '40%' }} />
              </div>
            ))}
          </div>
        )}

        {data && !hasRuns && (
          <div className="mt-16 rounded-2xl border border-dashed border-ink/15 px-8 py-16 text-center">
            <p className="text-[15px] text-ink/70">No runs yet.</p>
            <p className="mt-2 text-[13px] text-ink/40">
              Ask something in the command bar — every run lands here with its cost, its baseline, and what it
              saved.
            </p>
          </div>
        )}

        {hasRuns && data && (
          <>
            {/* Totals strip — the four numbers that summarize the deployment. */}
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="runs" value={String(data.totals.runs)} />
              <StatTile
                label="saved vs frontier"
                value={formatPct(data.totals.savingsPct)}
                accent
              />
              <StatTile label="cache-hit rate" value={formatPct(data.totals.cacheHitRate * 100)} />
              <StatTile
                label="latency p50 · p95"
                value={`${formatMs(data.totals.p50LatencyMs)} · ${formatMs(data.totals.p95LatencyMs)}`}
              />
            </div>

            <div
              className="mt-12 grid items-end gap-4"
              style={{ height: 300, gridTemplateColumns: `repeat(${data.bars.length}, minmax(0, 1fr))` }}
            >
              {data.bars.map((bar, i) => {
                const isCitizenCall = bar.key === 'understudy';
                const heightPct = Math.max(4, (bar.costUsd / maxCost) * 100);
                return (
                  <BenchmarkBarColumn
                    key={bar.key}
                    index={i}
                    heightPct={heightPct}
                    costUsd={bar.costUsd}
                    colorClass={
                      isCitizenCall ? 'bg-accent' : bar.key === 'cheap_default' ? 'bg-accent/40' : 'bg-ink/10'
                    }
                    reduceMotion={!!reduceMotion}
                  >
                    <div className="mt-3 text-center">
                      <p
                        className={`text-[12px] font-medium leading-snug ${
                          isCitizenCall ? 'text-ink/85' : 'text-ink/50'
                        }`}
                      >
                        {bar.label}
                      </p>
                      {bar.note && <p className="mt-0.5 text-[11px] text-ink/35">{bar.note}</p>}
                      {isCitizenCall && (
                        <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-accent-bright">
                          the thing we built
                        </p>
                      )}
                    </div>
                  </BenchmarkBarColumn>
                );
              })}
            </div>

            {data.perKind.length > 0 && (
              <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {data.perKind.map((k) => (
                  <div key={k.kind} className="rounded-2xl border border-ink/10 bg-ink/[0.03] p-4">
                    <p className="text-[11px] uppercase tracking-wide text-ink/35">{k.kind}</p>
                    <p className="mt-1.5 font-mono text-[13px] text-ink/85">
                      {k.topModel ? k.topModel.split('/').pop() : '—'}
                    </p>
                    <p className="mt-1 text-[11px] text-ink/45">
                      {k.hops} hops · pass {formatPct(k.passRate * 100)} · {formatMs(k.avgLatencyMs)} ·{' '}
                      {formatUsd(k.costUsd)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Recent runs — the receipts behind the bars. */}
            <div className="mt-14 overflow-hidden rounded-2xl border border-ink/10">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.03] text-[11px] uppercase tracking-wide text-ink/35">
                    <th className="px-4 py-3 font-medium">prompt</th>
                    <th className="px-4 py-3 font-medium">models</th>
                    <th className="px-4 py-3 font-medium">cost</th>
                    <th className="px-4 py-3 font-medium">saved</th>
                    <th className="px-4 py-3 font-medium">when</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRuns.map((r, i) => (
                    <motion.tr
                      key={r.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: reduceMotion ? 0 : i * 0.04, ease: 'easeOut' }}
                      className="border-b border-ink/5 last:border-b-0 hover:bg-ink/[0.03]"
                      style={{ transition: 'background-color 150ms ease-out' }}
                    >
                      <td className="max-w-[220px] truncate px-4 py-3 text-ink/70">
                        {r.promptSnippet || <span className="text-ink/25">—</span>}
                        {r.status !== 'done' && (
                          <span className="ml-2 rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[10px] uppercase text-ink/40">
                            {r.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink/50">
                        {r.models.length > 0 ? r.models.map((m) => m.split('/').pop()).join(', ') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink/70">{formatUsd(r.costUsd)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-emerald-400/90">
                        {r.savedPct > 0 ? formatPct(r.savedPct) : <span className="text-ink/25">—</span>}
                      </td>
                      <td className="px-4 py-3 text-ink/35">{timeAgo(r.createdAt)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {data?.note && <p className="mt-8 text-[11px] text-ink/25">{data.note}</p>}
      </div>
    </div>
  );
}

function StatTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-ink/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink/35">{label}</p>
      <p className={`mt-1 font-mono text-[15px] tabular-nums ${accent ? 'text-accent-bright' : 'text-ink/85'}`}>
        {value}
      </p>
    </div>
  );
}

/** One bar — staggered 90ms per index (left→right), DESIGN.md §5 Benchmark.
 * scaleY growth (transform-origin bottom) keeps it GPU-only; the dollar
 * label counts up in sync via useCountUp. */
function BenchmarkBarColumn({
  index,
  heightPct,
  costUsd,
  colorClass,
  reduceMotion,
  children,
}: {
  index: number;
  heightPct: number;
  costUsd: number;
  colorClass: string;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  const [target, setTarget] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setTarget(costUsd), reduceMotion ? 0 : index * 90 + 50);
    return () => window.clearTimeout(id);
  }, [costUsd, index, reduceMotion]);
  const count = useCountUp(target, 700);

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-end"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0.15 : 0.4, delay: reduceMotion ? 0 : index * 0.09, ease: 'easeOut' }}
    >
      <span className="mb-2 font-mono text-[13px] tabular-nums text-ink/80">{formatUsd(count)}</span>
      <div className="relative w-full min-h-0 flex-1">
        <div
          className={`absolute inset-x-0 bottom-0 h-full origin-bottom rounded-t-xl transition-transform duration-700 ease-out ${colorClass}`}
          style={{ transform: `scaleY(${heightPct / 100})` }}
        />
      </div>
      {children}
    </motion.div>
  );
}
