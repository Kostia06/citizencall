# harness/ — offline Python harness

Never deploys — runs on a laptop, so numpy/scipy/rank-bm25 are free. Produces
the artifacts consumed by the Worker at boot: `../artifacts/{catalog,candidates,
policy,results,funnel}.json` and `../artifacts/sweep-log.jsonl`. Full design:
[`../SPEC.md`](../SPEC.md), especially §9 (harness) and §5.4 (verify vs grade).

## Run order

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python snapshot.py          # catalog + prices -> artifacts/catalog.json
python retrieve.py          # prefilter -> BM25+dense RRF -> artifacts/candidates.json
python warmup.py            # confirm warm, baseline first -> artifacts/warm_status.json
python promote.py --offline # sweep (halving+evaluate+grade) -> stats -> policy/results/funnel + sweep-log.jsonl
```

Each stage reads the previous stage's artifact from `../artifacts/`, so the
order matters (SPEC.md §9.1 — v2 got this backwards and warmed before it knew
what to warm).

## Offline vs live

Every stage defaults to **offline**: `snapshot.py` reads
`fixtures/catalog_sample.json` (~30 hand-curated models mirroring real,
verified-non-monotonic Featherless pricing), and `promote.py`'s sweep uses
`scheduler.FeatherlessClient(offline=True)`, which never makes a network
call — `evaluate.py` substitutes a deterministic, gold-aware stub response
instead (see `evaluate._stub_output`'s docstring for exactly how). This means
the full pipeline runs end-to-end with **no API key**, and running it twice
produces byte-identical artifacts.

`--live` flags (`snapshot.py --live`, `warmup.py --live`) require
`FEATHERLESS_API_KEY` (loaded from a repo-root `.env` if present) and hit the
real Featherless API. `promote.py`'s sweep itself doesn't yet take `--live`
end-to-end wiring for real chat calls beyond what `evaluate.py`/`scheduler.py`
already support — see those modules if you're extending this for a real run
against warmed candidates.

## What each file does

| file | does |
|---|---|
| `snapshot.py` | Catalog + live prices. Prices are **not** monotonic in param count (SPEC.md §5.2) — always read from here, never assume. |
| `retrieve.py` | Metadata prefilter → BM25 (`rank_bm25`) + dense (sentence-transformers if installed, else a numpy hashing-trick fallback) → Reciprocal Rank Fusion (k=60) → top-8/kind. Includes the negative control (one base, non-instruct checkpoint) and the retrieval control (2 random draws from the prefilter pool). |
| `warmup.py` | Warms candidates, baseline (largest) first; confirms `warm` with a real `max_tokens=1` call since `availability.tier` is only ~5min fresh. |
| `scheduler.py` | `UnitSemaphore` — Featherless concurrency-unit reservation (`<16B=1, <34B=2, 70B+=4`), fails immediately (no queue) over budget. `FeatherlessClient` wraps `/v1/chat/completions` with a 120s timeout and the §5.3 status-code table. |
| `evaluate.py` | Runs one candidate over instances via the scheduler; computes runtime `verify()` (schema/non-empty — no gold). |
| `grade.py` | The gold-label grader, **separate from `verify()`** — per-kind metrics from SPEC.md §5.4 (exact match / per-field mean / fact-coverage+compression-guard / token-F1). |
| `halving.py` | 2-round paired, blocked successive halving: 8→4→1, same held-in instances per round across all candidates, eliminate on mean *paired* difference vs the round leader, explicit tie-break `(accuracy desc, cost asc)`. Errored/cold candidates are dropped with a recorded reason, never silently excluded. |
| `stats.py` | Wilson score intervals for proportions (not bootstrap — bootstrap degenerates to `[1,1]` at 12/12); bootstrap only for the paired Δ. The §9.4 promotion rule and `cost_effective = c_primary + p_escalate·c_escalation`. |
| `promote.py` | Orchestrates the sweep, applies the promotion rule, **mechanically asserts** the held-out data-splitting invariant, writes `policy.json`/`results.json`/`funnel.json`, appends every call to `sweep-log.jsonl`. |
| `derive_tasks.py` | Traces → `TaskInstance`s (SPEC.md §17). **Not wired to real traces yet** — see its module docstring TODO; it's a deliberate, documented no-op until `worker/` ships a trace export. |
| `tasks/*.jsonl` | Seed gold-labeled instances (6-8/kind: `held_in` + `held_out`). **These are examples to expand to 24/kind by hand** per SPEC.md §9.5 — not the full benchmark. |

## Tests

```bash
pip install -r requirements.txt
python -m pytest tests/ -v
```

Covers the two failure modes SPEC.md calls out explicitly: the bootstrap
degenerate-interval bug at n=12 (`test_stats.py`) and the verbatim-copy
summarization exploit (`test_grade.py`).
