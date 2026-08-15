# Understudy user-system roadmap

Decomposition (each sub-project gets its own spec → plan → implementation):

1. **Auth + identity foundation** ✅ DONE (feature/ui). Workers + D1, email+password (scrypt), JWT + rotating refresh w/ reuse-detection, `requireAuth`/`requireVerified`, fail-closed secret. Everything below keys off `users.id`.
2. **Per-user store** ✅ DONE (feature/ui). Composio connections, MCPs, tool overrides, prefs (keybindings/buttons/contextPrompt); owner-scoped `/api/*` CRUD; `/oauth/done` persistence.
   - ~~FOLLOW-UP: store not consumed by run pipeline~~ ✅ DONE 2026-08-15: `runPipeline` prepends contextPrompt server-side, honors tool overrides (`*` wildcard + per-tool precedence, `tool_skipped` events), gates Composio calls on connection status; `/api/run` identity now comes from `resolveActor` (not body userId).

## Full-functionality build-out ✅ (2026-08-15, feature/ui @ ce7d0d3, live-verified)

- **Any-app connect**: all 1,201 Composio toolkits connectable via auto-created managed auth-configs (live: Slack/Notion/Airtable/Linear real OAuth pages, anonymous cookie-session included). Disconnect via customize panel.
- **Custom MCPs**: full CRUD (worker validation + UI manager panel); enabled MCPs surface to the planner; call transport STUBBED behind `McpTransport` (`tool_skipped: mcp transport not implemented`) — remaining work.
- **ElevenLabs STT**: `POST /api/stt` live-verified (real transcript); Mic uses MediaRecorder → transcribing state; MOCK fallback.
- **Run cache + agent loop**: per-user 24h run cache (hit replays trace in ms; `noCache` ⌘⏎ bypass write-through), decompose→route→execute→verify→escalate live (GLM-5.2 rung-1; reasoning-token headroom fix), tool output spliced into prompts w/ §8 taint tracking.
- **Live-bar orbs**: prefs.buttons-driven (incl. `toolkit:<slug>` bindings), hold-drag reorder persists (verified: server order changed).
- **Expo client** (`expo/`): auth (secure-store, native bearer refresh), command/chat screen, connections, settings; tsc+jest+export verified; NO on-device run yet.
- Fixes found live: `/auth/*` missing from `run_worker_first` (405s), refresh-rotation race vs StrictMode (single-flight), SSE reconnect-loop after run_end, suggest 500 (unservable catalog model → fallback chain).

**Remaining known work:** MCP call transport (JSON-RPC client); `/api/stt` rate limit; promoted v1-live models absent from runtime catalog (all kinds fall back to GLM-5.2 — harness owner); Expo on-device verification + worker native-refresh branch check; Composio test auth-configs cleanup (slack/notion/airtable/bogus); memory system #3 (blocked on "Hermes memory system" clarification); bundle-size manualChunks.
3. **Per-user memory system** (NEW — see below).
4. **Web UI** — signup/login, centered auto-growing search bar, customizable buttons + keybinding editor, drag-drop attachments + clipboard read, settings for connections/tools/memory.
5. **Expo search bar** — consumes the same token API (owner handles native).

## Speech-to-text — ElevenLabs (captured 2026-08-14)

- **Change to SPEC §7:** use **ElevenLabs (Scribe) STT** instead of the browser Web Speech API. Web Speech was only chosen because Featherless has no audio models; ElevenLabs gives real, cross-browser STT (and works where Web Speech doesn't — non-Chrome, and the Electron gotcha from SPEC §7.3 goes away).
- **STT only** — not TTS/voices.
- **Key handling:** `ELEVENLABS_API_KEY` lives in `.env` (gitignored); in production it becomes a `wrangler secret`. The browser NEVER sees the key.
- **Design:** a Worker endpoint (e.g. `POST /api/stt`) accepts recorded audio from the command bar's mic, proxies it to the ElevenLabs STT API, and returns the transcript — which then flows into the normalize→decompose pipeline. The mic UI (waveform, recording state) stays; only the transcription source changes from Web Speech to this endpoint. Lands with the Web UI / voice sub-project (#4).

## Sub-project #3 — Per-user memory system (captured 2026-08-14)

Requirements as stated:
- **Local, per-user memory store**, keyed on the authenticated `user_id`.
- **Exposed as an agent tool** — agents read/write memory during a run when the user asks (alongside Composio tools).
- **Markdown-based storage** — everything stored as markdown files/records ("stores everything as markdown").
- **Links** — a memory's markdown can connect to **tools** or to **other memories** (wiki-style references).
- **Cycle safety (hard requirement):** resolving/loading linked memories/tools must NOT recurse infinitely — traversal needs cycle detection + a depth cap so a memory that links back to itself (directly or via a chain) can't loop or blow up context. "Make sure it doesn't [load] recursively."

Open design questions (to resolve when this sub-project is designed):
- **What "Hermes memory system" refers to** — a specific existing library/repo/framework to integrate, or a name for a to-be-built markdown-memory convention? (This changes the whole design — confirm before designing.)
- Storage substrate on Workers: markdown blobs in D1 vs R2 objects; how "files" map to rows/objects.
- Link syntax + resolver: `[[memory-name]]` for memories, some `@tool` form for tools; the resolver walks links with a visited-set + max-depth.
- Tool surface the agent sees: `memory.search`, `memory.read`, `memory.write`, `memory.link` — with per-user scoping enforced (same rule as the cache/connection scoping: never cross users).
