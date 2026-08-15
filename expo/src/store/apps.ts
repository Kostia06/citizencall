// Ported from ui/src/store/apps.ts — full Composio app catalog (~1,201
// toolkits) bundled locally as a COPY of composio-apps.json, so the
// Connections grid is fully demoable with zero backend. Keep this file in
// sync with the web version if the catalog is ever regenerated.
import composioApps from './composio-apps.json';

export interface ToolkitApp {
  slug: string;
  name: string;
  category: string;
  logo: string;
}

export const APPS: ToolkitApp[] = composioApps as ToolkitApp[];

const TOP_CATEGORY_COUNT = 10;

function countByCategory(apps: ToolkitApp[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const app of apps) counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
  return counts;
}

export const TOP_CATEGORIES: string[] = [...countByCategory(APPS).entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP_CATEGORY_COUNT)
  .map(([category]) => category);
