// Cache keeper — a warming sweep driven from the existing */15 cron (see
// routines/scheduler.ts). Keeps the caches a FIRST-TIME anonymous judge hits
// warm, so the common asks answer from cache instead of paying a cold
// planner call, a cold Composio tool-discovery walk, or an auth-config
// create round-trip:
//   1. Plan cache (cache/plan.ts, 7d TTL): re-mints curated common prompts
//      whose row is missing or expiring soon — at most MAX_PLAN_MINTS_PER_SWEEP
//      per sweep so a cold cache never stampedes Featherless.
//   2. Toolkit tools (providers/composio-tools.ts, 24h D1 TTL) + the full
//      toolkit catalog (providers/composio-catalog.ts, 24h D1 TTL): refreshed
//      shortly before expiry for a curated top-toolkit list.
//   3. Composio auth configs (providers/composio-auth-configs.ts): resolved
//      once per toolkit so a judge's first "Connect X" click reuses an
//      existing config instead of paying the create round-trip. Toolkits
//      Composio deterministically rejects (no managed auth) are remembered
//      in D1 so they are not retried every sweep.
// Everything here is best-effort: a warming failure must NEVER break the
// cron's real work, and no step runs without the API key it needs.
import type { Env } from './env';
import { policy } from './policy';
import { decompose, planCacheKeyFor, wouldUsePlannerModel } from './pipeline/decompose';
import { detectMentionedToolkits } from './pipeline/toolkit-mentions';
import { applyPlanSemanticSchema, PLAN_CACHE_TTL_MS } from './cache/planSemantic';
import {
  getToolkitToolsFetchedAt,
  refreshToolkitTools,
  TOOLKIT_TOOLS_D1_TTL_MS,
} from './providers/composio-tools';
import {
  getToolkitCatalogFetchedAt,
  refreshToolkitCatalog,
  TOOLKIT_CATALOG_D1_TTL_MS,
} from './providers/composio-catalog';
import { AuthConfigUnavailableError, resolveAuthConfigId } from './providers/composio-auth-configs';

/** Toolkits a judge is most likely to click "Connect" on. */
export const TOP_TOOLKITS = [
  'github',
  'gmail',
  'discord',
  'slack',
  'notion',
  'googlecalendar',
  'googledrive',
  'linear',
  'jira',
  'trello',
  'twitter',
  'reddit',
] as const;

export const MAX_PLAN_MINTS_PER_SWEEP = 5;
/** Rows within this window of their TTL count as "expiring" and get renewed. */
export const EXPIRY_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Soft wall-clock budget for the whole sweep — checked between steps. */
const SWEEP_BUDGET_MS = 30_000;
/** Don't start a plan mint without this much budget left (fast planner ~3-6s). */
const MIN_BUDGET_FOR_MINT_MS = 8_000;
const AUTH_OK_RECHECK_MS = 24 * 60 * 60 * 1000;
const AUTH_UNSUPPORTED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

