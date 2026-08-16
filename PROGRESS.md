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

- [ ] Flip 2FA sender to auth@citizencall.dev once Resend verification completes (records live, propagating) + redeploy.
- [ ] Hand-correct the 72–96 gold labels (run frontier baseline once, then edit) — SPEC §9.5.
- [ ] Custom-MCP **call transport** (JSON-RPC client) — enabled MCPs already surface to the planner; calls currently emit `tool_skipped: mcp transport not implemented` behind the clean `McpTransport` interface.
- [ ] Rate-limit `POST /api/stt` (anon-cookie hook is in place) — every call spends ElevenLabs credit.
- [ ] Expo client on-device run (simulator/device) — code is tsc+jest+export-verified only; also confirm worker native-refresh (in-body token) path against a real device.
- [ ] Connect a HuggingFace account to Featherless — unlocks the HF-gated Llama-3.2-1/3B tier (cheaper rung-0 options).
- [ ] Clean up test Composio auth-configs (slack/notion/airtable + one bogus) created during live verification.
- [ ] Measure `baselineCostUsd` offline per demo request (worker uses a live approximation) — SPEC §10.
- [ ] Seed demo data: burner Gmail (5 emails) + repo with a week of commits — SPEC §16; per-app Composio auth-configs now auto-create, only the demo content is missing.
- [ ] Film the demo in Chrome (voice), roster cold-open first — SPEC §15.
- [ ] Merge `feature/ui` → `main` (everything above lives on `feature/ui`; `main` is at the wave-1 fast-forward).

## Backlog

