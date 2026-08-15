// Link syntax for memory markdown (roadmap sub-project #3):
//   [[title-or-id]]  — reference to another memory (wiki-style)
//   @toolkit         — reference to a tool/toolkit (e.g. @github, @gmail)
// Parsing is purely lexical; resolution (and its cycle safety) lives in
// resolve.ts.

export interface ParsedLinks {
  /** [[...]] targets, trimmed, order-preserving, de-duplicated (case-insensitive). */
  memoryRefs: string[];
  /** @toolkit tokens, lowercased, de-duplicated. */
  toolRefs: string[];
}

const MEMORY_LINK_RE = /\[\[([^\[\]]+)\]\]/g;
// Word-boundary @token; excludes email-like text (a preceding word char).
const TOOL_LINK_RE = /(^|[^\w])@([a-z][a-z0-9_-]{1,63})/gi;

export function parseLinks(contentMd: string): ParsedLinks {
  const memoryRefs: string[] = [];
  const seenMem = new Set<string>();
  for (const m of contentMd.matchAll(MEMORY_LINK_RE)) {
    const ref = (m[1] ?? '').trim();
    if (!ref) continue;
    const key = ref.toLowerCase();
    if (seenMem.has(key)) continue;
    seenMem.add(key);
    memoryRefs.push(ref);
  }

  const toolRefs: string[] = [];
  const seenTool = new Set<string>();
  for (const m of contentMd.matchAll(TOOL_LINK_RE)) {
    const tool = (m[2] ?? '').toLowerCase();
    if (!tool || seenTool.has(tool)) continue;
    seenTool.add(tool);
    toolRefs.push(tool);
  }

  return { memoryRefs, toolRefs };
}