// Curated common judge asks. ONLY prompts that reach the model planner belong
// here: short no-tool-signal prompts (greetings, "what is X") take decompose's
// ~0ms heuristic, and capability/routine intents bypass the planner entirely —
// warming those buys nothing (enforced by tests/warmup.test.ts). Each entry
// either carries a tool signal (github/gmail hints, a named toolkit) or is
// ≥140 chars. Long entries also seed the semantic near-match pool, so a
// judge's paraphrase borrows a warmed plan instead of paying a planner call.
export const CURATED_PROMPTS: readonly string[] = [
  // github-flavored (TOOL_HINTS)
  'list my open pull requests',
  'check my open prs',
  'any new pull requests this week',
  'summarize my recent commits',
  'show my latest commits',
  'list my repos',
  'what are the open issues in my repo',
  'summarize this week of commits',
  'review my open prs and summarize the changes',
  'any new issues in my repo today',
  // gmail-flavored (TOOL_HINTS)
  'any unread emails',
  'check my inbox',
  'check my gmail',
  'summarize my unread emails',
  'any new emails today',
  'summarize my inbox this morning',
  'check my emails from this week',
  'what are my latest emails about',
  // named-toolkit (catalog mentions join the planner vocab + cache key)
  'any new messages in discord',
  'post an update in discord',
  'send a message to my slack channel',
  'summarize my notion notes',
  'list my linear tickets',
  'what is on my google calendar today',
  'add an event to my google calendar for tomorrow at 3pm',
  'list files in my google drive',
  'whats trending on reddit today',
  'check my jira board for open tickets',
  'add a card to my trello board',
  // comparisons
  'Compare Python and JavaScript for backend web development, covering performance, ecosystem maturity, hiring pool, and long-term maintainability, and recommend one.',
  'Compare React and Vue for building a medium sized dashboard application, considering learning curve, ecosystem, performance, and team productivity, then recommend one.',
  'Compare PostgreSQL and MongoDB for a new SaaS product, covering data modeling, scaling, transactions, operational cost, and developer experience, and tell me which to pick.',
  'Compare renting versus buying a home in a major city right now, covering monthly costs, opportunity cost of the down payment, flexibility, and long term wealth building.',
  'Compare the pros and cons of remote work versus working from an office for a small engineering team, and suggest a practical hybrid policy that balances both.',
  'Compare electric cars and gasoline cars for a typical commuter, covering total cost of ownership, charging versus refueling convenience, and environmental impact.',
  // explainers
  'Explain how large language models work to a curious non technical person, covering training, tokens, and why they sometimes make things up, in a few short paragraphs.',
  'Explain the difference between machine learning, deep learning, and artificial intelligence in plain language with one concrete everyday example for each term.',
  'Explain how HTTPS and TLS keep a web connection secure, including what certificates do and what a man in the middle attack is, in simple terms for a beginner.',
  'Explain how blockchain technology actually works under the hood, what problems it genuinely solves, and where it is overhyped, in plain language for a beginner.',
  'Explain the theory of relativity in simple terms that a high school student could understand, covering both special and general relativity with everyday examples.',
  'Explain how vaccines work with the immune system, what mRNA vaccines changed about the process, and why boosters are sometimes needed, for a general audience.',
  'Explain what quantum computing is, how a qubit differs from a normal bit, and which real world problems quantum computers might actually solve first.',
  'Explain how interest rates set by central banks ripple through the economy and affect mortgages, savings accounts, stock prices, and everyday consumer prices.',
  'Explain the difference between stocks, bonds, ETFs, and index funds for a complete beginner, and describe a sensible simple starter portfolio for long term investing.',
  // coding
  'Write a Python function that takes a list of dictionaries and groups them by a given key, returning a dictionary of lists, with type hints and a short docstring.',
  'Write a JavaScript function that debounces another function with a configurable delay, explain briefly how it works, and show a small usage example with a search input.',
  'Write a SQL query that finds the top five customers by total order value in the last ninety days, assuming standard customers, orders, and order items tables.',
  'Write a regular expression that validates an email address, explain each part of the pattern briefly, and list a few edge cases it intentionally does not cover.',
  'Write a Python script that reads a CSV file, filters rows where a numeric column exceeds a threshold, and writes the result to a new CSV, using only the standard library.',
  'Write a bash script that finds all files larger than one hundred megabytes under a directory, prints them sorted by size, and optionally deletes them with a confirmation prompt.',
  'Explain the difference between async await and promises in JavaScript with short code examples, and describe when using one over the other actually matters.',
  // math
  'If I invest five hundred dollars every month into an index fund returning seven percent annually on average, how much will I have after twenty years? Show the math step by step.',
  'A store discounts a jacket by thirty percent and then takes another twenty percent off the reduced price at checkout. What is the total percentage discount? Show the calculation.',
  'I am splitting a restaurant bill of two hundred forty seven dollars among six people, with an eighteen percent tip on top. How much does each person owe? Show the steps.',
  'Calculate the monthly payment on a four hundred thousand dollar mortgage at six and a half percent interest over thirty years, and show how much total interest is paid.',
  // planning
  'Plan a one week trip to Japan for two people on a moderate budget, covering Tokyo and Kyoto, with a day by day itinerary, food recommendations, and rough costs.',
  'Create a twelve week training plan for a complete beginner preparing for their first half marathon, including weekly mileage, rest days, and injury prevention tips.',
  'Plan a healthy weekly meal prep for a busy professional who wants high protein dinners, a grocery list organized by aisle, and meals that take under thirty minutes.',
  'Help me plan a product launch for a small mobile app: a realistic six week timeline, the marketing channels worth using with no budget, and the metrics to watch.',
  'Outline a study plan for learning web development from scratch in six months, part time, covering HTML, CSS, JavaScript, React, and building a portfolio of projects.',
  'Plan a memorable surprise birthday party for about twenty guests on a five hundred dollar budget, including venue ideas, food, decorations, and a rough timeline.',
  // writing
  'Write a professional email to my team announcing a new project management process, explaining why we are changing, what changes for them, and when it starts.',
  'Write a polite but firm email to a client whose invoice is sixty days overdue, preserving the relationship while making clear that payment is now required.',
  'Write a LinkedIn post announcing that I am starting a new job as a software engineer, keeping it humble, warm, and under one hundred fifty words maximum please.',
  'Write a short cover letter for a senior software engineer position at a startup, emphasizing five years of full stack experience and a love of shipping products fast.',
  'Draft a resignation letter that is professional and grateful, gives two weeks notice, offers to help with the transition, and keeps the door open for the future.',
  'Write a product description for a handmade ceramic coffee mug for an online store, warm and evocative but concise, with a short list of selling points at the end.',
  // summaries
  'Summarize the key ideas of the book Atomic Habits by James Clear, including the four laws of behavior change and the most actionable takeaways, in a few paragraphs.',
  'Summarize the current state of artificial intelligence regulation in the European Union and the United States, and what it means for a small software company.',
  'Summarize how the transformer architecture changed natural language processing, what attention actually does, and why it scaled better than recurrent networks.',
];

