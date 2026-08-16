// Detects Composio catalog toolkits MENTIONED in a prompt so the planner's
// toolkit vocabulary isn't limited to the built-ins (github/gmail) + MCPs.
// "Send a discord message…" must plan a `discord` tool call — which is what
// lets the connection-required pause say "Connect Discord" instead of
// silently planning nothing (found in live verification of the pause flow).
import type { Env } from '../env';
import { getToolkitCatalog } from '../providers/composio-catalog';

// Builtins already in the planner's vocabulary — never re-added here.
const BUILTIN = new Set(['github', 'gmail']);

// Short slugs ('x', 'cal', 'ai', …) false-positive on ordinary words; a
// 4-char floor keeps discord/slack/notion/jira while dropping the noise.
const MIN_SLUG_LEN = 4;
const MAX_MENTIONS = 3;

/** Catalog toolkits whose slug appears as a whole word in `text` (or whose
 * full display name appears as a phrase). Cached catalog read — ~ms after
 * the first call (memory → global D1 row). Fail-open to []: a catalog
 * hiccup must never block planning. */
export async function detectMentionedToolkits(env: Env, text: string): Promise<string[]> {
  let catalog;
  try {
    catalog = await getToolkitCatalog(env);
  } catch {
    return [];
  }
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const tokens = new Set(lower.trim().split(/\s+/));
  const found: string[] = [];
  for (const t of catalog.toolkits) {
    const slug = t.slug.toLowerCase();
    if (BUILTIN.has(slug) || slug.length < MIN_SLUG_LEN) continue;
    const name = ` ${t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    if (tokens.has(slug) || (t.name.length >= MIN_SLUG_LEN && lower.includes(name))) {
      found.push(slug);
      if (found.length >= MAX_MENTIONS) break;
    }
  }
  return found;
}
