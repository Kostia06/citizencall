// Static per-toolkit tool lists for the per-app customization panel
// (ToolCustomizePanel.tsx). Composio doesn't expose a per-toolkit tool list
// through any route this UI can call, so this is a hand-picked list of the
// tools those two toolkits are best known for — good enough to demo
// meaningful on/off switches. Any toolkit not in here degrades to a single
// generic "all tools" switch rather than a broken/empty panel.
export const STATIC_TOOLS: Record<string, string[]> = {
  github: [
    'create_issue',
    'list_issues',
    'create_pull_request',
    'merge_pull_request',
    'list_commits',
    'create_comment',
    'get_repository',
    'star_repository',
  ],
  gmail: ['send_email', 'list_emails', 'search_emails', 'get_email', 'create_draft', 'delete_email', 'add_label'],
};

/** Sentinel tool name meaning "every tool in this toolkit" — used for
 * toolkits with no entry in STATIC_TOOLS above. */
export const ALL_TOOLS_SENTINEL = '*';
