// In-memory mock for /api/memories — keeps the /memory page fully demoable
// with zero backend (MOCK mode or live-fallback), mirroring the worker's
// routes semantics including the cycle-safe link resolution: the seed data
// deliberately contains a two-node cycle so the demo shows it terminating.
import type { UserMemory, UserMemoryDetail } from '../../types';

const now = Date.now();

let memories: UserMemory[] = [
  {
    id: 'mem-pref-answers',
    title: 'Prefers short answers',
    contentMd: 'I prefer short answers — skip the preamble.\n\nRelated: [[Working style]]',
    source: 'agent',
    createdAt: now - 1000 * 60 * 60 * 26,
    updatedAt: now - 1000 * 60 * 60 * 26,
  },
  {
    id: 'mem-working-style',
    title: 'Working style',
    contentMd: 'Reviews PRs in the morning. Use @github for repo tasks.\n\nSee also [[Prefers short answers]].',
    source: 'user',
    createdAt: now - 1000 * 60 * 60 * 50,
    updatedAt: now - 1000 * 60 * 60 * 3,
  },
];

function byRef(ref: string): UserMemory | undefined {
  const key = ref.trim().toLowerCase();
  return memories.find((m) => m.id === ref) ?? memories.find((m) => m.title.toLowerCase() === key);
}

/** Same walk as worker memory/resolve.ts: BFS, visited-set, depth cap — a
 * self-link or cycle terminates instead of looping. */
function resolveLinks(root: UserMemory, maxDepth = 2): UserMemoryDetail['links'] {
  const visited = new Set<string>([root.id]);
  const linked: Array<{ id: string; title: string }> = [];
  const tools = new Set<string>();
  const unresolved = new Set<string>();
  let truncated = false;

  const refsOf = (md: string): string[] => {
    for (const t of md.matchAll(/(^|[^\w])@([a-z][a-z0-9_-]{1,63})/gi)) tools.add((t[2] ?? '').toLowerCase());
    return [...md.matchAll(/\[\[([^[\]]+)\]\]/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  };

  let frontier = refsOf(root.contentMd);
  for (let depth = 1; frontier.length > 0; depth++) {
    if (depth > maxDepth) {
      truncated = true;
      break;
    }
    const next: string[] = [];
    for (const ref of frontier) {
      const m = byRef(ref);
      if (!m) {
        unresolved.add(ref);
        continue;
      }
      if (visited.has(m.id)) continue;
      visited.add(m.id);
      linked.push({ id: m.id, title: m.title });
      next.push(...refsOf(m.contentMd));
    }
    frontier = next;
  }

  return { memories: linked, tools: [...tools], unresolved: [...unresolved], truncated };
}

const sorted = () => [...memories].sort((a, b) => b.updatedAt - a.updatedAt);

export const mockMemoryStore = {
  async list(): Promise<UserMemory[]> {
    return sorted();
  },

  async get(id: string): Promise<UserMemoryDetail> {
    const m = memories.find((x) => x.id === id);
    if (!m) throw new Error('Not found.');
    return { ...m, links: resolveLinks(m) };
  },

  async create(input: { title: string; contentMd: string }): Promise<UserMemory> {
    const m: UserMemory = {
      id: `mem-${Date.now().toString(36)}`,
      title: input.title,
      contentMd: input.contentMd,
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    memories = [m, ...memories];
    return m;
  },

  async update(id: string, patch: { title?: string; contentMd?: string }): Promise<UserMemory> {
    const m = memories.find((x) => x.id === id);
    if (!m) throw new Error('Not found.');
    if (patch.title !== undefined) m.title = patch.title;
    if (patch.contentMd !== undefined) m.contentMd = patch.contentMd;
    m.updatedAt = Date.now();
    return { ...m };
  },

  async remove(id: string): Promise<void> {
    memories = memories.filter((x) => x.id !== id);
  },

  /** Lets the mock run scenario drop an agent memory so memory_saved demos. */
  async addAgentMemory(title: string, contentMd: string): Promise<UserMemory> {
    const existing = memories.find((m) => m.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      existing.contentMd = contentMd;
      existing.updatedAt = Date.now();
      return { ...existing };
    }
    const m: UserMemory = {
      id: `mem-${Date.now().toString(36)}`,
      title,
      contentMd,
      source: 'agent',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    memories = [m, ...memories];
    return m;
  },
};
