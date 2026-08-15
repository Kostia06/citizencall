# Per-User Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each authenticated user's Composio connections, MCP configs, tool enablement, and UI preferences, exposed via an owner-scoped `/api/*` CRUD API.

**Architecture:** A `worker/src/store/` module on Cloudflare Workers (Hono) + D1, built on the completed auth foundation. Typed tables for relational data (connections/mcps/tools) + one JSON `prefs` blob per user. All routes sit behind `requireAuth` + `requireVerified` and are scoped to the token's `authUserId`.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-08-14-per-user-store-design.md` (read alongside this plan).

## Global Constraints

- All new code under `worker/src/store/`; tests under `worker/tests/store/`.
- Every store row keys on `authUserId` from the validated token. **No endpoint accepts a `user_id` from the request body/query.** `PATCH`/`DELETE` by id scope in SQL (`WHERE id=? AND user_id=?`) → 404 on mismatch.
- All `/api/*` store routes are mounted behind `requireAuth` then `requireVerified` (from `worker/src/auth/middleware.ts`).
- `pnpm typecheck` clean and `pnpm test` green with NO real secrets — the vitest env already injects a test `AUTH_JWT_SECRET`. Tests mint a bearer token via `signAccessToken(env.AUTH_JWT_SECRET, { sub: userId, sid: 'test', emailVerified: true })` and create the matching `users` row with `applyAuthSchema` + `createUser`.
- `worker/tsconfig.json` has `noUncheckedIndexedAccess: true` — guard `.first()`/index access.
- Tool enablement is default-on: a `user_tools` row exists only to record an override (absence = enabled).
- `user_settings` prefs are deep-merged from `DEFAULT_PREFS` on read; `PUT` validates against the known shape (reject unknown top-level keys), shallow-merges top-level keys, replaces arrays wholesale.

---

### Task 1: Store schema

**Files:**
- Create: `worker/schema.store.sql`
- Modify: `worker/src/db.ts` (add `applyStoreSchema`)
- Test: `worker/tests/store/schema.test.ts`

**Interfaces:**
- Produces: `applyStoreSchema(db: D1Database): Promise<void>` — idempotent, creates the four store tables + index.

- [ ] **Step 1: Create `worker/schema.store.sql`**

```sql
CREATE TABLE IF NOT EXISTS user_connections(user_id TEXT NOT NULL, toolkit TEXT NOT NULL, connected_account_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', connected_at INTEGER NOT NULL, PRIMARY KEY(user_id, toolkit));
CREATE TABLE IF NOT EXISTS user_mcps(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_tools(user_id TEXT NOT NULL, toolkit TEXT NOT NULL, tool TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, toolkit, tool));
CREATE TABLE IF NOT EXISTS user_settings(user_id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_mcps_user ON user_mcps(user_id);
```

- [ ] **Step 2: Write the failing test** — `worker/tests/store/schema.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('creates the user_settings table', async () => {
  const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_settings'").first<{ name: string }>();
  expect(r?.name).toBe('user_settings');
});
```

- [ ] **Step 3: Run test to verify it fails** — `pnpm test -- store/schema` → FAIL (`applyStoreSchema` undefined).

- [ ] **Step 4: Implement `applyStoreSchema` in `worker/src/db.ts`** (inline the SQL as a `const STORE_SCHEMA` string, split on `;`, run each — mirror the existing `applyAuthSchema` exactly).

- [ ] **Step 5: Run test to verify it passes** — `pnpm test -- store/schema` → PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/schema.store.sql worker/src/db.ts worker/tests/store/schema.test.ts
git commit -m "feat(store): per-user store D1 schema"
```

---

### Task 2: Settings module (prefs + deep-merge)

**Files:**
- Create: `worker/src/store/prefs.ts` (types + defaults)
- Create: `worker/src/store/settings.ts`
- Test: `worker/tests/store/settings.test.ts`

**Interfaces:**
- Produces (`prefs.ts`): `UserPrefs` type; `DEFAULT_PREFS: UserPrefs`; `mergePrefs(base, patch): UserPrefs`; `validatePrefsPatch(patch: unknown): { ok: true; value: Partial<UserPrefs> } | { ok: false; reason: string }`.
- Produces (`settings.ts`): `getSettings(db, userId): Promise<UserPrefs>`; `putSettings(db, userId, patch, now): Promise<UserPrefs>`.

- [ ] **Step 1: Write `prefs.ts`**

```ts
export interface UserPrefs {
  version: 1;
  keybindings: Record<string, string>;
  buttons: Array<{ id: string; action: string; icon?: string; label?: string }>;
  contextPrompt: string;
}

