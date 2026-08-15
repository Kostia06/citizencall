# Web UI (auth + customization + connect) — Design Spec

**Date:** 2026-08-14
**Status:** Approved for implementation planning
**Sub-project:** #4 of the Understudy user-system decomposition (auth ✓ → store ✓ → memory → **web UI** → Expo)

## 1. Purpose

Turn the auth + per-user store backends into a usable product: login/signup, a
customization editor (keybindings + bar-button actions + default context
prompt), and app-connecting (Composio OAuth). Built in the existing Vite +
React + TS + Tailwind SPA (`ui/`), consuming the Worker's `/auth/*` and `/api/*`.

**Decisions (locked):**
- **Anonymous + optional login.** The app stays fully usable logged-out — the
  MOCK demo (roster cold-open, a scripted run, benchmark) still runs with no
  backend, so the filmable SPEC demo is preserved. Logging in unlocks
  persistence: saved settings, real connections, per-user runs.
- **Configure fixed buttons + keybindings** (not a full add/remove/reorder
  builder). The four bar buttons' *actions* and the keybindings are editable;
  the button set is fixed — matching the `UserPrefs` schema already built.

## 2. Goals / Non-goals

**Goals**
- SPA auth: signup, login, logout, email-verify + password-reset landings;
  access token in memory + refresh via the `__Host-refresh` cookie; silent
  refresh on 401; session restored on load.
- A `/settings` editor wired to `GET/PUT /api/settings`: edit keybindings, each
  bar button's action, and the default context prompt.
- The command bar reads the active user's prefs (keybindings drive shortcuts;
  button config drives the orbs' actions), falling back to `DEFAULT_PREFS` when
  anonymous.
- Connect/disconnect apps via `POST /api/connect` + `DELETE
  /api/connections/:toolkit`; the orbs reflect real connection state from
  `GET /api/connections`.
- Everything degrades gracefully with no backend (MOCK fallback intact).

**Non-goals**
- The memory system UI (#3).
- The Expo client (owner handles native).
- Deploying the Worker / wiring the real run pipeline to auth — the UI targets
  the API contract; a running backend is a config flip, not required for the
  mock demo.
- Full button builder (add/remove/reorder) — explicitly out per the decision.

## 3. Auth in the SPA

- **`AuthProvider`** (React context, `ui/src/auth/`): holds `{ user, accessToken,
  status }`; on mount calls `POST /auth/refresh` (credentials-included) to
  restore a session from the refresh cookie; exposes `login(email,pw)`,
  `signup(email,pw)`, `logout()`, and `authedFetch()` which attaches the bearer
  token and, on a 401, does ONE silent `/auth/refresh` + retry before giving up.
- **Token handling:** access token in memory only (never localStorage); refresh
  token lives in the httpOnly `__Host-refresh` cookie the Worker sets — the SPA
  never reads it. `authedFetch` uses `credentials: 'include'` so the cookie
  rides along to `/auth/refresh`.
- **Routes (react-router):** `/login`, `/signup`, `/verify?token=` (POSTs
  `/auth/verify`, shows success/failure), `/reset?token=` (password reset form →
  `POST /auth/password/reset`). A "Log in" affordance in the top nav; when
  authed it shows the user's email + a logout/settings menu.
- **Anonymous mode:** no redirect-to-login wall. Unauthenticated users get the
  full mock experience; auth-only actions (Save settings, Connect app) prompt
  login inline when invoked.

## 4. API client

- `ui/src/api.ts` gains a typed client for `/auth/*` and `/api/*` using
  `authedFetch`. A base URL from `import.meta.env.VITE_API_BASE` (default same
  origin; in dev, the Worker at `http://localhost:8787`).
- **MOCK fallback stays the default** (`MOCK` flag): the scripted run, mock
  roster/benchmark, and a local (in-memory) settings/connections stub keep the
  app demoable with no backend. Real mode is a flag/env flip.
- All store calls go through `authedFetch`; a 401 with no session surfaces the
  inline login prompt rather than erroring.

## 5. Customization editor (`/settings`)

- Sections: **Keybindings** (each action → editable key combo, captured via a
  keypress recorder; conflict warnings), **Buttons** (each of the four bar
  buttons → an action picker from a fixed action list, e.g. `connect:github`,
  `open:roster`, `toggle:user`, `run`, plus optional label/icon), **Context
  prompt** (a textarea for the default per-session prompt).
- Load via `GET /api/settings` (or `DEFAULT_PREFS` when anonymous); Save via
  `PUT /api/settings` (deep-merge). Anonymous edits are kept in memory for the
  session and a "Log in to save" prompt appears on Save.
- The command bar and Orbs consume the live prefs from `AuthProvider` — editing
  a keybinding or a button action updates the bar immediately.

## 6. Connecting apps

- In `/settings` (Connections section) and via the GitHub/Gmail orbs: a
  "Connect" action calls `POST /api/connect { toolkit }`, opens the returned
  Composio OAuth URL in a popup (or same-tab redirect), and on return polls/
  refreshes `GET /api/connections`. Connected toolkits light their orb;
  "Disconnect" calls `DELETE /api/connections/:toolkit`.
- Requires login (the endpoints are auth-gated) — invoking Connect while
  anonymous shows the inline login prompt first.

## 7. Design

- Matches `ui/DESIGN.md` (kinetic dark, single accent, springs,
  `prefers-reduced-motion`). Auth screens: centered glass card on the animated
  gradient-mesh background; the same command-bar aesthetic. `/settings` is a
  calm, sectioned panel — not kinetic-heavy (it's a utility surface).
- Keeps the command bar centered (the recent layout change) and the demo shots
  filmable.

## 8. Component/file layout (`ui/src/`)

- `auth/AuthProvider.tsx`, `auth/useAuth.ts`, `auth/authedFetch.ts`
- `routes/Login.tsx`, `routes/Signup.tsx`, `routes/Verify.tsx`, `routes/Reset.tsx`, `routes/Settings.tsx`
- `components/AuthCard.tsx`, `components/settings/{KeybindingEditor,ButtonEditor,ConnectionsPanel}.tsx`
- `api.ts` extended (auth + store client + MOCK stubs)
- Prefs types mirrored from the store's `UserPrefs`.

## 9. Testing

- Component tests (vitest + testing-library or the project's UI test setup, if
  present; otherwise build-time typecheck + a smoke of the mock flows):
  AuthProvider refresh-on-load, silent-refresh-on-401; settings editor
  load/edit/save (against a mocked client); anonymous Save → login prompt;
  connect flow state transitions (mocked).
- **The MOCK demo must still play end-to-end with no backend** — asserted the
  same way the current mock scenario is.
- `pnpm build` clean; all three existing routes plus the new ones render.

## 10. Open items for the plan

- Whether to use a popup or same-tab redirect for the Composio OAuth (start:
  same-tab redirect, simplest; `/oauth/done` returns to the app which refreshes
  connections).
- Keybinding capture UX (recorder vs text input) — start with a keypress
  recorder with a text fallback.
- Whether `/api/run` should send the user's default context prompt now or defer
  to the run-auth follow-up (defer; the editor persists it regardless).
- Dev CORS/proxy for `VITE_API_BASE` pointing at `localhost:8787` (Vite proxy
  or Worker CORS headers) — decide in the plan.