export interface WarmupSummary {
  plansMinted: number;
  plansDue: number;
  toolsRefreshed: number;
  catalogRefreshed: boolean;
  authWarmed: number;
  authUnsupported: number;
  skipped: string[];
}

/** Pure selection: keys with no live row, or a row expiring within
 * EXPIRY_WINDOW_MS — most-stale first (missing sorts first) so the per-sweep
 * cap starves nothing permanently. */
export function selectPlanWarmups(
  keys: readonly string[],
  liveRows: ReadonlyMap<string, number>,
  now: number,
  cap: number = MAX_PLAN_MINTS_PER_SWEEP
): string[] {
  const due: Array<{ key: string; createdAt: number }> = [];
  for (const key of keys) {
    const createdAt = liveRows.get(key);
    if (createdAt === undefined || createdAt + PLAN_CACHE_TTL_MS - EXPIRY_WINDOW_MS <= now) {
      due.push({ key, createdAt: createdAt ?? 0 });
    }
  }
  return due
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, cap))
    .map((d) => d.key);
}

export interface AuthWarmState {
  status: 'ok' | 'unsupported';
  updatedAt: number;
}

/** Pure selection: warm toolkits with no recorded state, an 'ok' older than a
 * day (config could have been deleted), or an 'unsupported' older than a week
 * (Composio may have gained managed-auth support). */
export function selectAuthWarmups(
  toolkits: readonly string[],
  states: ReadonlyMap<string, AuthWarmState>,
  now: number
): string[] {
  return toolkits.filter((toolkit) => {
    const state = states.get(toolkit);
    if (!state) return true;
    const recheck = state.status === 'unsupported' ? AUTH_UNSUPPORTED_RECHECK_MS : AUTH_OK_RECHECK_MS;
    return state.updatedAt + recheck <= now;
  });
}

// --- auth-config warm state (D1, lazy-provisioned like the other caches) ---

let authStateSchemaReady = false;
async function ensureAuthStateSchema(db: D1Database): Promise<void> {
  if (authStateSchemaReady) return;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS warmup_auth_state(toolkit TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, updated_at INTEGER NOT NULL)'
    )
    .run();
  authStateSchemaReady = true;
}

export async function readAuthWarmStates(db: D1Database): Promise<Map<string, AuthWarmState>> {
  await ensureAuthStateSchema(db);
  const { results } = await db
    .prepare('SELECT toolkit, status, updated_at FROM warmup_auth_state')
    .all<{ toolkit: string; status: string; updated_at: number }>();
  const map = new Map<string, AuthWarmState>();
  for (const row of results ?? []) {
    if (row.status === 'ok' || row.status === 'unsupported') {
      map.set(row.toolkit, { status: row.status, updatedAt: row.updated_at });
    }
  }
  return map;
}

