# PROGRESS

Shared progression list for the team — humans and AI agents. This is the single
source of truth for **what's done, what's in flight, and what's next**. Read it
before starting work; update it when you finish.

> Design + methodology authority: **[SPEC.md](SPEC.md)** (on `main`). Definition
> of done: SPEC.md §20.

## How to use this file

- **Before you start:** scan _In progress_ and _Next up_. Claim a task by moving
  it to _In progress_ and adding your name/handle in parentheses.
- **While working:** keep the task where it is; add sub-notes if scope changes.
- **When done:** move the task to _Done_ with the date (YYYY-MM-DD). Add any
  follow-ups you discovered to _Next up_ or _Backlog_.
- **One task = one line.** If it needs a paragraph, link out to an issue or a doc.
- **Don't delete history.** _Done_ is the changelog; keep it.

**Status tags:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## In progress

- [ ] _(nothing claimed — pick from Next up)_

## Next up

- [ ] Hand-correct the 72–96 gold labels (run frontier baseline once, then edit) — SPEC §9.5. This is _the_ deliverable; task sets are scaffolded at 24/kind but labels are author-written, not yet frontier-corrected.
- [ ] Buy Cloudflare Workers Paid ($5) + Featherless per-request (~$25) — SPEC §1, Risks 1–2.
- [ ] Run the real sweep against live Featherless (set `FEATHERLESS_API_KEY`), regenerate `artifacts/policy.json` + `results.json` + `sweep-log.jsonl`.
- [ ] Measure `baselineCostUsd` offline per demo request (worker currently uses a live approximation) — SPEC §10.
- [ ] Wire Composio GitHub + Gmail OAuth end-to-end; seed a burner Gmail (5 emails) + a repo with a week of commits — SPEC §16, Risk 10.
- [ ] Create the D1 database, paste its id into `worker/wrangler.jsonc`, run `schema.sql`, deploy.
- [ ] Film the demo in Chrome (voice), roster cold-open first — SPEC §15.

## Backlog

- [ ] `derive_tasks.py` — real trace→instance derivation (currently no-ops with an honest TODO); if not built, drop the "derived from traces" novelty clause (SPEC §17).
- [ ] Semantic L3 plan cache (currently exact-match) — cite as future work (SPEC §8).
- [ ] Optional Electron desktop shell — remember voice is dead inside Electron (SPEC §7.3, §19 cut list).

## Done

- [x] 2026-08-14 — Create public repo, `main` + `progression` branches
- [x] 2026-08-14 — Save **SPEC.md** v4; shared contract (`types.ts`, `schema.sql`), `wrangler.jsonc` (`run_worker_first`), example fixtures
- [x] 2026-08-14 — **Python harness** built: snapshot→retrieve→warmup→paired/blocked halving→grade→Wilson stats→promote; runs offline, 13/13 tests, negative control eliminated round 1
- [x] 2026-08-14 — **Cloudflare Worker** built: Hono + Durable Object + D1, full pipeline, 5 cache tiers with scoping rule, Featherless/Composio providers, SSE replay/heartbeat, OAuth `state`
- [x] 2026-08-14 — **React UI** built: glass command bar + mic/waveform, downward trace with escalation shake, roster cold-open, four-bar benchmark; fully demoable in mock mode with no backend
- [x] 2026-08-14 — Expanded task sets to **24/kind** (12 held_in + 12 held_out) so held-out reports at `n=12` matching the Wilson/δ statistics
- [x] 2026-08-14 — Wired the real `artifacts/policy.json` into the worker (roster now sourced from the harness catalog so it covers every promoted model)
- [x] 2026-08-14 — Made `decompose` a **real routed model call** (zod-validated JSON plan, 1–4 sub-tasks, sequential deps) with heuristic fallback; 41/41 worker tests

## Blocked

- _Nothing blocked._

---

### Notes for AI agents

- Update this file as part of the same change you make — don't leave it stale.
- Keep entries terse and factual. State what changed, not intentions.
- Code and design live on `main`; this file tracks status. Verify a file/flag
  still exists on `main` before recommending it.
