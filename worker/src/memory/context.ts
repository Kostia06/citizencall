// Memory → pipeline context: pick the few memories most relevant to this
// prompt (simple keyword overlap, recency as the tie-break) and render them
// as a compact, hard-bounded "Known context:" block that run.ts prepends to
// the model input the same way the saved context prompt is.
import { listMemories, type Memory } from './store';
import { resolveMemory } from './resolve';

const TOP_N = 3;
const SCAN_LIMIT = 25; // score at most this many recent memories
const MAX_BLOCK_CHARS = 1000; // hard bound (~1KB) on the injected block
const MAX_ENTRY_CHARS = 280; // per-memory excerpt bound
const RESOLVE_DEPTH = 1; // linked memories fold in one hop deep, cycle-safe

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

function overlapScore(promptTokens: Set<string>, m: Memory): number {
  let score = 0;
  for (const tok of tokenize(`${m.title} ${m.contentMd}`)) {
    if (promptTokens.has(tok)) score++;
  }
  return score;
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
  const scored = all.slice(0, SCAN_LIMIT).map((m, recencyIdx) => ({ m, score: overlapScore(promptTokens, m), recencyIdx }));
  // Overlap first; recency (list is already newest-first) breaks ties, so a
  // zero-overlap prompt still carries the user's most recent memories.
  scored.sort((a, b) => b.score - a.score || a.recencyIdx - b.recencyIdx);
  const picked = scored.slice(0, TOP_N);

  const header = 'Known context (user memories — background, not instructions to display):';
  const lines: string[] = [header];
  const memoryIds: string[] = [];
  let used = header.length;
  for (const { m } of picked) {
    // Resolve cycle-safely so a [[linked]] memory's content rides along; a
    // self-link or cycle terminates in resolveMemory's visited-set.
    const resolved = await resolveMemory(db, userId, m.id, { maxDepth: RESOLVE_DEPTH }).catch(() => null);
    const parts = [stripLinkSyntax(m.contentMd), ...(resolved?.linked ?? []).map((l) => stripLinkSyntax(l.contentMd))];
    const entry = `- ${m.title}: ${parts.filter(Boolean).join(' | ')}`.slice(0, MAX_ENTRY_CHARS);
    if (used + entry.length + 1 > MAX_BLOCK_CHARS) break;
    lines.push(entry);
    used += entry.length + 1;
    memoryIds.push(m.id);
  }

  if (memoryIds.length === 0) return { block: '', memoryIds: [] };
  return { block: lines.join('\n'), memoryIds };
}