async function writeAuthWarmState(
  db: D1Database,
  toolkit: string,
  status: AuthWarmState['status'],
  detail: string,
  now: number
): Promise<void> {
  await ensureAuthStateSchema(db);
  await db
    .prepare(
      `INSERT INTO warmup_auth_state (toolkit, status, detail, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(toolkit) DO UPDATE SET status = ?2, detail = ?3, updated_at = ?4`
    )
    .bind(toolkit, status, detail.slice(0, 300), now)
    .run();
}

/** Test-only: module state shared across vitest files in a worker isolate. */
export function resetWarmupStateForTests(): void {
  authStateSchemaReady = false;
}

// A 4xx from Composio is deterministic ("toolkit does not support composio
// managed auth" arrives as a 400) — remember it so it isn't retried every
// sweep. 5xx/network failures are transient and stay retryable.
function isDeterministicAuthRejection(err: AuthConfigUnavailableError): boolean {
  return /-> 4\d\d\b/.test(err.message);
}

/** Resolve auth configs for `toolkits`, recording ok/unsupported outcomes in
 * D1. `resolve` is injectable for tests; production passes resolveAuthConfigId
 * bound to the API key. */
export async function warmAuthConfigs(
  db: D1Database,
  toolkits: readonly string[],
  resolve: (toolkit: string) => Promise<string>,
  now: number,
  deadline: number
): Promise<{ warmed: number; unsupported: number }> {
  const states = await readAuthWarmStates(db);
  const due = selectAuthWarmups(toolkits, states, now);
  let warmed = 0;
  let unsupported = 0;
  for (const toolkit of due) {
    if (Date.now() > deadline) break;
    try {
      await resolve(toolkit);
      await writeAuthWarmState(db, toolkit, 'ok', '', now);
      warmed += 1;
    } catch (err) {
      if (err instanceof AuthConfigUnavailableError && isDeterministicAuthRejection(err)) {
        await writeAuthWarmState(db, toolkit, 'unsupported', err.message, now);
        unsupported += 1;
        console.log(`warmup: auth config unsupported toolkit=${toolkit} (cached, retry in 7d)`);
      } else {
        // Transient (outage, 5xx): no row — retried next sweep.
        console.warn(`warmup: auth config warm failed toolkit=${toolkit}:`, err);
      }
    }
  }
  return { warmed, unsupported };
}