export const DEFAULT_PREFS: UserPrefs = {
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

const ALLOWED_KEYS = new Set(['version', 'keybindings', 'buttons', 'contextPrompt']);

export function validatePrefsPatch(patch: unknown): { ok: true; value: Partial<UserPrefs> } | { ok: false; reason: string } {
  if (typeof patch !== 'object' || patch === null) return { ok: false, reason: 'Body must be an object.' };
  for (const k of Object.keys(patch)) if (!ALLOWED_KEYS.has(k)) return { ok: false, reason: `Unknown pref key: ${k}` };
  const p = patch as Record<string, unknown>;
  if ('keybindings' in p && (typeof p.keybindings !== 'object' || p.keybindings === null)) return { ok: false, reason: 'keybindings must be an object.' };
  if ('buttons' in p && !Array.isArray(p.buttons)) return { ok: false, reason: 'buttons must be an array.' };
  if ('contextPrompt' in p && typeof p.contextPrompt !== 'string') return { ok: false, reason: 'contextPrompt must be a string.' };
  return { ok: true, value: p as Partial<UserPrefs> };
}

// Top-level keys shallow-merged; keybindings shallow-merged; arrays replaced.
export function mergePrefs(base: UserPrefs, patch: Partial<UserPrefs>): UserPrefs {
  return {
    version: 1,
    keybindings: { ...base.keybindings, ...(patch.keybindings ?? {}) },
    buttons: patch.buttons ?? base.buttons,
    contextPrompt: patch.contextPrompt ?? base.contextPrompt,
  };
}
```

- [ ] **Step 2: Write the failing test** — `worker/tests/store/settings.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { getSettings, putSettings } from '../../src/store/settings';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('returns defaults for a user with no row', async () => {
  const s = await getSettings(env.DB, 'u-none');
  expect(s.keybindings.run).toBe('Enter');
  expect(s.contextPrompt).toBe('');
});

it('deep-merges a patch and persists', async () => {
  await putSettings(env.DB, 'u-set', { contextPrompt: 'be terse', keybindings: { run: 'Mod+Enter' } }, 1);
  const s = await getSettings(env.DB, 'u-set');
  expect(s.contextPrompt).toBe('be terse');
  expect(s.keybindings.run).toBe('Mod+Enter');   // overridden
  expect(s.keybindings.focus).toBe('Mod+K');      // default preserved
});
```

- [ ] **Step 3: Run test to verify it fails** — `pnpm test -- store/settings` → FAIL.

- [ ] **Step 4: Implement `settings.ts`**

```ts
import { DEFAULT_PREFS, mergePrefs, type UserPrefs } from './prefs';

export async function getSettings(db: D1Database, userId: string): Promise<UserPrefs> {
  const row = await db.prepare(`SELECT prefs_json FROM user_settings WHERE user_id=?`).bind(userId).first<{ prefs_json: string }>();
  if (!row) return DEFAULT_PREFS;
  try {
    return mergePrefs(DEFAULT_PREFS, JSON.parse(row.prefs_json) as Partial<UserPrefs>);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function putSettings(db: D1Database, userId: string, patch: Partial<UserPrefs>, now: number): Promise<UserPrefs> {
  const current = await getSettings(db, userId);
  const merged = mergePrefs(current, patch);
  await db
    .prepare(`INSERT INTO user_settings(user_id,prefs_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET prefs_json=excluded.prefs_json, updated_at=excluded.updated_at`)
    .bind(userId, JSON.stringify(merged), now)
    .run();
  return merged;
}
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm test -- store/settings` → PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/store/prefs.ts worker/src/store/settings.ts worker/tests/store/settings.test.ts
git commit -m "feat(store): user settings prefs with deep-merge"
```

---

### Task 3: Connections module

**Files:**
- Create: `worker/src/store/connections.ts`
- Test: `worker/tests/store/connections.test.ts`

**Interfaces:**
- Produces:
  - `upsertConnection(db, { userId, toolkit, connectedAccountId, now }): Promise<void>`
  - `listConnections(db, userId): Promise<Array<{ toolkit: string; status: string; connectedAt: number }>>` (never returns the account id)
  - `revokeConnection(db, userId, toolkit): Promise<boolean>` (true if a row was updated)
  - `getConnectedAccountId(db, userId, toolkit): Promise<string | null>` (internal use by the run/Composio path)

- [ ] **Step 1: Write the failing test** — `worker/tests/store/connections.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { listConnections, revokeConnection, upsertConnection } from '../../src/store/connections';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('upserts and lists a connection without leaking the account id', async () => {
  await upsertConnection(env.DB, { userId: 'u-c', toolkit: 'github', connectedAccountId: 'acct_secret', now: 1 });
  const list = await listConnections(env.DB, 'u-c');
  expect(list).toEqual([{ toolkit: 'github', status: 'active', connectedAt: 1 }]);
  expect(JSON.stringify(list)).not.toContain('acct_secret');
});

it('revoke marks status and is scoped to the user', async () => {
  await upsertConnection(env.DB, { userId: 'u-c2', toolkit: 'gmail', connectedAccountId: 'a', now: 1 });
  expect(await revokeConnection(env.DB, 'u-other', 'gmail')).toBe(false); // not this user's
  expect(await revokeConnection(env.DB, 'u-c2', 'gmail')).toBe(true);
  expect((await listConnections(env.DB, 'u-c2'))[0]!.status).toBe('revoked');
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test -- store/connections` → FAIL.

- [ ] **Step 3: Implement `connections.ts`**

```ts
export async function upsertConnection(db: D1Database, a: { userId: string; toolkit: string; connectedAccountId: string; now: number }): Promise<void> {
  await db
    .prepare(`INSERT INTO user_connections(user_id,toolkit,connected_account_id,status,connected_at) VALUES(?,?,?, 'active',?) ON CONFLICT(user_id,toolkit) DO UPDATE SET connected_account_id=excluded.connected_account_id, status='active', connected_at=excluded.connected_at`)
    .bind(a.userId, a.toolkit, a.connectedAccountId, a.now)
    .run();
}

export async function listConnections(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(`SELECT toolkit,status,connected_at FROM user_connections WHERE user_id=? ORDER BY toolkit`)
    .bind(userId)
    .all<{ toolkit: string; status: string; connected_at: number }>();
  return results.map((r) => ({ toolkit: r.toolkit, status: r.status, connectedAt: r.connected_at }));
}

export async function revokeConnection(db: D1Database, userId: string, toolkit: string): Promise<boolean> {
  const res = await db.prepare(`UPDATE user_connections SET status='revoked' WHERE user_id=? AND toolkit=?`).bind(userId, toolkit).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getConnectedAccountId(db: D1Database, userId: string, toolkit: string): Promise<string | null> {
  const r = await db.prepare(`SELECT connected_account_id FROM user_connections WHERE user_id=? AND toolkit=? AND status='active'`).bind(userId, toolkit).first<{ connected_account_id: string }>();
  return r?.connected_account_id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test -- store/connections` → PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/store/connections.ts worker/tests/store/connections.test.ts
git commit -m "feat(store): user connections module"
```

---

### Task 4: MCPs module (owner-scoped CRUD)

**Files:**
- Create: `worker/src/store/mcps.ts`
- Test: `worker/tests/store/mcps.test.ts`

**Interfaces:**
- Produces:
  - `createMcp(db, { userId, name, config, now }): Promise<{ id: string }>`
  - `listMcps(db, userId): Promise<Array<{ id: string; name: string; enabled: boolean; createdAt: number }>>`
  - `updateMcp(db, userId, id, patch: { name?: string; config?: unknown; enabled?: boolean }): Promise<boolean>` (false if not owned)
  - `deleteMcp(db, userId, id): Promise<boolean>` (false if not owned)

- [ ] **Step 1: Write the failing test** — `worker/tests/store/mcps.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { createMcp, deleteMcp, listMcps, updateMcp } from '../../src/store/mcps';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('create/list/update/delete scoped to owner', async () => {
  const { id } = await createMcp(env.DB, { userId: 'u-m', name: 'local-fs', config: { cmd: 'x' }, now: 1 });
  expect((await listMcps(env.DB, 'u-m'))[0]!.name).toBe('local-fs');
  expect(await updateMcp(env.DB, 'u-other', id, { enabled: false })).toBe(false); // not owner
  expect(await updateMcp(env.DB, 'u-m', id, { enabled: false })).toBe(true);
  expect((await listMcps(env.DB, 'u-m'))[0]!.enabled).toBe(false);
  expect(await deleteMcp(env.DB, 'u-other', id)).toBe(false); // not owner
  expect(await deleteMcp(env.DB, 'u-m', id)).toBe(true);
  expect(await listMcps(env.DB, 'u-m')).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test -- store/mcps` → FAIL.

- [ ] **Step 3: Implement `mcps.ts`**

```ts
export async function createMcp(db: D1Database, a: { userId: string; name: string; config: unknown; now: number }): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO user_mcps(id,user_id,name,config_json,enabled,created_at) VALUES(?,?,?,?,1,?)`)
    .bind(id, a.userId, a.name, JSON.stringify(a.config ?? {}), a.now).run();
  return { id };
}

export async function listMcps(db: D1Database, userId: string) {
  const { results } = await db.prepare(`SELECT id,name,enabled,created_at FROM user_mcps WHERE user_id=? ORDER BY created_at`).bind(userId)
    .all<{ id: string; name: string; enabled: number; created_at: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, enabled: !!r.enabled, createdAt: r.created_at }));
}

export async function updateMcp(db: D1Database, userId: string, id: string, patch: { name?: string; config?: unknown; enabled?: boolean }): Promise<boolean> {
  const sets: string[] = []; const binds: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name=?'); binds.push(patch.name); }
  if (patch.config !== undefined) { sets.push('config_json=?'); binds.push(JSON.stringify(patch.config)); }
  if (patch.enabled !== undefined) { sets.push('enabled=?'); binds.push(patch.enabled ? 1 : 0); }
  if (sets.length === 0) return true;
  binds.push(id, userId);
  const res = await db.prepare(`UPDATE user_mcps SET ${sets.join(',')} WHERE id=? AND user_id=?`).bind(...binds).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteMcp(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM user_mcps WHERE id=? AND user_id=?`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test -- store/mcps` → PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/store/mcps.ts worker/tests/store/mcps.test.ts
git commit -m "feat(store): user MCP configs module"
```

---

### Task 5: Tools overrides + context loader

**Files:**
- Create: `worker/src/store/tools.ts`
- Create: `worker/src/store/context.ts`
- Test: `worker/tests/store/tools.test.ts`

**Interfaces:**
- Produces (`tools.ts`): `listToolOverrides(db, userId): Promise<Array<{ toolkit: string; tool: string; enabled: boolean }>>`; `setToolOverride(db, { userId, toolkit, tool, enabled }): Promise<void>`; `isToolEnabled(db, userId, toolkit, tool): Promise<boolean>` (default true unless an override says false).
- Produces (`context.ts`): `loadUserContext(db, userId): Promise<{ connections: Array<{toolkit:string;status:string}>; disabledTools: Array<{toolkit:string;tool:string}>; contextPrompt: string }>`.

- [ ] **Step 1: Write the failing test** — `worker/tests/store/tools.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { applyStoreSchema } from '../../src/db';
import { isToolEnabled, listToolOverrides, setToolOverride } from '../../src/store/tools';

beforeAll(async () => { await applyStoreSchema(env.DB); });

it('tools default-on; override disables; re-enable upserts', async () => {
  expect(await isToolEnabled(env.DB, 'u-t', 'github', 'list_commits')).toBe(true); // default-on
  await setToolOverride(env.DB, { userId: 'u-t', toolkit: 'github', tool: 'list_commits', enabled: false });
  expect(await isToolEnabled(env.DB, 'u-t', 'github', 'list_commits')).toBe(false);
  await setToolOverride(env.DB, { userId: 'u-t', toolkit: 'github', tool: 'list_commits', enabled: true });
  expect(await isToolEnabled(env.DB, 'u-t', 'github', 'list_commits')).toBe(true);
  expect((await listToolOverrides(env.DB, 'u-t'))).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test -- store/tools` → FAIL.

- [ ] **Step 3: Implement `tools.ts`**

```ts
export async function setToolOverride(db: D1Database, a: { userId: string; toolkit: string; tool: string; enabled: boolean }): Promise<void> {
  await db.prepare(`INSERT INTO user_tools(user_id,toolkit,tool,enabled) VALUES(?,?,?,?) ON CONFLICT(user_id,toolkit,tool) DO UPDATE SET enabled=excluded.enabled`)
    .bind(a.userId, a.toolkit, a.tool, a.enabled ? 1 : 0).run();
}

export async function listToolOverrides(db: D1Database, userId: string) {
  const { results } = await db.prepare(`SELECT toolkit,tool,enabled FROM user_tools WHERE user_id=?`).bind(userId)
    .all<{ toolkit: string; tool: string; enabled: number }>();
  return results.map((r) => ({ toolkit: r.toolkit, tool: r.tool, enabled: !!r.enabled }));
}

export async function isToolEnabled(db: D1Database, userId: string, toolkit: string, tool: string): Promise<boolean> {
  const r = await db.prepare(`SELECT enabled FROM user_tools WHERE user_id=? AND toolkit=? AND tool=?`).bind(userId, toolkit, tool).first<{ enabled: number }>();
  return r ? !!r.enabled : true; // default-on
}
```

- [ ] **Step 4: Implement `context.ts`** (uses connections + tools + settings)

```ts
import { listConnections } from './connections';
import { listToolOverrides } from './tools';
import { getSettings } from './settings';

export async function loadUserContext(db: D1Database, userId: string) {
  const [connections, overrides, settings] = await Promise.all([
    listConnections(db, userId),
    listToolOverrides(db, userId),
    getSettings(db, userId),
  ]);
  return {
    connections: connections.map((c) => ({ toolkit: c.toolkit, status: c.status })),
    disabledTools: overrides.filter((o) => !o.enabled).map((o) => ({ toolkit: o.toolkit, tool: o.tool })),
    contextPrompt: settings.contextPrompt,
  };
}
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm test -- store/tools` → PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/store/tools.ts worker/src/store/context.ts worker/tests/store/tools.test.ts
git commit -m "feat(store): tool overrides and user-context loader"
```

---

### Task 6: Store routes + scoping tests

**Files:**
- Create: `worker/src/store/routes.ts`
- Modify: `worker/src/index.ts` (mount `storeRoutes` at `/api` behind auth)
- Test: `worker/tests/store/routes.test.ts`

**Interfaces:**
- Consumes: modules from Tasks 2–5; `requireAuth`, `requireVerified` from `../auth/middleware`; `signAccessToken` from `../auth/jwt` and `applyAuthSchema`/`createUser`/`setEmailVerified` for the test helper.
- Produces: `storeRoutes` — a Hono sub-app with the spec §5 endpoints, all behind `requireAuth` + `requireVerified`, keyed on `c.get('authUserId')`.

- [ ] **Step 1: Write the failing integration test** — `worker/tests/store/routes.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import app from '../../src/index';
import { applyAuthSchema } from '../../src/db';
import { applyStoreSchema } from '../../src/db';
import { createUser, setEmailVerified } from '../../src/auth/users';
import { signAccessToken } from '../../src/auth/jwt';

async function verifiedToken(userId: string): Promise<string> {
  await createUser(env.DB, { email: `${userId}@example.com`, passwordHash: 'scrypt$x', now: 1 });
  await setEmailVerified(env.DB, userId).catch(() => {});
  // createUser generates its own id; instead mint a token for a known id and insert that id:
  await env.DB.prepare(`INSERT OR IGNORE INTO users(id,email,email_verified,password_hash,status,created_at,updated_at) VALUES(?,?,1,'scrypt$x','active',1,1)`).bind(userId, `${userId}+tok@example.com`).run();
  return signAccessToken(env.AUTH_JWT_SECRET as string, { sub: userId, sid: 'test', emailVerified: true });
}
const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });

beforeAll(async () => { await applyAuthSchema(env.DB); await applyStoreSchema(env.DB); });

it('requires auth', async () => {
  expect((await app.request('/api/settings', {}, env)).status).toBe(401);
});

it('settings round-trip for the token user', async () => {
  const t = await verifiedToken('u-routes-1');
  let res = await app.request('/api/settings', { method: 'PUT', ...auth(t), body: JSON.stringify({ contextPrompt: 'hi' }) }, env);
  expect(res.status).toBe(200);
  res = await app.request('/api/settings', auth(t), env);
  expect((await res.json<any>()).contextPrompt).toBe('hi');
});

it('user A cannot read user B settings (scoping)', async () => {
  const tA = await verifiedToken('u-routes-A');
  const tB = await verifiedToken('u-routes-B');
  await app.request('/api/settings', { method: 'PUT', ...auth(tB), body: JSON.stringify({ contextPrompt: 'B-secret' }) }, env);
  const res = await app.request('/api/settings', auth(tA), env);
  expect((await res.json<any>()).contextPrompt).not.toBe('B-secret'); // A sees its own (default '')
});
```

> Note: the test helper is deliberately explicit about inserting a `users` row with the SAME id the token's `sub` claims, so `requireVerified` + FK-free store rows line up. The implementer may simplify the helper as long as it yields (a verified user row, a bearer token whose `sub` is that id).

- [ ] **Step 2: Run test to verify it fails** — `pnpm test -- store/routes` → FAIL (routes not mounted).

- [ ] **Step 3: Implement `routes.ts`** — a Hono app applying `requireAuth` + `requireVerified` to all routes, then the spec §5 endpoints. Each handler uses `const userId = c.get('authUserId') as string`. Example shape:

```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAuth, requireVerified } from '../auth/middleware';
import { getSettings, putSettings } from './settings';
import { validatePrefsPatch } from './prefs';
import { listConnections, revokeConnection } from './connections';
import { createMcp, deleteMcp, listMcps, updateMcp } from './mcps';
import { listToolOverrides, setToolOverride } from './tools';

type Vars = { authUserId?: string; authSessionId?: string; authEmailVerified?: boolean };
export const storeRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
storeRoutes.use('*', requireAuth, requireVerified);
const uid = (c: any) => c.get('authUserId') as string;
const now = () => Date.now();

storeRoutes.get('/settings', async (c) => c.json(await getSettings(c.env.DB, uid(c))));
storeRoutes.put('/settings', async (c) => {
  const v = validatePrefsPatch(await c.req.json().catch(() => null));
  if (!v.ok) return c.json({ error: v.reason }, 400);
  return c.json(await putSettings(c.env.DB, uid(c), v.value, now()));
});
storeRoutes.get('/connections', async (c) => c.json(await listConnections(c.env.DB, uid(c))));
storeRoutes.delete('/connections/:toolkit', async (c) => {
  await revokeConnection(c.env.DB, uid(c), c.req.param('toolkit'));
  return c.body(null, 204);
});
storeRoutes.get('/mcps', async (c) => c.json(await listMcps(c.env.DB, uid(c))));
storeRoutes.post('/mcps', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.name !== 'string') return c.json({ error: 'name required' }, 400);
  return c.json(await createMcp(c.env.DB, { userId: uid(c), name: b.name, config: b.config, now: now() }), 201);
});
storeRoutes.patch('/mcps/:id', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const ok = await updateMcp(c.env.DB, uid(c), c.req.param('id'), b);
  return ok ? c.body(null, 200) : c.json({ error: 'Not found.' }, 404);
});
storeRoutes.delete('/mcps/:id', async (c) => {
  const ok = await deleteMcp(c.env.DB, uid(c), c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'Not found.' }, 404);
});
storeRoutes.get('/tools', async (c) => c.json(await listToolOverrides(c.env.DB, uid(c))));
storeRoutes.patch('/tools', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.toolkit !== 'string' || typeof b.tool !== 'string' || typeof b.enabled !== 'boolean') return c.json({ error: 'toolkit, tool, enabled required' }, 400);
  await setToolOverride(c.env.DB, { userId: uid(c), toolkit: b.toolkit, tool: b.tool, enabled: b.enabled });
  return c.body(null, 200);
});
```

- [ ] **Step 4: Mount in `index.ts`** — `import { storeRoutes } from './store/routes';` then `app.route('/api', storeRoutes);` (the middleware inside storeRoutes handles auth; `/api/run` etc. remain as they are — do not double-mount conflicting paths). Confirm no path collision with existing `/api/*` routes; if `/api/run` etc. exist on the main app, keep them — `storeRoutes` only claims `/api/settings|connections|mcps|tools`.

- [ ] **Step 5: Run test to verify it passes** — `pnpm test -- store/routes` → PASS.

- [ ] **Step 6: Full suite + typecheck** — `pnpm typecheck && pnpm test` → all green (auth + store), no secrets.

- [ ] **Step 7: Commit**

```bash
git add worker/src/store/routes.ts worker/src/index.ts worker/tests/store/routes.test.ts
git commit -m "feat(store): owner-scoped /api store routes"
```

---

### Task 7: Composio connection persistence

**Files:**
- Modify: `worker/src/index.ts` or `worker/src/store/routes.ts` (wherever `/api/connect` + `/oauth/done` live) — bring under auth + persist
- Test: `worker/tests/store/oauth-persist.test.ts`

**Interfaces:**
- Consumes: `upsertConnection` (Task 3), the existing Composio provider + `state` verification.

- [ ] **Step 1: Read the existing `/api/connect` and `/oauth/done`** in `worker/src/index.ts` / `worker/src/providers/composio.ts`. They currently take a `userId` from the request/demo. Note their exact shape before editing.

- [ ] **Step 2: Write the failing test** — `worker/tests/store/oauth-persist.test.ts` — simulate a completed OAuth callback (a verified user + a valid `state` for `github`) hitting `/oauth/done`, then assert `GET /api/connections` for that user lists `github` as `active`. (Mint the token + user with the same helper as Task 6. If `state` signing requires details you can't reproduce in-test, instead unit-test that the `/oauth/done` handler calls `upsertConnection` by asserting the DB row after invoking the handler with a crafted valid state — follow whatever the existing `state` verification needs.)

- [ ] **Step 3: Bring `/api/connect` under `requireAuth`+`requireVerified`** and read the toolkit from the body but the user from `c.get('authUserId')` (not the body). Keep the HMAC `state` generation.

- [ ] **Step 4: In `/oauth/done`,** after verifying `state` and reading `status` + `connected_account_id`, call `upsertConnection(c.env.DB, { userId, toolkit, connectedAccountId, now: Date.now() })`. Derive `userId`+`toolkit` from the verified `state` payload (the state already round-trips the user + toolkit; if it doesn't yet, add them to the signed state). `/oauth/done` itself is hit by the browser redirect (no bearer), so it MUST authenticate via the signed `state`, not `requireAuth`.

- [ ] **Step 5: Run test to verify it passes** — `pnpm test -- store/oauth-persist` → PASS.

- [ ] **Step 6: Full suite + typecheck** — `pnpm typecheck && pnpm test` → green.

- [ ] **Step 7: Commit**

```bash
git add worker/src/index.ts worker/src/store/routes.ts worker/src/providers/composio.ts worker/tests/store/oauth-persist.test.ts
git commit -m "feat(store): persist Composio connections on oauth callback"
```

---

## Self-Review

- **Spec coverage:** schema (T1) ✓, settings + prefs deep-merge (T2) ✓, connections (T3) ✓, mcps owner-scoped (T4) ✓, tools default-on + context loader (T5) ✓, all §5 routes behind auth + scoping tests (T6) ✓, Composio persistence (T7) ✓, scoping rule enforced (SQL `WHERE user_id=?` everywhere + T6 cross-user test) ✓.
- **Placeholder scan:** all code steps carry real code; T7 Steps 1/2/4 describe reading/adapting existing `/oauth/done` code that isn't reproduced here because it's pre-existing — the implementer reads it first (called out explicitly), which is the correct handling for modifying unknown existing code, not a placeholder.
- **Type consistency:** `UserPrefs`, the module function signatures, and the `authUserId`/`authEmailVerified` context vars are consistent across tasks and match the auth foundation's middleware contract.

## Notes for the executor

- The vitest env already injects a test `AUTH_JWT_SECRET` (from the auth foundation). Tests mint tokens with `signAccessToken(env.AUTH_JWT_SECRET, { sub, sid:'test', emailVerified:true })` and insert a matching `users` row — no real secrets.
- `/oauth/done` authenticates via the signed `state`, NOT `requireAuth` (it's a browser redirect with no bearer). Everything else in the store is bearer-gated.
- Keep every task green with `pnpm typecheck && pnpm test`, no secrets.
