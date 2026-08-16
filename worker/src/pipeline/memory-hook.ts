// Agent auto-write (roadmap sub-project #3): after a run completes, decide
// whether it surfaced ONE durable, non-obvious fact/preference worth keeping
// — and if so, write it to user_memories with source 'agent'.
//
// Never on the run's failure path: the single caller (run.ts, right before
// run_end) wraps this in catch → null, and everything model-shaped in here
// is also caught locally. A memory is a bonus, never worth failing a run.
//
// Two tiers:
//  1. Explicit ask — the prompt says "remember …": always stored verbatim
//     (no model call), so the flow works with zero provider key (dev/tests).
//  2. Model extraction — one call to the same cheapest-warm-model helper the
//     /api/suggest nudge uses, prompted to reply NONE unless the run
//     contained something durable. Skipped entirely without a provider key:
//     callFeatherless's stub echo would otherwise become a garbage memory.
import type { Env } from '../env';
import { callFeatherless } from '../providers/featherless';
import { cheapestAvailableModel } from './suggest';
import { createMemory, getMemoryByTitle, updateMemory, type Memory } from '../memory/store';

export interface AutoWriteInput {
  userId: string;
  prompt: string;
  answer: string;
}

const EXTRACT_SYSTEM_PROMPT = [
  'You extract long-term memories for an assistant.',
  'Given a user request and the reply, decide if there is AT MOST ONE durable, non-obvious fact or preference about the user worth remembering across future sessions.',
  'If yes, reply with exactly two lines:',
  'TITLE: <short title, max 8 words>',
  'FACT: <the fact as one markdown sentence>',
  'If there is nothing durable (a one-off task, generic content, no personal fact), reply with exactly: NONE',
].join('\n');

export async function maybeAutoWriteMemory(env: Env, db: D1Database, input: AutoWriteInput): Promise<Memory | null> {
  try {
    const explicit = extractExplicitRemember(input.prompt);
    if (explicit) return await upsertByTitle(db, input.userId, explicit);
    if (!env.FEATHERLESS_API_KEY) return null;
    const extracted = await extractWithModel(env, input);
    if (!extracted) return null;
    return await upsertByTitle(db, input.userId, extracted);
  } catch (err) {
    console.warn(`memory auto-write skipped for ${input.userId}:`, err);
    return null;
  }
}

/** Repeated "remember X" prompts (or a re-extracted fact with the same
 * title) update the existing memory instead of piling up duplicates. */
async function upsertByTitle(
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

/** "remember that I prefer short answers" → fact "I prefer short answers".
 * Exported for tests. */
export function extractExplicitRemember(prompt: string): { title: string; contentMd: string } | null {
  const m = /\bremember\b[:,]?\s*(?:that\s+|to\s+)?(.+)/is.exec(prompt);
  const fact = m?.[1]?.trim().replace(/\s+/g, ' ');
  if (fact) return { title: titleFromFact(fact), contentMd: fact };
  // Identity/preference statements are durable facts even without the word
  // "remember" — "your name is jeff" must stick (found live: it didn't).
  const identity =
    /\b(?:your name is|call me|my name is|i am called)\s+([a-z0-9 _-]{1,40})/i.exec(prompt) ??
    /\b(i (?:prefer|like|want|always|never)\s+.{3,120})/i.exec(prompt);
  if (identity?.[1]) {
    const stated = identity[0].trim().replace(/\s+/g, ' ');
    return { title: titleFromFact(stated), contentMd: stated };
  }
  return null;
}

function titleFromFact(fact: string): string {
  const words = fact.replace(/[.!?]+$/, '').split(' ').slice(0, 8).join(' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80);
}

async function extractWithModel(env: Env, input: AutoWriteInput): Promise<{ title: string; contentMd: string } | null> {
  try {
    const result = await callFeatherless(env, {
      modelId: cheapestAvailableModel(),
      // Generous enough for reasoning-family think-blocks (see suggest.ts's
      // 160-token note) while still a hard spend cap.
      maxTokens: 300,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `Request:\n${input.prompt.slice(0, 2000)}\n\nReply:\n${input.answer.slice(0, 2000)}` },
      ],
    });
    return parseExtraction(result.content);
  } catch {
    return null; // a flaky catalog model is never worth surfacing on a run
  }
}

/** Exported for tests. Tolerates a leading <think> block; anything that
 * doesn't match the TITLE/FACT contract — including NONE — yields null. */
export function parseExtraction(raw: string): { title: string; contentMd: string } | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*/g, '')
    .trim();
  if (!cleaned || /^NONE\b/i.test(cleaned)) return null;
  const title = /^\s*TITLE:\s*(.+)$/im.exec(cleaned)?.[1]?.trim();
  const fact = /^\s*FACT:\s*(.+)$/im.exec(cleaned)?.[1]?.trim();
  if (!title || !fact) return null;
  return { title: title.slice(0, 80), contentMd: fact };
}