async function readPlanRowAges(db: D1Database, keys: readonly string[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const placeholders = keys.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT normalized, created_at FROM plan_cache WHERE normalized IN (${placeholders})`)
    .bind(...keys)
    .all<{ normalized: string; created_at: number }>();
  return new Map((results ?? []).map((r) => [r.normalized, r.created_at]));
}

async function warmPlans(env: Env, summary: WarmupSummary, deadline: number): Promise<void> {
  await applyPlanSemanticSchema(env.DB);
  // Compute each prompt's cache key exactly the way an anonymous run does
  // (pipeline/run.ts): no connections, no MCP toolkits — only catalog
  // mentions join the vocabulary. A key minted under any other vocab would
  // never be the one a judge's run looks up.
  const entries: Array<{ prompt: string; mentions: string[]; key: string }> = [];
  for (const prompt of CURATED_PROMPTS) {
    const mentions = await detectMentionedToolkits(env, prompt).catch(() => [] as string[]);
    if (!wouldUsePlannerModel(prompt, mentions)) continue; // trivial → already instant
    entries.push({ prompt, mentions, key: planCacheKeyFor(prompt, mentions) });
  }

  const ages = await readPlanRowAges(env.DB, entries.map((e) => e.key));
  const due = selectPlanWarmups(entries.map((e) => e.key), ages, Date.now());
  summary.plansDue = due.length;

  for (const key of due) {
    if (Date.now() + MIN_BUDGET_FOR_MINT_MS > deadline) break;
    const entry = entries.find((e) => e.key === key);
    if (!entry) continue;
    // Exact lookups don't TTL-check (only the write-time prune expires rows),
    // so an expiring row would exact-hit and skip the re-mint — drop it
    // first. If the mint degrades to the heuristic, that plan is still a
    // correct (just flat) plan, and the next sweep gets another shot.
    await env.DB.prepare('DELETE FROM plan_cache WHERE normalized = ?1').bind(key).run();
    const result = await decompose(env, env.DB, policy, entry.prompt, entry.mentions, entry.mentions, '');
    summary.plansMinted += 1;
    const tools = result.plan.subTasks
      .filter((s) => s.toolCall)
      .map((s) => `${s.toolCall?.toolkit}:${s.toolCall?.tool}`)
      .join(',');
    // Log every mint — a bad hint once poisoned this cache ("email"→gmail),
    // so what got minted must be auditable from the cron logs.
    console.log(
      `warmup: minted plan key="${key}" subTasks=${result.plan.subTasks.length} tools=[${tools}] via=${result.cacheHit ? 'semantic-promote' : 'planner'}`
    );
  }
}

async function warmCatalog(env: Env, summary: WarmupSummary): Promise<void> {
  const fetchedAt = await getToolkitCatalogFetchedAt(env.DB).catch(() => null);
  if (fetchedAt !== null && fetchedAt + TOOLKIT_CATALOG_D1_TTL_MS - EXPIRY_WINDOW_MS > Date.now()) return;
  summary.catalogRefreshed = await refreshToolkitCatalog(env);
  if (summary.catalogRefreshed) console.log('warmup: refreshed toolkit_catalog row');
}

async function warmToolkitTools(env: Env, summary: WarmupSummary, deadline: number): Promise<void> {
  for (const toolkit of TOP_TOOLKITS) {
    if (Date.now() > deadline) break;
    const fetchedAt = await getToolkitToolsFetchedAt(env.DB, toolkit).catch(() => null);
    if (fetchedAt !== null && fetchedAt + TOOLKIT_TOOLS_D1_TTL_MS - EXPIRY_WINDOW_MS > Date.now()) continue;
    if (await refreshToolkitTools(env, toolkit)) {
      summary.toolsRefreshed += 1;
      console.log(`warmup: refreshed toolkit_tools row toolkit=${toolkit}`);
    }
  }
}

/** One warming sweep. Never throws; every step is independently best-effort
 * and gated on the API key it needs. Called LAST from the cron handler so the
 * scheduler's real work (routines + stuck-run reaper) always runs first. */
export async function runWarmupSweep(env: Env, now = Date.now()): Promise<WarmupSummary> {
  const deadline = now + SWEEP_BUDGET_MS;
  const summary: WarmupSummary = {
    plansMinted: 0,
    plansDue: 0,
    toolsRefreshed: 0,
    catalogRefreshed: false,
    authWarmed: 0,
    authUnsupported: 0,
    skipped: [],
  };

  if (env.FEATHERLESS_API_KEY) {
    try {
      await warmPlans(env, summary, deadline);
    } catch (err) {
      console.warn('warmup: plan warm failed:', err);
    }
  } else {
    summary.skipped.push('plans (no FEATHERLESS_API_KEY)');
  }

  if (env.COMPOSIO_API_KEY) {
    const apiKey = env.COMPOSIO_API_KEY;
    try {
      await warmCatalog(env, summary);
    } catch (err) {
      console.warn('warmup: catalog warm failed:', err);
    }
    try {
      await warmToolkitTools(env, summary, deadline);
    } catch (err) {
      console.warn('warmup: tool-discovery warm failed:', err);
    }
    try {
      const res = await warmAuthConfigs(env.DB, TOP_TOOLKITS, (t) => resolveAuthConfigId(apiKey, t), now, deadline);
      summary.authWarmed = res.warmed;
      summary.authUnsupported = res.unsupported;
    } catch (err) {
      console.warn('warmup: auth-config warm failed:', err);
    }
  } else {
    summary.skipped.push('composio (no COMPOSIO_API_KEY)');
  }

  console.log(
    `warmup: sweep done plansMinted=${summary.plansMinted}/${summary.plansDue} toolsRefreshed=${summary.toolsRefreshed} ` +
      `catalogRefreshed=${summary.catalogRefreshed} authWarmed=${summary.authWarmed} authUnsupported=${summary.authUnsupported}` +
      (summary.skipped.length > 0 ? ` skipped=[${summary.skipped.join('; ')}]` : '')
  );
  return summary;
}
