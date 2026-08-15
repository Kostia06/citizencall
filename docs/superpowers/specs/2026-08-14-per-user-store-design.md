# Per-User Store — Design Spec

**Date:** 2026-08-14
**Status:** Approved for implementation planning
**Sub-project:** #2 of the Understudy user-system decomposition (auth ✓ → **per-user store** → memory → web UI → Expo)

## 1. Purpose

Persist each authenticated user's integration connections, enabled tools/MCPs,
and UI preferences, so that "connect once, use everywhere" works across
platforms. Everything keys on the authenticated `users.id` established by the
auth foundation (sub-project #1). Built on Cloudflare Workers (Hono) + D1.

## 2. Goals / Non-goals

**Goals**
- Store per-user: Composio connections, per-user MCP server configs, per-toolkit
  tool enablement, and UI preferences (keybindings, bar-button config, default
  per-session context prompt).
- CRUD API for each, all behind `requireAuth` + `requireVerified`, strictly
  scoped to the token's `authUserId` — the API never accepts a `user_id` from
  the request.
- Persist Composio connections into D1 when the OAuth flow completes, so the app
  knows a user's connected toolkits without calling Composio every time.
- A `loadUserContext(db, userId)` helper that returns a user's connections +
  enabled tools + default context prompt for the agent run to consume.

**Non-goals (this sub-project)**
- The memory system (sub-project #3).
- The UI that edits these settings (sub-project #4) — this spec delivers the API
  the UI will consume, not the screens.
- Deep rewrite of the agent run pipeline to enforce auth on `/api/run` — the
  loader helper is provided; wiring it into the pipeline is a thin follow-up
  noted in §9, not built here.
- Validating MCP server configs by actually connecting to them.

## 3. Data model (D1)

Hybrid: typed tables for relational data, one JSON blob for malleable prefs.

```sql
CREATE TABLE user_connections(
  user_id TEXT NOT NULL,
  toolkit TEXT NOT NULL,                 -- 'github' | 'gmail' | ...
  connected_account_id TEXT NOT NULL,    -- Composio connected_account id
  status TEXT NOT NULL DEFAULT 'active', -- active | revoked | error
  connected_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, toolkit));

CREATE TABLE user_mcps(
  id TEXT PRIMARY KEY,                    -- uuid
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,             -- opaque MCP server config
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL);

CREATE TABLE user_tools(
  user_id TEXT NOT NULL,
  toolkit TEXT NOT NULL,
  tool TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id, toolkit, tool));  -- a row only exists to OVERRIDE the default-on

CREATE TABLE user_settings(
  user_id TEXT PRIMARY KEY,
  prefs_json TEXT NOT NULL,              -- see §4
  updated_at INTEGER NOT NULL);

CREATE INDEX idx_user_mcps_user ON user_mcps(user_id);
```

Tool enablement is default-on: a `user_tools` row exists only to record an
explicit override (disabled, or re-enabled). Absence = enabled.

## 4. Preferences JSON shape

`user_settings.prefs_json` is a single versioned object. Server supplies
defaults; `PUT /api/settings` deep-merges (top-level keys shallow-merged;
arrays replaced wholesale).

```ts
interface UserPrefs {
  version: 1;
  keybindings: Record<string, string>;   // action -> key combo, e.g. { run: 'Enter', bypassCache: 'Mod+Enter' }
  buttons: Array<{ id: string; action: string; icon?: string; label?: string }>; // ordered bar buttons + what each does
  contextPrompt: string;                  // default per-session context prompt prepended to runs
}

const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  keybindings: { run: 'Enter', newline: 'Shift+Enter', bypassCache: 'Mod+Enter', focus: 'Mod+K', clear: 'Escape' },
  buttons: [
    { id: 'github', action: 'connect:github' },
    { id: 'gmail', action: 'connect:gmail' },
    { id: 'policy', action: 'open:roster' },
    { id: 'user', action: 'toggle:user' },
  ],
  contextPrompt: '',
};
```

`GET /api/settings` returns `DEFAULT_PREFS` deep-merged with the stored row (so
a new user gets defaults without a row). Unknown keys in a `PUT` body are
rejected (validated against the known shape) to keep the blob clean.

## 5. API (Hono, all under `requireAuth` + `requireVerified`)

Every handler reads `authUserId = c.get('authUserId')`; **no endpoint accepts a
`user_id` from the body or query.** Standard JSON responses.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/connections` | — | `[{ toolkit, status, connectedAt }]` (never the account id) |
| DELETE | `/api/connections/:toolkit` | — | 204; marks status `revoked` (and best-effort revoke at Composio) |
| GET | `/api/mcps` | — | `[{ id, name, enabled, createdAt }]` |
| POST | `/api/mcps` | `{ name, config }` | 201 `{ id }` |
| PATCH | `/api/mcps/:id` | `{ name?, config?, enabled? }` | 200; 404 if not owned |
| DELETE | `/api/mcps/:id` | — | 204; 404 if not owned |
| GET | `/api/tools` | — | `[{ toolkit, tool, enabled }]` (overrides only) |
| PATCH | `/api/tools` | `{ toolkit, tool, enabled }` | 200 (upserts an override row) |
| GET | `/api/settings` | — | `UserPrefs` (defaults deep-merged) |
| PUT | `/api/settings` | `Partial<UserPrefs>` | 200 `UserPrefs` (validated + deep-merged + persisted) |

Ownership: `PATCH`/`DELETE` on `mcps/:id` verify the row's `user_id` matches
`authUserId` in the SQL predicate (`WHERE id=? AND user_id=?`), returning 404
on mismatch — same IDOR-safe pattern as the auth session revocation.

## 6. Composio connection persistence

The existing `/api/connect` and `/oauth/done` (built in the initial worker) are
brought under `requireAuth` and persist into `user_connections`:
- `POST /api/connect` `{ toolkit }` (userId now comes from the token, not the
  body) → creates the Composio link with the HMAC `state` (already implemented).
- `GET /oauth/done` → after verifying `state` and reading `status` +
  `connected_account_id`, UPSERT `user_connections(user_id, toolkit,
  connected_account_id, status='active', connected_at=now)`.
- `DELETE /api/connections/:toolkit` sets status `revoked`.

## 7. Scoping rule (verbatim, mirrors the auth/cache rule)

> Every per-user row is keyed on `authUserId` taken from the validated access
> token. No store endpoint accepts a `user_id` from the request. `PATCH`/`DELETE`
> by id scope the mutation in SQL (`WHERE id=? AND user_id=?`) and 404 on
> mismatch. One user can never read or write another user's connections, MCPs,
> tools, or settings.

## 8. Module layout (worker/src/store/)

- `schema.store.sql` + `applyStoreSchema(db)` (mirrors the auth schema pattern).
- `settings.ts` — `getSettings`, `putSettings` (deep-merge + validate), `DEFAULT_PREFS`.
- `connections.ts` — `upsertConnection`, `listConnections`, `revokeConnection`.
- `mcps.ts` — `createMcp`, `listMcps`, `updateMcp`, `deleteMcp` (owner-scoped).
- `tools.ts` — `listToolOverrides`, `setToolOverride`.
- `context.ts` — `loadUserContext(db, userId)` → `{ connections, enabledToolkits, contextPrompt }`.
- `routes.ts` — the `/api/*` router, mounted in `index.ts` behind the auth middleware.

## 9. Integration & testing

- **Run integration (follow-up, noted not built):** `/api/run` calls
  `loadUserContext` to prepend the user's `contextPrompt` and gate tools by
  enablement. This spec ships the loader; the pipeline wiring lands with the
  web UI / run-auth work.
- **Testing:** unit tests per module (deep-merge correctness, default fill,
  tool default-on semantics, owner-scoped mutations); integration tests for each
  route incl. the **scoping assertions** (user A cannot read/write user B's
  connections/mcps/tools/settings — the core security property); connection
  persistence on a simulated `/oauth/done`.

## 10. Open items for the plan

- Whether `DELETE /api/connections/:toolkit` should best-effort call Composio to
  revoke the remote account, or just mark local status (start local-only;
  remote revoke is a follow-up).
- `PUT /api/settings` validation strictness (reject unknown keys vs ignore) —
  default: reject unknown top-level keys, keep the blob clean.
