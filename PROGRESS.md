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

- [ ] Add `RESEND_API_KEY` (.env + wrangler secret) — 2FA emails go real with zero code change; until then dev fallback shows the code in the UI.
- [ ] Deploy: buy Workers Paid, create prod D1 (paste id into `worker/wrangler.jsonc`), run `schema.sql`, `wrangler secret put` (AUTH_JWT_SECRET, FEATHERLESS/COMPOSIO/ELEVENLABS/RESEND), `wrangler deploy`.
- [ ] Hand-correct the 72–96 gold labels (run frontier baseline once, then edit) — SPEC §9.5.
- [ ] Custom-MCP **call transport** (JSON-RPC client) — enabled MCPs already surface to the planner; calls currently emit `tool_skipped: mcp transport not implemented` behind the clean `McpTransport` interface.
- [ ] Rate-limit `POST /api/stt` (anon-cookie hook is in place) — every call spends ElevenLabs credit.
- [ ] Expo client on-device run (simulator/device) — code is tsc+jest+export-verified only; also confirm worker native-refresh (in-body token) path against a real device.
- [ ] Connect a HuggingFace account to Featherless — unlocks the HF-gated Llama-3.2-1/3B tier (cheaper rung-0 options).
- [ ] Clean up test Composio auth-configs (slack/notion/airtable + one bogus) created during live verification.
- [ ] Measure `baselineCostUsd` offline per demo request (worker uses a live approximation) — SPEC §10.
- [ ] Seed demo data: burner Gmail (5 emails) + repo with a week of commits — SPEC §16; per-app Composio auth-configs now auto-create, only the demo content is missing.
- [ ] Film the demo in Chrome (voice), roster cold-open first — SPEC §15.
- [ ] Package the desktop overlay (`electron-builder`) — it currently loads the Vite dev server. A packaged build also needs a production load path: `BrowserRouter` doesn't survive `file://`, so either a custom protocol handler or `HashRouter`.
- [ ] Desktop overlay has no tray icon and no Dock icon, so the only way to quit is the launching terminal.
- [ ] Verify the desktop overlay visually + drive its controls — every check so far was through the browser at `/spotlight`; the Electron window itself has never been seen (no Screen Recording permission in the agent's terminal).

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
- [x] 2026-08-15 — **macOS Spotlight overlay** (`desktop/`, SPEC §3 `desktop/main.js`): frameless always-on-top panel showing only the bar, ⌥Space global hotkey (⌘Space is macOS's and unregisterable), sizes to content off the active display's work area, Esc/blur dismiss, no Dock icon. Shell around a new `/spotlight` route — reuses CommandBar/Orbs/ConversationTurn rather than reimplementing. Window draws no backdrop (native vibrancy + shadow both paint the window RECT, which boxed the floating pill); the pill carries its own translucency/shadow in CSS. `UNDERSTUDY_VIBRANCY=1` opts back in. Probes :5173–5177 and attaches only to the dev server titled `Understudy`.
- [x] 2026-08-15 — `CommandBar` gains `variant="spotlight"` (suppresses placeholder copy, suggestion list, ghost next-action, and the suggest fetch); `Orbs` gains optional `onOpenRoute` so route orbs open in the real browser instead of navigating a 720px panel and stranding the user. Default variant unchanged — browser routes verified unregressed.
- [x] 2026-08-15 — **Consolidated all branches into `main`** (`bf3278d`): `feature/ui` fast-forward (36), `progression` via `--allow-unrelated-histories` (orphan history, this file), `desktop-spotlight` merged with 3 conflicts resolved in favour of the chat rewrite — the branch's hardcoded four-orb component was dropped and `Spotlight.tsx` rewritten against `conversationReducer`/`ConversationTurn`/`useAuth`.

- [x] 2026-08-15 — **Full local stack verified post-merge** with real keys in `worker/.dev.vars` (gitignored): worker suite re-run green (**33 files / 166 tests**), `pnpm db:reset` applies all three schemas, live Featherless run routed to `Qwen/Qwen2.5-0.5B-Instruct` and returned **94.8% saved** vs the GLM baseline — independently reproducing the smart-loop-v2 number above.

### Known gaps in the above

- **Voice does not work in the Electron shell** — SPEC §7.3. `webkitSpeechRecognition` throws `network` inside Electron (no Google Speech key shipped). The worker now has a real ElevenLabs `/api/stt` proxy, so routing the overlay's mic through that is the obvious fix; until then film voice in Chrome and the hotkey beat separately.
- **`roster` table is never populated** — `/api/roster` returns `{"roster":[]}` against a live worker with the full schema applied, so `/roster` renders headers and no rows. `harness/promote.py` writes `policy.json` but nothing writes this table.
- **Tool-needing runs stall without connected apps** — a prompt like "summarize this week" plans 3 sub-tasks requiring `gmail.fetch_emails` / `github.list_commits`; with no Composio connection those hops don't complete. Tool-free prompts (classify/summarize-from-text) run clean.
- **The Electron window itself has still never been seen** — no Screen Recording permission in the agent's terminal. Every check was through the browser at `/spotlight`.
- `worker/pnpm-workspace.yaml` was added so pnpm 11 allows the esbuild/workerd build scripts (pnpm 11 stopped reading the `pnpm` field in package.json); the lockfile now resolves `@cloudflare/workers-types` to `5.20260814.1`, which satisfies the `minimumReleaseAge` supply-chain policy that the previously committed lockfile violated.

## Blocked

- _Nothing blocked._

---

### Notes for AI agents

- Update this file as part of the same change you make — don't leave it stale.
- Keep entries terse and factual. State what changed, not intentions.
- Code and design live on `main`; this file tracks status. Verify a file/flag
  still exists on `main` before recommending it.
