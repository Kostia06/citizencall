# Understudy user-system roadmap

Decomposition (each sub-project gets its own spec → plan → implementation):

1. **Auth + identity foundation** (IN PROGRESS — spec + plan approved, executing on `feature/ui`). Workers + D1, email+password, JWT + rotating refresh, `requireAuth`. Everything below keys off `users.id`.
2. **Per-user store** — Composio connections, enabled tools/MCPs, prefs (keybindings, button config, default per-session context prompt). Schema + CRUD API, keyed on `users.id`.
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
