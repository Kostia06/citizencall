// Agent auto-write (roadmap sub-project #3), mem0-pattern edition: after a
// run completes, extract the durable facts it surfaced (plural — one cheap
// multi-fact call, adapted from mem0's Apache-2.0 prompt design) and
// reconcile each against the user's existing memories as ADD / UPDATE /
// DELETE / NONE, so contradictions replace instead of piling up.
//
// Never on the run's failure path: the single caller (run.ts, right before
// run_end) wraps this in catch → null, and everything model-shaped in here
// is also caught locally. A memory is a bonus, never worth failing a run.
//
// Cost guard: ≤2 model calls per run — (1) fact extraction, (2) reconcile
// decision, and (2) only fires when keyword retrieval finds candidates.
// Cache-hit replays never reach this hook (run.ts returns early).
//
// Three deterministic fast paths run first, model-free, so the core flows
// work with zero provider key (dev/tests):
//  1. Retraction — "forget my name" deletes the matching memory.
//  2. Identity — "your name is jeff" / "call me Ann" upsert under canonical
//     titles ("Agent's name", "User's name"), so Jeff→Bob is an update.
//  3. Explicit ask — "remember …" stores the stated fact verbatim.
import type { Env } from '../env';
import { callFeatherless } from '../providers/featherless';
import { cheapestAvailableModel } from './suggest';
import { deleteMemory, listMemories, type Memory } from '../memory/store';
import { FACTS_SYSTEM_PROMPT, cleanTitle, parseFacts, titleForFact } from '../memory/extract';
import { reconcileFacts, upsertFactByTitle } from '../memory/reconcile';
import { overlapScore, tokenize } from '../memory/similarity';

export interface AutoWriteInput {
  userId: string;
  prompt: string;
  answer: string;
}

export async function maybeAutoWriteMemory(env: Env, db: D1Database, input: AutoWriteInput): Promise<Memory | null> {
  try {
    const retraction = extractRetraction(input.prompt);
    if (retraction) {
      await applyRetraction(db, input.userId, retraction);
      return null; // nothing saved — deletions announce nothing
    }
    const explicit = extractExplicitRemember(input.prompt);
    if (explicit) return await upsertFactByTitle(db, input.userId, explicit);
    if (!env.FEATHERLESS_API_KEY) return null;
    // A pure question carries no durable fact, and extracting from its
    // ANSWER mis-attributes the agent's words to the user (found live:
    // "what's your name?" → "I am known as Bob." became a bogus
    // "User's name is Bob" that then shielded the real memory from a
    // retraction). Skip the model entirely.
    if (isQuestionOnly(input.prompt)) return null;
    const facts = await extractFactsWithModel(env, input);
    if (facts.length === 0) return null;
    const outcome = await reconcileFacts(env, db, input.userId, facts);
    return outcome.saved;
  } catch (err) {
    console.warn(`memory auto-write skipped for ${input.userId}:`, err);
    return null;
  }
}

/** True for prompts that only ask ("what's your name?") — no fact markers,
 * ends in a question mark. Exported for tests. */
