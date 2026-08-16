// mem0-style reconciliation (adapted from mem0's DEFAULT_UPDATE_MEMORY_PROMPT,
// github.com/mem0ai/mem0, Apache-2.0): for each extracted fact, decide
// ADD / UPDATE / DELETE / NONE against the user's existing memories.
//
// Cost rule: at most ONE model call per reconcile pass, and only when
// keyword-overlap retrieval finds candidates at all — no candidates means
// every fact is trivially new, so we ADD without asking a model. Candidates
// are presented to the model by array index ("0", "1", …), never by UUID,
// so a hallucinated id can only miss, never hit another row (mem0 does the
// same index mapping for the same reason).
import type { Env } from '../env';
import { callFeatherless } from '../providers/featherless';
import { cheapestAvailableModel } from '../pipeline/suggest';
import { createMemory, deleteMemory, getMemoryByTitle, listMemories, updateMemory, type Memory } from './store';
import { cleanTitle, titleForFact } from './extract';
import { jaccard, overlapScore, tokenize } from './similarity';

const CANDIDATE_SCAN = 50; // score at most this many recent memories
const MAX_CANDIDATES = 8; // shown to the decision model
const DUPLICATE_JACCARD = 0.9; // ≥ this ⇒ the fact is already stored verbatim

export interface ReconcileOp {
  event: 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';
  /** Candidate index as a string — resolved back to a real row before use. */
  id?: string;
  text?: string;
  title?: string;
}

export interface ReconcileResult {
  /** Last memory ADDed or UPDATEd — what the run announces, if anything. */
  saved: Memory | null;
  added: number;
  updated: number;
  deleted: number;
}

const RECONCILE_SYSTEM_PROMPT = [
  'You are a memory manager. Compare new facts against existing memories and decide, per fact:',
  '- ADD: genuinely new information.',
  '- UPDATE: an existing memory covers the same subject but the value changed (give its "id" and the new "text"). Never ADD a second memory for the same subject.',
  '- DELETE: the user explicitly retracted an existing memory (give its "id").',
  '- NONE: the fact is already stored.',
  'Each operation may include a "title": a short noun phrase naming the subject (e.g. "Agent\'s name", "Preference: answer length"). Never restate the whole fact as the title.',
  'Reply with ONLY JSON: {"memory": [{"event": "ADD|UPDATE|DELETE|NONE", "id": "<existing id if update/delete>", "text": "<fact>", "title": "<subject>"}]}',
  'Example: existing [{"id": "0", "text": "The agent should be called Jeff"}], new fact "The agent should be called Bob" →',
  '{"memory": [{"event": "UPDATE", "id": "0", "text": "The agent should be called Bob", "title": "Agent\'s name"}]}',
].join('\n');

/** Exported for tests: strict-ish parse of the decision reply. Tolerates
 * think-blocks/fences; malformed input yields [] (caller falls back). */
export function parseReconcileOps(raw: string): ReconcileOp[] {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { memory?: unknown })?.memory;
  if (!Array.isArray(list)) return [];
  const ops: ReconcileOp[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const event = typeof o.event === 'string' ? o.event.toUpperCase() : '';
    if (event !== 'ADD' && event !== 'UPDATE' && event !== 'DELETE' && event !== 'NONE') continue;
    ops.push({
      event: event as ReconcileOp['event'],
      id: typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : undefined,
      text: typeof o.text === 'string' ? o.text.trim().replace(/\s+/g, ' ') : undefined,
      title: typeof o.title === 'string' ? o.title : undefined,
    });
  }
  return ops;
}

/** Candidates = existing memories with any keyword overlap against any fact,
 * best-overlap first. Exported for tests. */
export function pickCandidates(facts: string[], existing: Memory[]): Memory[] {
  const factTokens = facts.map((f) => tokenize(f));
  const scored = existing.slice(0, CANDIDATE_SCAN).map((m) => {
    const text = `${m.title} ${m.contentMd}`;
    let best = 0;
    for (const toks of factTokens) best = Math.max(best, overlapScore(toks, text));
    return { m, best };
  });
  return scored
    .filter((s) => s.best > 0)
    .sort((a, b) => b.best - a.best)
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.m);
}

