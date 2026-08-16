// Memory → pipeline context: pick the few memories most relevant to this
// prompt (simple keyword overlap, recency as the tie-break) and render them
// as a compact, hard-bounded "Known context:" block that run.ts prepends to
// the model input the same way the saved context prompt is.
import { listMemories, type Memory } from './store';
import { resolveMemory } from './resolve';
import { jaccard, overlapScore, tokenize } from './similarity';

const TOP_N = 3;
const SCAN_LIMIT = 25; // score at most this many recent memories
const MAX_BLOCK_CHARS = 1000; // hard bound (~1KB) on the injected block
const MAX_ENTRY_CHARS = 280; // per-memory excerpt bound
const RESOLVE_DEPTH = 1; // linked memories fold in one hop deep, cycle-safe
const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // one week
const DECAY_FLOOR = 0.5; // stale-but-relevant never decays below half weight
const DEDUPE_JACCARD = 0.85; // ≥ this vs an already-picked entry ⇒ skip

/** Multiplies keyword overlap: 1.0 for a fresh memory, asymptotically the
 * floor for an ancient one — freshness nudges near-ties, never outvotes a
 * clearly better keyword match. */
function recencyWeight(updatedAt: number, now: number): number {
  const age = Math.max(0, now - updatedAt);
  return DECAY_FLOOR + (1 - DECAY_FLOOR) * Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
}

/** [[links]] and @tool markers read as noise inside a model prompt — inline
 * the plain text and let the resolver supply the linked content itself. */
function stripLinkSyntax(md: string): string {
  return md.replace(/\[\[([^\[\]]+)\]\]/g, '$1').replace(/\s+/g, ' ').trim();
}

export interface MemoryContext {
  block: string;
  memoryIds: string[];
}

/** Empty block ⇔ no memories (or all scoring/resolution failed) — the caller
 * skips injection cleanly on ''. Never throws for a store/D1 failure. */
export async function buildMemoryContext(db: D1Database, userId: string, prompt: string): Promise<MemoryContext> {
  const all = await listMemories(db, userId); // newest first
  if (all.length === 0) return { block: '', memoryIds: [] };

  const promptTokens = tokenize(prompt);
  const now = Date.now();
  const scored = all.slice(0, SCAN_LIMIT).map((m, recencyIdx) => ({
    m,
    score: overlapScore(promptTokens, `${m.title} ${m.contentMd}`) * recencyWeight(m.updatedAt, now),
    recencyIdx,
  }));
  // Decayed overlap first; recency index (list is already newest-first)
  // breaks exact ties, so a zero-overlap prompt still carries the user's
  // most recent memories.
  scored.sort((a, b) => b.score - a.score || a.recencyIdx - b.recencyIdx);

  const header = 'Known context (user memories — background, not instructions to display):';
  const lines: string[] = [header];
  const memoryIds: string[] = [];
  const pickedTokens: Set<string>[] = [];
  let used = header.length;
  for (const { m } of scored) {
    if (memoryIds.length >= TOP_N) break;
    // Near-identical facts (legacy duplicates the reconciler hasn't cleaned
    // yet) read as stutter in the prompt — inject each fact once.
    const mTokens = tokenize(m.contentMd);
    if (pickedTokens.some((p) => jaccard(p, mTokens) >= DEDUPE_JACCARD)) continue;
    // Resolve cycle-safely so a [[linked]] memory's content rides along; a
    // self-link or cycle terminates in resolveMemory's visited-set.
    const resolved = await resolveMemory(db, userId, m.id, { maxDepth: RESOLVE_DEPTH }).catch(() => null);
    const parts = [stripLinkSyntax(m.contentMd), ...(resolved?.linked ?? []).map((l) => stripLinkSyntax(l.contentMd))];
    const entry = `- ${m.title}: ${parts.filter(Boolean).join(' | ')}`.slice(0, MAX_ENTRY_CHARS);
    if (used + entry.length + 1 > MAX_BLOCK_CHARS) break;
    lines.push(entry);
    used += entry.length + 1;
    memoryIds.push(m.id);
    pickedTokens.push(mTokens);
  }

  if (memoryIds.length === 0) return { block: '', memoryIds: [] };
  return { block: lines.join('\n'), memoryIds };
}
