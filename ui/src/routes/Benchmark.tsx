import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBenchmark } from '../api';
import { formatPct, formatUsd } from '../lib/format';
import type { BenchmarkResult } from '../types';

type BarKey = keyof BenchmarkResult['baselines'];

const BAR_ORDER: BarKey[] = ['glm_only', 'glm_verify', 'cheap_default', 'understudy'];

const BAR_NOTE: Partial<Record<BarKey, string>> = {
  cheap_default: 'the honest comparison — the bar that matters',
  understudy: 'the thing we built',
};

/** Four bars, cold cache, above the fold — SPEC.md §10, §15 1:05–1:35.
 * Bar 3 (cheap-default) is load-bearing: without it the number can't
 * distinguish discovery from "we stopped using a frontier model." */
export default function Benchmark() {
  const [data, setData] = useState<BenchmarkResult | null>(null);

  useEffect(() => {
    fetchBenchmark().then(setData);
  }, []);

  const maxCost = data ? Math.max(...BAR_ORDER.map((k) => data.baselines[k].costPer1k)) : 1;

  return (
    <div className="min-h-screen w-full px-6 pb-24 pt-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between text-[11px] text-white/30">
          <span>understudy</span>
          <Link to="/" className="transition-colors hover:text-white/70">
            ← bar
          </Link>
        </div>

        <div className="mt-8">
          <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-accent-bright">cold cache</p>
          <h1 className="mt-3 text-[clamp(1.5rem,3.5vw,2.25rem)] font-semibold text-white">
            Cost per 1,000 calls, four ways
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/50">
            Not against a frontier model nobody would use this way — against the obvious cheap default too.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-4 items-end gap-4" style={{ height: 320 }}>
          {data === null &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex h-full flex-col justify-end">
                <div className="w-full animate-pulse rounded-t-xl bg-white/5" style={{ height: '40%' }} />
              </div>
            ))}
          {data &&
            BAR_ORDER.map((key) => {
              const bar = data.baselines[key];
              const isFeatured = key === 'cheap_default' || key === 'understudy';
              const heightPct = Math.max(4, (bar.costPer1k / maxCost) * 100);
              return (
                <div key={key} className="flex h-full flex-col items-center justify-end">
                  <span className="mb-2 font-mono text-[13px] tabular-nums text-white/80">
                    {formatUsd(bar.costPer1k)}
                  </span>
                  <div
                    className={`w-full rounded-t-xl transition-[height] duration-700 ease-out ${
                      key === 'understudy' ? 'bg-accent' : key === 'cheap_default' ? 'bg-accent/40' : 'bg-white/12'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <div className="mt-3 text-center">
                    <p
                      className={`text-[12px] font-medium leading-snug ${
                        isFeatured ? 'text-white/85' : 'text-white/50'
                      }`}
                    >
                      {bar.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/35">{formatPct(bar.accuracy * 100)} accuracy</p>
                    {BAR_NOTE[key] && (
                      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-accent-bright">
                        {BAR_NOTE[key]}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {data && (
          <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.perKind.map((k) => (
              <div key={k.kind} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] uppercase tracking-wide text-white/35">{k.kind}</p>
                <p className="mt-1.5 font-mono text-[13px] text-white/85">{k.promoted.split('/').pop()}</p>
                <p className="mt-1 text-[11px] text-white/45">
                  held-out {formatPct(k.heldOutAccuracy * 100)} · held-in {formatPct(k.heldInAccuracy * 100)} ·
                  n={k.n}
                </p>
              </div>
            ))}
          </div>
        )}

        {data?.note && <p className="mt-8 text-[11px] text-white/25">{data.note}</p>}
      </div>
    </div>
  );
}
