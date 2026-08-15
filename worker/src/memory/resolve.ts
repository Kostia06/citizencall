// Cycle-safe [[link]] resolution — the roadmap's explicit HARD requirement:
// "resolving/loading linked memories must NOT recurse infinitely". Traversal
// is breadth-first with (a) a visited-set keyed on memory id, so A→A and
// A→B→A terminate after one visit each, and (b) a hard depth cap, so a long
// acyclic chain stops at maxDepth even with no cycle. Both guards are
// independent — either alone would already terminate, together they also
// bound context size.
import { parseLinks } from './links';
import { getMemory, getMemoryByTitle, type Memory } from './store';

export interface ResolvedMemory {
  root: Memory;
  /** Linked memories in BFS order (root excluded), each visited once. */
  linked: Memory[];
  /** All @toolkit refs found across root + linked, de-duplicated. */
  tools: string[];
  /** [[refs]] that matched no memory for this user (broken links). */
  unresolved: string[];
  /** True when the depth cap cut the walk before all links were followed. */
  truncated: boolean;
}

export interface ResolveOptions {
  /** How many link-hops away from the root to follow. 0 = root only. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 2;

/** Looks up a [[ref]] as an id first, then as a case-insensitive title —
 * always scoped to userId, so a link can never pull in another user's memory. */
async function resolveRef(db: D1Database, userId: string, ref: string): Promise<Memory | null> {
  return (await getMemory(db, userId, ref)) ?? (await getMemoryByTitle(db, userId, ref));
}

export async function resolveMemory(
  db: D1Database,
  userId: string,
  idOrTitle: string,
  opts: ResolveOptions = {}
): Promise<ResolvedMemory | null> {
  const maxDepth = Math.max(0, opts.maxDepth ?? DEFAULT_MAX_DEPTH);
  const root = await resolveRef(db, userId, idOrTitle);
  if (!root) return null;

  const visited = new Set<string>([root.id]);
  const linked: Memory[] = [];
  const tools: string[] = [];
  const toolSeen = new Set<string>();
  const unresolved: string[] = [];
  const unresolvedSeen = new Set<string>();
  let truncated = false;

  const collectTools = (m: Memory): string[] => {
    const { memoryRefs, toolRefs } = parseLinks(m.contentMd);
    for (const t of toolRefs) {
      if (!toolSeen.has(t)) {
        toolSeen.add(t);
        tools.push(t);
      }
    }
    return memoryRefs;
  };

  let frontier: string[] = collectTools(root);
  for (let depth = 1; frontier.length > 0; depth++) {
    if (depth > maxDepth) {
      truncated = true;
      break;
    }
    const next: string[] = [];
    for (const ref of frontier) {
      const m = await resolveRef(db, userId, ref);
      if (!m) {
        const key = ref.toLowerCase();
        if (!unresolvedSeen.has(key)) {
          unresolvedSeen.add(key);
          unresolved.push(ref);
        }
        continue;
      }
      if (visited.has(m.id)) continue; // cycle or diamond — visit once, never loop
      visited.add(m.id);
      linked.push(m);
      next.push(...collectTools(m));
    }
    frontier = next;
  }

  return { root, linked, tools, unresolved, truncated };
}
