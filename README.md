# Understudy

> 3,847 API calls. $XX.XX spent. Full log: [`artifacts/sweep-log.jsonl`](artifacts/sweep-log.jsonl). Every number below comes from it.

Your agent finds cheaper specialists by measuring on **your own traffic** — retrieved from 34,504 tool-use-capable open models, N measured empirically.

**Impact Forge Summer 2026** · Track: General Innovation (dual-eligible: Computational Research)

Full design and methodology: **[SPEC.md](SPEC.md)**.

---

## What it does

Understudy decomposes an agent request into typed sub-tasks (`classify`, `extract_fields`, `summarize`, `normalize`), routes each to the cheapest open model that meets a measured quality bar, verifies every hop, and escalates exactly one rung on failure. Winners discovered offline are promoted automatically into a live routing policy.

## Repo layout

| dir | what | owner |
|---|---|---|
| `harness/` | Python offline harness — snapshot → retrieve → warmup → halving → grade → stats → promote | A |
| `worker/` | Hono on Cloudflare Workers + one Durable Object per run; D1 state + cache | B |
| `ui/` | Vite + React + TS + Tailwind command bar, roster, benchmark, trace | B |
| `artifacts/` | `policy.json`, `results.json`, `sweep-log.jsonl`, `funnel.json` |  |

## Quickstart

```bash
# Worker
cd worker && pnpm install
pnpm wrangler d1 create understudy          # paste id into wrangler.jsonc
pnpm wrangler d1 execute understudy --file=schema.sql
pnpm dev

# UI
cd ui && pnpm install && pnpm dev

# Harness (never deploys → numpy/scipy free)
cd harness && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python snapshot.py && python retrieve.py
```

## Status

Scaffolding + shared contract (`worker/src/types.ts`, `worker/schema.sql`) landed. Build in progress — see [SPEC.md §20 Definition of done](SPEC.md).

## Limitations

Voice uses the Web Speech API — **Chrome/Edge only**, and it does not work inside Electron. See SPEC.md §7.3, §14, §21.