- [ ] Per-user **memory system** (#3) — markdown memories linking tools/memories, cycle-safe resolver; BLOCKED on clarifying what "Hermes memory system" refers to.
- [ ] `derive_tasks.py` — real trace→instance derivation (currently no-ops with an honest TODO); if not built, drop the "derived from traces" novelty clause (SPEC §17).
- [ ] Semantic L3 plan cache (currently exact-match) — cite as future work (SPEC §8).
- [ ] Vite `manualChunks` — the 1,201-app catalog JSON pushes the main bundle past the 500KB warning.
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
- [x] 2026-08-14 — **Live Featherless sweep** ran (fixed real `/v1/models` schema drift in the harness first); long-tail specialists mostly cold/unservable — real §21 finding; CLAUDE.md purged from git history
- [x] 2026-08-14 — **Kinetic UI redesign** (high-motion dark, one accent, springs, reduced-motion safe) across bar/roster/benchmark
- [x] 2026-08-14 — **Auth foundation** (SDD, 9 tasks + reviews): scrypt, HS256 JWT + rotating refresh w/ reuse-detection, `__Host-refresh`, fail-closed secrets, no-enumeration
- [x] 2026-08-14 — **Per-user store** (SDD, 7 tasks): Composio connections, custom MCPs, tool overrides, prefs (keybindings/buttons/contextPrompt); owner-scoped CRUD; `/oauth/done` persistence
- [x] 2026-08-15 — **Web UI (#4)**: login/signup (no email-confirm), `/settings` editor, chat-style transcript w/ centered bar, expandable hop cards, anonymous `__Host-anon` cookie sessions for connect, shared TopNav
- [x] 2026-08-15 — **Full 1,201-app Composio catalog** in the connect grid (icon tiles, real logos w/ monogram-until-load, search + 82 categories, capped render)
- [x] 2026-08-15 — **Artistic settings**: physical-keycap keybinding recorder (press-to-record, duplicate shake), live command-bar mockup button arranger (drag-reorder, connected-app `toolkit:<slug>` bindings); Suggestions-toggle clip fixed
- [x] 2026-08-15 — Command bar: arrow-key live-fill of suggestions; hold-drag orb reorder on the LIVE bar persisting to `prefs.buttons` (verified server-side)
- [x] 2026-08-15 — **Any-app connect**: auto-created Composio managed auth-configs — all catalog apps connectable (live: Slack/Notion/Airtable/Linear/Discord real OAuth), anonymous included; disconnect via customize panel
- [x] 2026-08-15 — **ElevenLabs STT**: `POST /api/stt` proxy (live transcript verified) + MediaRecorder mic with transcribing state
- [x] 2026-08-15 — **Per-user run cache** (D1, 24h TTL, `noCache` ⌘⏎ bypass write-through, per-user/anon scoping) — identical rerun served ~1s vs 10s cold, live-verified
- [x] 2026-08-15 — **Agent loop finished**: tool output spliced into prompts w/ §8 taint tracking, tool-override gating (`*` wildcard + per-tool precedence, `tool_skipped`), server-side contextPrompt prepend, `resolveActor` identity on `/api/run`, bounded escalation
- [x] 2026-08-15 — **Expo client** (`expo/`): auth (secure-store, native bearer refresh), chat/command screen w/ hop cards, connections (bundled catalog), settings; tsc strict + 19/19 jest + clean iOS export (no device run yet)
- [x] 2026-08-15 — **Smart loop v2-live**: live-probed servable cheap rung-0 per kind (Qwen2.5 0.5B/1.5B @ $0.08/MTok vs GLM-5.2 $2.40); browser-verified classify run **94.8% saved**, forced escalation fires `escalate` → GLM pass; catalog-drift regression test
- [x] 2026-08-15 — **2FA email OTP w/ resend** (Resend provider, dev fallback while no key): login → challenge → 6-digit card (auto-advance/auto-submit), resend w/ 30s countdown, hashed single-use 5-attempt codes; signup routes to code step when no devCode (prod-safe)
- [x] 2026-08-15 — **Connect UX**: click app → "Connect X?" prompt → real OAuth; connected tile → Disconnect prompt + always-visible green ✓; `/oauth/done` 302s back to `/settings` with toast; stub-mode links never open
- [x] 2026-08-15 — **Featherless-live bar by default** (`VITE_MOCK=true` = explicit mock; scripted fallback only when backend unreachable); Vite dev proxy `/api|/auth|/oauth` → :8787; fixed `/auth/*` missing from `run_worker_first` (405s), single-flight refresh (StrictMode rotation race), SSE close on `run_end`
- [x] 2026-08-15 — **Full paginated catalog + global D1 cache**: worker walks all ~13 Composio pages (1,209 apps) and stores ONE shared `toolkit_catalog` row distributed to every user/isolate (fresh process: 25ms, zero Composio calls); stale row beats fallback
- [x] 2026-08-15 — Worker suite **33 files / 166 tests green**; all waves live-verified in-browser and pushed (`feature/ui @ 09f5f9d`)

- [x] 2026-08-15 — **Connection-aware pause**: run pauses on a needed-but-unconnected app with a "Connect X to continue" card (Connect/Skip, 5-min timeout, resume endpoint); planner recognizes ANY catalog toolkit mention + deterministic action-verb tool-call floor; execute validates toolkits against the live catalog (was hardcoded github/gmail)
- [x] 2026-08-15 — **Semantic L3 plan cache** (Jaccard+trigram, toolkit-safety gate, 200-row bounded scan, vocab-keyed to prevent stale-plan hits) + answer bubble in transcript + fast path (trivial prompts ~1s, was 30s)
- [x] 2026-08-15 — **Native iOS bar** (expo): keyboard/safe-area, blur, haptics, suggestions + ghost, mic → /api/stt; 34/34 jest, iOS export clean
- [x] 2026-08-15 — **Identity persistence**: anon→user claiming (connections/settings/tools/mcps/routines/memories/runs) on login/signup/2FA — root cause of "connections reset"; real orb state live; bearer on runs; session-history drawer
- [x] 2026-08-15 — **Memory system (#3)**: auto-written markdown memories (memory_saved event), [[links]] w/ cycle-safe resolver, memories injected into runs (cache-key-proven), /memory page CRUD
- [x] 2026-08-15 — **Dark/light theme** (white→ink token remap, complete coverage), navbar redesign, only-connected orbs, routine buttons + RoutinesPanel
- [x] 2026-08-15 — **Roster/benchmark real** (live D1 stats, per-kind ladder) + 9 more live-probed models (phi-4, Qwen2.5 3B/7B/14B, Mistral-Nemo, gpt-oss corrected)
- [x] 2026-08-15 — **Cron routines**: user_routines CRUD, run-now, 15-min Workers cron sweeping due routines through the real pipeline
- [x] 2026-08-15 — **DEPLOYED: https://citizencall.dev** (Workers custom domain + www; prod D1 + schemas + all secrets incl RESEND; global catalog cache; prod smoke: SPA+6 APIs+e2e run all green). 44 files / 256 worker tests green.
- [x] 2026-08-15 — 2FA prefs-schema fix (suggestions/theme were 400ing the full-prefs Save); runs.user_id index; Resend domain citizencall.dev registered + DNS records live (verification propagating)

- [x] 2026-08-15 — **Answer-first chat UX** (ChatGPT/Perplexity-style): typing indicator, live status line, typewriter answer w/ caret, trace collapsed to a one-line summary (expandable), Copy + Stop, markdown-lite — prod-verified on citizencall.dev
- [x] 2026-08-15 — **Full production audit** (22 pass / 4 partial / 6 fail) + all fails fixed: prod 2FA lockout (configurable Resend sender + fail-open on undelivered email — verified: signup→login→token on prod), pause self-resume (worker polls connections every 5s — no tab needed; live-proven), OAuth returnTo lands back on the run, stuck-run cron reconcile, routine schedule 'none' 400, Settings anon-data race, Esc handlers
- [x] 2026-08-15 — Speed: planner moved to Qwen2.5-14B (49s → 3.5s planning); trivial prompts ~1s; tool-call throws degrade to fail_tool (never error the run)
- [x] 2026-08-15 — UX round: theme orb (☾ replaces demo user-spin), drag-reorder no longer triggers actions, bar placement left/middle/right (instant + anon-safe), multi-line pill squares off, live mic transcript (Web Speech interim + ElevenLabs final), Connected section pinned in grid, answers persisted on run rows (restored sessions show the reply), Roster demoted out of nav (route kept for the demo)
- [x] 2026-08-15 — citizencall.dev custom domain live (+ www); Resend domain registered w/ DNS live (verification propagating; sender flips via RESEND_FROM secret)

- [x] 2026-08-16 — **Real Composio tool execution**: per-toolkit tool discovery (globally cached), planner sees real slugs, intent→tool resolver + schema-grounded args, raw-API execute (SDK version bug found+bypassed); LIVE: DISCORD_LIST_MY_GUILDS returned real guilds, verify pass; human-phrased tool answers
- [x] 2026-08-16 — **Session threading** (vercel/ai-chatbot + LibreChat patterns): bar sends last 6 turns, budgeted conversation block in the system channel, cache-keyed; PROD-verified ("what is my favorite animal?" → "red panda")
- [x] 2026-08-16 — **mem0-style memory**: multi-fact extraction + ADD/UPDATE/DELETE reconcile, canonical titles, retraction, recency-decay retrieval; PROD-verified (jeff→Bob = one clean updated row); found+fixed answer-misattribution bug
- [x] 2026-08-16 — Full sweep (19/5/1) + fixes: zombie-run reaper verified + instant resume-reconcile; cross-browser LIVE mic transcript (chunked STT for Firefox/Zen); button-order persistence (local+account); roster out of nav; teammate's main (desktop/ Electron shell, Spotlight, harness silver-pass) merged cleanly — 49 files / 325 worker tests green

- [x] 2026-08-16 — **Answer streaming + regenerate** (last OSS-plan item): real Featherless SSE deltas for the final sub-task → throttled `answer_delta` events → live-growing bubble (typewriter kept for replays); escalate clears the draft; final `answer` reconciles (cap raised to 12k so streams never shrink); ↻ regenerate reruns with noCache. LIVE: 5 deltas concat===answer locally, incremental bubble growth verified in the PROD browser, regenerate skipped the run cache. 52 files / 340 worker tests green.

- [x] 2026-08-16 — **MCP call transport**: `mcp-client.ts` JSON-RPC Streamable HTTP client (plain-JSON + SSE responses, session reuse, SSRF guard), planned tool resolved against real `tools/list`; LIVE e2e vs mock server ("secret number is 42417", full lifecycle + session reuse in the mock's log). 368 worker tests green.
- [x] 2026-08-16 — **Bar-button overhaul**: root-caused "order never changes" — `/api/settings` was auth-gated while sibling store routes were resolveActor, so anon/unverified saves 401'd silently → settings now anon-friendly (claimed on login) + Save mirrors to localStorage; unconnected app orbs hidden on the live bar; ▶/⚡/✦ orbs actually run/bypass/toggle-suggestions, ◑ opens account; input field is a draggable arranger slot (left/middle/right among orbs). PROD round-trip verified.
- [x] 2026-08-16 — **Spotlight = the product for macOS** (iOS/Expo dropped by decision): overlay is result-only — streamed compact answer + Copy + "View steps on web ↗", session threading across prompts, layered Esc; steps stay recorded server-side for the web history drawer. Browser-verified with screenshots.
- [x] 2026-08-16 — **Live STT time-to-first-word fix**: first interim POST now fires ~1.1s after recording starts (self-scheduling chain, was a 2.5s interval + round trip that always lost to short dictations); verified in Chromium, Playwright Firefox, AND the user's real Zen.app via BiDi with synthesized speech.
- [x] 2026-08-16 — Deployed all of the above to citizencall.dev (version 6582da45); `main` fast-forwarded to `6f3a72c`.

- [x] 2026-08-16 — **Buttons wave 2**: add ("+" tile) / remove per orb; SPECIAL buttons (mini prompt → routine bound to an orb, multi-tool via the normal pipeline); Settings edits AUTO-SAVE instantly (localStorage + debounced PUT + unmount flush) — global Save gone; input is a draggable arranger slot; anon settings persist (resolveActor, root cause of "order never changes").
- [x] 2026-08-16 — **Tool honesty fix**: resolver no longer matches on the toolkit's own name (every discord tool "matched" everything → OAuth JSON answers); meta tools demoted; unmatched intent now SKIPS the tool and answers what the integration can/can't do.
- [x] 2026-08-16 — **Chat-created routines**: "create a routine … every morning" → deterministic intent gate, cheap-model extraction (text recurrence overrides model), routine + Memory mirror rows, duplicate-name guard; live-verified.
- [x] 2026-08-16 — **Settings redesign**: four ?tab= tabs (Bar/Apps/Automation/Personal), everything auto-saves w/ "Saving…→Saved" chip, panels stay mounted; dark+light screenshots.
- [x] 2026-08-16 — **BYO model keys**: user_providers (anthropic/openai/custom, masked …last4, claim-on-login) + Personal-tab panel; user's model = final escalation rung, labeled in trace. 
- [x] 2026-08-16 — **MCP/routines e2e PASS** + 2 real fixes: Add-MCP payload shape (400s), authedFetch now awaits auth bootstrap (reload no longer silently acts as anon — root cause of "resets after reload").
- [x] 2026-08-16 — **Electron overlay shipped**: transparent window, glassy centered pill w/ orbs beside it (saved arrangement, hidden unconnected), focus fixed, one-time sign-in persists 30d, theme memory, connect-chip for paused runs, attach-files button; packaged Understudy.app + GitHub release v0.1.0 + download card in Settings→Personal. Re-tested by controller: typed prompt → "Hi there!" answer, screencapture proof.
- [x] 2026-08-16 — **Design-QA sweep**: 13 findings, 7 fixed (light-mode black ground in index.html — the "no bg at white mode" root cause; unreadable history drawer; invisible benchmark bar; token unification). NOTE: a long-running vite dev server caches tailwind.config — restart :5173 after theme-token changes.
- [x] 2026-08-16 — Deployed to citizencall.dev version aa1e0c3b (404 tests / 57 files green); `main` = `669f094`.

- [x] 2026-08-16 — **Judge-readiness wave**: landing page at /welcome (hero = the pill w/ typewriter, first-visit anon redirect); one-click Understudy.dmg on release v0.1.0, linked from Settings + landing; loop validation found+fixed 3 pipeline defects (escalate event ordering, quoted source text now threaded to executors — was all-null extractions, verifier tolerates ```json fences); benchmarks internally consistent; gmail hint scoped to personal-mail phrasing ("regex to validate an email address" no longer forces a gmail connect card); plan cache WARMED for anon judges (35 prompts, warm answers 1.7-3.1s measured) — after purging 5 pre-fix poisoned gmail plans from prod D1. Deployed 64c9ae1a; main = 948cfcd; 404 tests green.

- [x] 2026-08-16 — **Judge dry-run + first-impression fixes**: walked the full flow as a fresh anon judge (landing → first prompt → reasoning → tool ask → benchmark). Found+fixed the worst first impression: "what can you do" got degenerate looping sludge from rung-0 THAT VERIFY PASSED → (a) deterministic capability fast path (product-true canned answer, 0.7s, $0.00), (b) verify now fails degenerate repetition (dup-line ratio + repeated 5-gram shingle; legit lists/code/JSON pass), (c) idle starter-suggestions no longer render over the first answer. Re-verified live: capability 0.7s, warmed reasoning 5.5s, connect card 0.2s, benchmark consistent.
- [x] 2026-08-16 — **Dark-only by decision**: light theme cut — data-theme pinned to dark pre-paint, TopNav toggle + toggle:theme orb action retired (stale saved orbs hidden), defaults now [github, gmail, user], −123 LOC of theme machinery. Kills the whole light-parity maintenance class.
- [x] 2026-08-16 — Deployed 02117c64; main = e837723; 425 tests / 58 files green.

- [x] 2026-08-16 — **FINAL STATE**: packaged Understudy.app tested against the final prod build (capability answer 0.9s in the floating overlay, dark pinned, sign-in affordance; screenshot shows overlay + v0.1.0 release page + live benchmark: 98 runs · 82.6% saved · 18% cache-hit · 4.3s p50). Handoff updated with the full session record. Prod 02117c64 · main 36a6038 · 425 tests green. Known cosmetic edge: old-default anon profiles ([github,gmail,theme]) show zero orbs until sign-in/arranger touch. Human-gated leftovers only: Resend domain verification, demo filming, gold-label pass.

- [x] 2026-08-16 — **Rename to CitizenCall** (user-visible only; internal ids/bridge/storage keys unchanged): UI copy, persona + capability answer, email sender/subjects, macOS bundle → CitizenCall.app, release v0.1.0 retitled w/ CitizenCall.dmg (site links updated). electron-packager silently no-ops on Node 26 — bundle updated by hand (resources copy + re-sign + re-zip/dmg).
- [x] 2026-08-16 — **Overlay final look** (three user pivots: blur → solid pill → all-solid): transparent window, hasShadow off, fully opaque website-identical components, every floating row on its own card (connect chip readable on light desktops). Desktop-capture blur built+proven then deleted by request. Hands-on verified with a typed run; release assets refreshed. "Whole-window shade" root-caused: stacked old app copy.
- [x] 2026-08-16 — **UX wave**: suggestions dropdown = animated absolute overlay (bar no longer jumps), zero-setup starter prompts, Bar-placement section removed, auth "home" link removed, catalog infinite scroll (all 1,209 apps reachable; was hard-capped at 150), settings tabs re-pull user data on click, branded email templates + welcome-after-signup email.
- [x] 2026-08-16 — Prod at f5fbb451, dark-only, main synced continuously. User's prod account created (their earlier logins were all against local dev D1 — "Invalid email or password" on prod was accurate, not a bug).
- [ ] IN FLIGHT — cache-keeper agent: cron-driven warming (plan cache for common prompts, tool discovery for top toolkits, catalog row, Composio auth configs) + one-time prod seed. Integrate/deploy on landing.

## Blocked

- _Nothing blocked._

---

### Notes for AI agents

- Update this file as part of the same change you make — don't leave it stale.
- Keep entries terse and factual. State what changed, not intentions.
- Code and design live on `main`; this file tracks status. Verify a file/flag
  still exists on `main` before recommending it.