export function isQuestionOnly(prompt: string): boolean {
  const p = prompt.trim();
  if (!/\?\s*$/.test(p)) return false;
  return !/\b(?:remember|my name is|call me|i am called|i'm called|your name is|call yourself|i (?:prefer|like|want|always|never))\b/i.test(p);
}

/** "forget my name" → the canonical title (or topic tokens) to delete.
 * Exported for tests. */
export function extractRetraction(prompt: string): { title?: string; topic?: string } | null {
  if (/\b(?:don'?t|do not|never)\s+forget\b/i.test(prompt)) return null; // "don't forget X" is a remember
  const m = /\bforget\b\s+(?:about\s+|that\s+)?(.{2,120})/i.exec(prompt);
  const topic = m?.[1]?.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  if (!topic) return null;
  if (/\b(?:my|the user'?s)\s+name\b/i.test(topic)) return { title: "User's name" };
  if (/\b(?:your|the agent'?s)\s+name\b/i.test(topic)) return { title: "Agent's name" };
  return { topic };
}

// A model-written row about the same subject may carry a different title, so
// canonical retractions also match on content shape ("…agent should be
// called…"), not the title alone (found live: a mis-titled name row survived
// "forget your name").
const RETRACTION_CONTENT_PATTERNS: Record<string, RegExp> = {
  "Agent's name": /\bagent\b[\s\S]{0,40}\bcalled\b|\bagent'?s name\b/i,
  "User's name": /\buser'?s name\b/i,
};

/** Deletes what the user retracted. Canonical titles delete by title or
 * content shape; free-form topics delete only memories containing EVERY
 * meaningful topic token — conservative on purpose, a wrong delete is worse
 * than a stale memory. */
async function applyRetraction(db: D1Database, userId: string, target: { title?: string; topic?: string }): Promise<number> {
  const all = await listMemories(db, userId);
  let deleted = 0;
  if (target.title) {
    const contentPattern = RETRACTION_CONTENT_PATTERNS[target.title];
    for (const m of all) {
      const hit = m.title.toLowerCase() === target.title.toLowerCase() || (contentPattern?.test(m.contentMd) ?? false);
      if (hit && (await deleteMemory(db, userId, m.id))) deleted++;
    }
    return deleted;
  }
  const topicTokens = tokenize(target.topic ?? '');
  if (topicTokens.size === 0) return 0;
  for (const m of all) {
    if (overlapScore(topicTokens, `${m.title} ${m.contentMd}`) === topicTokens.size) {
      if (await deleteMemory(db, userId, m.id)) deleted++;
    }
  }
  return deleted;
}

/** "remember that I prefer short answers" / "your name is jeff" → one
 * normalized fact with a clean canonical title. Exported for tests. */
export function extractExplicitRemember(prompt: string): { title: string; contentMd: string } | null {
  const identity = extractIdentityFact(prompt);
  if (identity) return identity;
  const m = /\bremember\b[:,]?\s*(?:that\s+|to\s+)?(.+)/is.exec(prompt);
  const fact = m?.[1]?.trim().replace(/\s+/g, ' ');
  if (fact) return { title: titleForFact(fact), contentMd: fact };
  const pref = /\b(i (?:prefer|like|want|always|never)\s+.{3,120})/i.exec(prompt);
  if (pref?.[1]) {
    const stated = pref[1].trim().replace(/\s+/g, ' ');
    return { title: titleForFact(stated), contentMd: stated };
  }
  return null;
}

/** Identity statements are durable even without the word "remember" —
 * "your name is jeff" must stick (found live: it didn't). Normalized to the
 * PERSONA's two subjects so reconciliation has a stable shape. */
function extractIdentityFact(prompt: string): { title: string; contentMd: string } | null {
  const agent = /\b(?:your name is|call yourself|you are called|you're called|refer to yourself as)\s+([a-z0-9 _-]{1,40})/i.exec(prompt);
  if (agent?.[1]) {
    return { title: "Agent's name", contentMd: `The agent should be called ${properName(agent[1])}.` };
  }
  const user = /\b(?:my name is|call me|i am called|i'm called)\s+([a-z0-9 _-]{1,40})/i.exec(prompt);
  if (user?.[1]) {
    return { title: "User's name", contentMd: `User's name is ${properName(user[1])}.` };
  }
  return null;
}

function properName(raw: string): string {
  const name = raw.trim().split(/\s+/)[0] ?? '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function extractFactsWithModel(env: Env, input: AutoWriteInput): Promise<string[]> {
  try {
    const result = await callFeatherless(env, {
      modelId: cheapestAvailableModel(),
      // Generous enough for reasoning-family think-blocks (see suggest.ts's
      // 160-token note) plus a small JSON array, still a hard spend cap.
      maxTokens: 500,
      messages: [
        { role: 'system', content: FACTS_SYSTEM_PROMPT },
        { role: 'user', content: `Request:\n${input.prompt.slice(0, 2000)}\n\nReply:\n${input.answer.slice(0, 2000)}` },
      ],
    });
    return parseFacts(result.content);
  } catch {
    return []; // a flaky catalog model is never worth surfacing on a run
  }
}

// Back-compat re-exports: older tests/tools imported the single-fact parser
// from this module; the multi-fact equivalents live in memory/extract.ts.
export { parseFacts, cleanTitle, titleForFact };