export async function reconcileFacts(env: Env, db: D1Database, userId: string, facts: string[]): Promise<ReconcileResult> {
  const result: ReconcileResult = { saved: null, added: 0, updated: 0, deleted: 0 };
  if (facts.length === 0) return result;

  const existing = await listMemories(db, userId);
  const candidates = pickCandidates(facts, existing);

  // No overlap anywhere ⇒ every fact is new. Plain ADD, zero model calls.
  if (candidates.length === 0) {
    for (const fact of facts) await applyAdd(db, userId, fact, undefined, result);
    return result;
  }

  const ops = await decideWithModel(env, facts, candidates);
  if (ops.length === 0) {
    // Model unusable (no key, parse failure, flake) — deterministic fallback:
    // exact-duplicate facts are NONE, everything else upserts by clean title
    // so a changed value still replaces rather than piles up.
    for (const fact of facts) {
      if (isDuplicate(fact, existing)) continue;
      const saved = await upsertFactByTitle(db, userId, { title: titleForFact(fact), contentMd: fact });
      result.saved = saved;
      result.added++;
    }
    return result;
  }

  await applyReconcileOps(db, userId, ops, candidates, existing, result);
  return result;
}

/** Applies a decided op list. Exported for tests — the ADD/UPDATE/DELETE/NONE
 * matrix is deterministic given the ops, so it's testable without a model. */
export async function applyReconcileOps(
  db: D1Database,
  userId: string,
  ops: ReconcileOp[],
  candidates: Memory[],
  existing: Memory[],
  result: ReconcileResult
): Promise<ReconcileResult> {
  for (const op of ops) {
    const target = op.id !== undefined ? candidates[Number(op.id)] : undefined;
    if (op.event === 'DELETE' && target) {
      if (await deleteMemory(db, userId, target.id)) result.deleted++;
    } else if (op.event === 'UPDATE' && target && op.text) {
      const title = op.title ? cleanTitle(op.title) : titleForFact(op.text);
      const updated = await updateMemory(db, userId, target.id, { title, contentMd: op.text });
      if (updated) {
        result.updated++;
        result.saved = updated;
      }
    } else if (op.event === 'ADD' && op.text) {
      if (isDuplicate(op.text, existing)) continue; // model re-adding a known fact
      await applyAdd(db, userId, op.text, op.title, result);
    }
    // NONE and malformed ops fall through silently.
  }
  return result;
}

/** Deterministic same-subject replacement: canonical titles ("Agent's name")
 * make a changed value an UPDATE with zero model calls. Shared with the
 * memory-hook fast paths. */
export async function upsertFactByTitle(
  db: D1Database,
  userId: string,
  fact: { title: string; contentMd: string }
): Promise<Memory> {
  const existing = await getMemoryByTitle(db, userId, fact.title);
  if (existing) {
    const updated = await updateMemory(db, userId, existing.id, { contentMd: fact.contentMd });
    if (updated) return updated;
  }
  return createMemory(db, { userId, title: fact.title, contentMd: fact.contentMd, source: 'agent' });
}

function isDuplicate(fact: string, existing: Memory[]): boolean {
  const toks = tokenize(fact);
  return existing.some((m) => jaccard(toks, tokenize(m.contentMd)) >= DUPLICATE_JACCARD);
}

async function applyAdd(db: D1Database, userId: string, fact: string, rawTitle: string | undefined, result: ReconcileResult): Promise<void> {
  const title = rawTitle ? cleanTitle(rawTitle) : titleForFact(fact);
  const created = await createMemory(db, { userId, title, contentMd: fact, source: 'agent' });
  result.added++;
  result.saved = created;
}

async function decideWithModel(env: Env, facts: string[], candidates: Memory[]): Promise<ReconcileOp[]> {
  if (!env.FEATHERLESS_API_KEY) return [];
  const existingBlock = candidates.map((m, i) => ({ id: String(i), title: m.title, text: m.contentMd.slice(0, 300) }));
  try {
    const result = await callFeatherless(env, {
      modelId: cheapestAvailableModel(),
      maxTokens: 600, // JSON ops + possible think-block (see suggest.ts note)
      messages: [
        { role: 'system', content: RECONCILE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Existing memories:\n${JSON.stringify(existingBlock)}\n\nNew facts:\n${JSON.stringify(facts)}`,
        },
      ],
    });
    return parseReconcileOps(result.content);
  } catch {
    return []; // caller's deterministic fallback takes over
  }
}
