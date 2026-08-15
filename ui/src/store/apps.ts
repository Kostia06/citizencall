// Full Composio app catalog (~1,201 toolkits) for the Connections grid —
// bundled locally as composio-apps.json (real Composio slug/name/category/
// logo per toolkit, Composio's own hosted logo CDN) so the grid is fully
// demoable with zero backend and reflects the live catalog's actual breadth,
// not a hand-picked ~100. See ConnectionsPanel.tsx for the render cap and
// category chip/search UI needed to make 1,201 tiles practical.
import composioApps from './composio-apps.json';

export interface ToolkitApp {
  slug: string;
  name: string;
  category: string;
  /** Composio's own hosted logo — reliable, no clearbit/favicon fallback
   * chain needed. AppTile (ConnectionsPanel.tsx) falls back to a neutral
   * initials monogram only if this 404s. */
  logo: string;
}

export const APPS: ToolkitApp[] = composioApps as ToolkitApp[];

function countByCategory(apps: ToolkitApp[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const app of apps) counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
  return counts;
}

// Top categories by app count, for the chip row — the catalog spans 82
// categories, and rendering all of them as chips would be noise. The text
// search matches category too (ConnectionsPanel), so the long tail is still
// reachable by typing, e.g. "crm" or "video conferencing".
const TOP_CATEGORY_COUNT = 10;

export const TOP_CATEGORIES: string[] = [...countByCategory(APPS).entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP_CATEGORY_COUNT)
  .map(([category]) => category);

// All categories, sorted — backs the secondary "browse all categories"
// select and is the fallback if the bundled catalog is ever empty.
export const CATEGORIES: string[] = [...new Set(APPS.map((a) => a.category))].sort();
