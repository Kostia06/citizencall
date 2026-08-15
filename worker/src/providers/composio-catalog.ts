// GET /api/toolkits — normalized Composio app/toolkit catalog for the UI's
// "connect an app" picker. Live Composio-backed when COMPOSIO_API_KEY is
// set; a bundled static list of 100+ popular apps otherwise, so the picker
// is never empty and never needs a key.
//
// Confirmed against the live API (2026-08): GET /api/v3.1/toolkits?limit=100
// with header x-api-key returns { items: [{ slug, name, meta: { logo,
// categories: [{id,name}] } }], next_cursor, total_pages, total_items };
// ~1,200 toolkits over ~13 cursor pages.
//
// Cache layers (fast → durable):
//   L0 module memory (per isolate, 15 min) → L1 D1 `toolkit_catalog` row
//   (GLOBAL — one 13-page walk populates the catalog for every user and
//   survives isolate/dev-server restarts; 24h freshness, and a STALE row
//   still beats the 100-app fallback when Composio is down) → live walk →
//   bundled fallback only when D1 is empty AND the live walk fails.
import type { Env } from '../env';

export interface Toolkit {
  slug: string;
  name: string;
  category: string;
  logo: string;
}

export interface ToolkitCatalog {
  toolkits: Toolkit[];
  source: 'composio' | 'fallback';
}

const COMPOSIO_API_BASE = 'https://backend.composio.dev';
const FETCH_LIMIT = 100; // Composio's page size cap, confirmed live
const CACHE_TTL_MS = 15 * 60 * 1000; // L0 memory
const D1_TTL_MS = 24 * 60 * 60 * 1000; // L1 global — the catalog moves slowly

// L0: module-level cache — a Worker isolate persists across requests for a
// while (same pattern noted in policy.ts for the candidate roster), so this
// pays even the D1 read once instead of on every GET /api/toolkits.
let cached: { catalog: ToolkitCatalog; expiresAt: number } | null = null;

// L1: one global D1 row shared by every user/isolate — same lazy-provision
// pattern as the run cache (cache/schema.ts): no wiring needed, idempotent
// CREATE on first use.
let d1SchemaReady = false;
async function ensureCatalogSchema(db: D1Database): Promise<void> {
  if (d1SchemaReady) return;
  await db.exec(
    'CREATE TABLE IF NOT EXISTS toolkit_catalog(id INTEGER PRIMARY KEY CHECK (id = 1), value_json TEXT NOT NULL, fetched_at INTEGER NOT NULL)'
  );
  d1SchemaReady = true;
}

async function readCatalogRow(db: D1Database): Promise<{ toolkits: Toolkit[]; fetchedAt: number } | null> {
  await ensureCatalogSchema(db);
  const row = await db
    .prepare('SELECT value_json, fetched_at FROM toolkit_catalog WHERE id = 1')
    .first<{ value_json: string; fetched_at: number }>();
  if (!row) return null;
  try {
    return { toolkits: JSON.parse(row.value_json) as Toolkit[], fetchedAt: row.fetched_at };
  } catch {
    return null; // corrupt row — treat as absent, next live walk overwrites it
  }
}

async function writeCatalogRow(db: D1Database, toolkits: Toolkit[], now: number): Promise<void> {
  await ensureCatalogSchema(db);
  await db
    .prepare(
      'INSERT INTO toolkit_catalog (id, value_json, fetched_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET value_json = ?1, fetched_at = ?2'
    )
    .bind(JSON.stringify(toolkits), now)
    .run();
}

interface ComposioToolkitItem {
  slug: string;
  name: string;
  meta?: { logo?: string; categories?: { id: string; name: string }[] };
}

interface ComposioToolkitsResponse {
  items: ComposioToolkitItem[];
  next_cursor?: string | null;
}

function normalize(item: ComposioToolkitItem): Toolkit {
  return {
    slug: item.slug,
    name: item.name,
    category: item.meta?.categories?.[0]?.name ?? 'other',
    logo: item.meta?.logo ?? `https://logo.clearbit.com/${item.slug}.com`,
  };
}

async function fetchLiveCatalog(apiKey: string): Promise<Toolkit[]> {
  // Composio caps each page at 100 — walk next_cursor for the FULL catalog
  // (~1,200 toolkits, ~13 pages). Bounded hard at 25 pages as a runaway
  // guard; a partial walk still throws so the caller falls back rather than
  // caching a silently-truncated list for 15 minutes.
  const all: Toolkit[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 25; page++) {
    const url =
      `${COMPOSIO_API_BASE}/api/v3.1/toolkits?limit=${FETCH_LIMIT}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) throw new Error(`Composio toolkits ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as ComposioToolkitsResponse;
    all.push(...body.items.map(normalize));
    cursor = body.next_cursor ?? null;
    if (!cursor) return all;
  }
  return all; // 25 pages = 2,500 apps — more than the catalog holds today
}

export async function getToolkitCatalog(env: Env): Promise<ToolkitCatalog> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.catalog;

  // L1 — the globally shared D1 row: fresh enough serves everyone without
  // touching Composio at all.
  let staleRow: { toolkits: Toolkit[]; fetchedAt: number } | null = null;
  try {
    const row = await readCatalogRow(env.DB);
    if (row) {
      if (now - row.fetchedAt < D1_TTL_MS) {
        const catalog: ToolkitCatalog = { toolkits: row.toolkits, source: 'composio' };
        cached = { catalog, expiresAt: now + CACHE_TTL_MS };
        return catalog;
      }
      staleRow = row; // keep as a better-than-fallback safety net below
    }
  } catch {
    // D1 hiccup — proceed to the live walk; the picker must never 500.
  }

  if (env.COMPOSIO_API_KEY) {
    try {
      const toolkits = await fetchLiveCatalog(env.COMPOSIO_API_KEY);
      const catalog: ToolkitCatalog = { toolkits, source: 'composio' };
      cached = { catalog, expiresAt: now + CACHE_TTL_MS };
      // Distribute: persist for every other isolate/user. Failure to write
      // is non-fatal — this request already has its answer.
      try {
        await writeCatalogRow(env.DB, toolkits, now);
      } catch {
        /* non-fatal */
      }
      return catalog;
    } catch {
      // Composio outage (or bad key): a STALE global row is still the full
      // real catalog — far better than the 100-app fallback.
      if (staleRow) {
        const catalog: ToolkitCatalog = { toolkits: staleRow.toolkits, source: 'composio' };
        cached = { catalog, expiresAt: now + CACHE_TTL_MS };
        return catalog;
      }
    }
  } else if (staleRow) {
    // No key on this deployment but a previous keyed run populated the
    // global row — keep distributing it.
    const catalog: ToolkitCatalog = { toolkits: staleRow.toolkits, source: 'composio' };
    cached = { catalog, expiresAt: now + CACHE_TTL_MS };
    return catalog;
  }

  const catalog: ToolkitCatalog = { toolkits: FALLBACK_TOOLKITS, source: 'fallback' };
  cached = { catalog, expiresAt: now + CACHE_TTL_MS };
  return catalog;
}

// Test-only escape hatch — vitest reuses the same module across test files
// in a worker isolate, so a live-catalog test run first would otherwise
// poison every later fallback-path assertion.
export function resetToolkitCatalogCacheForTests(): void {
  cached = null;
}

// Bundled fallback: 100+ real, popular Composio-supported apps spanning the
// categories a "connect an app" picker actually needs. logo is a Clearbit
// Logo API URL keyed off each app's real domain.
const FALLBACK_TOOLKITS: Toolkit[] = [
  // developer-tools
  { slug: 'github', name: 'GitHub', category: 'developer-tools', logo: 'https://logo.clearbit.com/github.com' },
  { slug: 'gitlab', name: 'GitLab', category: 'developer-tools', logo: 'https://logo.clearbit.com/gitlab.com' },
  { slug: 'bitbucket', name: 'Bitbucket', category: 'developer-tools', logo: 'https://logo.clearbit.com/bitbucket.org' },
  { slug: 'jira', name: 'Jira', category: 'developer-tools', logo: 'https://logo.clearbit.com/atlassian.com' },
  { slug: 'confluence', name: 'Confluence', category: 'developer-tools', logo: 'https://logo.clearbit.com/atlassian.com' },
  { slug: 'linear', name: 'Linear', category: 'developer-tools', logo: 'https://logo.clearbit.com/linear.app' },
  { slug: 'vercel', name: 'Vercel', category: 'developer-tools', logo: 'https://logo.clearbit.com/vercel.com' },
  { slug: 'netlify', name: 'Netlify', category: 'developer-tools', logo: 'https://logo.clearbit.com/netlify.com' },
  { slug: 'docker', name: 'Docker', category: 'developer-tools', logo: 'https://logo.clearbit.com/docker.com' },
  { slug: 'npm', name: 'npm', category: 'developer-tools', logo: 'https://logo.clearbit.com/npmjs.com' },
  { slug: 'circleci', name: 'CircleCI', category: 'developer-tools', logo: 'https://logo.clearbit.com/circleci.com' },
  { slug: 'sentry', name: 'Sentry', category: 'developer-tools', logo: 'https://logo.clearbit.com/sentry.io' },
  { slug: 'pagerduty', name: 'PagerDuty', category: 'developer-tools', logo: 'https://logo.clearbit.com/pagerduty.com' },
  { slug: 'datadog', name: 'Datadog', category: 'developer-tools', logo: 'https://logo.clearbit.com/datadoghq.com' },
  { slug: 'cloudflare', name: 'Cloudflare', category: 'developer-tools', logo: 'https://logo.clearbit.com/cloudflare.com' },
  { slug: 'postman', name: 'Postman', category: 'developer-tools', logo: 'https://logo.clearbit.com/postman.com' },

  // communication
  { slug: 'slack', name: 'Slack', category: 'communication', logo: 'https://logo.clearbit.com/slack.com' },
  { slug: 'discord', name: 'Discord', category: 'communication', logo: 'https://logo.clearbit.com/discord.com' },
  { slug: 'microsoftteams', name: 'Microsoft Teams', category: 'communication', logo: 'https://logo.clearbit.com/microsoft.com' },
  { slug: 'zoom', name: 'Zoom', category: 'communication', logo: 'https://logo.clearbit.com/zoom.us' },
  { slug: 'gmail', name: 'Gmail', category: 'communication', logo: 'https://logo.clearbit.com/gmail.com' },
  { slug: 'outlook', name: 'Outlook', category: 'communication', logo: 'https://logo.clearbit.com/outlook.com' },
  { slug: 'telegram', name: 'Telegram', category: 'communication', logo: 'https://logo.clearbit.com/telegram.org' },
  { slug: 'whatsapp', name: 'WhatsApp', category: 'communication', logo: 'https://logo.clearbit.com/whatsapp.com' },
  { slug: 'twilio', name: 'Twilio', category: 'communication', logo: 'https://logo.clearbit.com/twilio.com' },
  { slug: 'webex', name: 'Webex', category: 'communication', logo: 'https://logo.clearbit.com/webex.com' },

  // productivity
  { slug: 'notion', name: 'Notion', category: 'productivity', logo: 'https://logo.clearbit.com/notion.so' },
  { slug: 'googlecalendar', name: 'Google Calendar', category: 'productivity', logo: 'https://logo.clearbit.com/calendar.google.com' },
  { slug: 'googledrive', name: 'Google Drive', category: 'productivity', logo: 'https://logo.clearbit.com/drive.google.com' },
  { slug: 'googlesheets', name: 'Google Sheets', category: 'productivity', logo: 'https://logo.clearbit.com/sheets.google.com' },
  { slug: 'googledocs', name: 'Google Docs', category: 'productivity', logo: 'https://logo.clearbit.com/docs.google.com' },
  { slug: 'googleslides', name: 'Google Slides', category: 'productivity', logo: 'https://logo.clearbit.com/slides.google.com' },
  { slug: 'evernote', name: 'Evernote', category: 'productivity', logo: 'https://logo.clearbit.com/evernote.com' },
  { slug: 'todoist', name: 'Todoist', category: 'productivity', logo: 'https://logo.clearbit.com/todoist.com' },
  { slug: 'trello', name: 'Trello', category: 'productivity', logo: 'https://logo.clearbit.com/trello.com' },
  { slug: 'onenote', name: 'OneNote', category: 'productivity', logo: 'https://logo.clearbit.com/onenote.com' },

  // crm
  { slug: 'salesforce', name: 'Salesforce', category: 'crm', logo: 'https://logo.clearbit.com/salesforce.com' },
  { slug: 'hubspot', name: 'HubSpot', category: 'crm', logo: 'https://logo.clearbit.com/hubspot.com' },
  { slug: 'pipedrive', name: 'Pipedrive', category: 'crm', logo: 'https://logo.clearbit.com/pipedrive.com' },
  { slug: 'zohocrm', name: 'Zoho CRM', category: 'crm', logo: 'https://logo.clearbit.com/zoho.com' },
  { slug: 'freshsales', name: 'Freshsales', category: 'crm', logo: 'https://logo.clearbit.com/freshworks.com' },
  { slug: 'closecrm', name: 'Close', category: 'crm', logo: 'https://logo.clearbit.com/close.com' },
  { slug: 'copper', name: 'Copper', category: 'crm', logo: 'https://logo.clearbit.com/copper.com' },
  { slug: 'insightly', name: 'Insightly', category: 'crm', logo: 'https://logo.clearbit.com/insightly.com' },
  { slug: 'keap', name: 'Keap', category: 'crm', logo: 'https://logo.clearbit.com/keap.com' },
  { slug: 'nutshell', name: 'Nutshell', category: 'crm', logo: 'https://logo.clearbit.com/nutshell.com' },

  // storage
  { slug: 'dropbox', name: 'Dropbox', category: 'storage', logo: 'https://logo.clearbit.com/dropbox.com' },
  { slug: 'box', name: 'Box', category: 'storage', logo: 'https://logo.clearbit.com/box.com' },
  { slug: 'onedrive', name: 'OneDrive', category: 'storage', logo: 'https://logo.clearbit.com/onedrive.live.com' },
  { slug: 'amazons3', name: 'Amazon S3', category: 'storage', logo: 'https://logo.clearbit.com/aws.amazon.com' },
  { slug: 'backblaze', name: 'Backblaze', category: 'storage', logo: 'https://logo.clearbit.com/backblaze.com' },
  { slug: 'egnyte', name: 'Egnyte', category: 'storage', logo: 'https://logo.clearbit.com/egnyte.com' },
  { slug: 'sharepoint', name: 'SharePoint', category: 'storage', logo: 'https://logo.clearbit.com/sharepoint.com' },

  // social-media
  { slug: 'twitter', name: 'X (Twitter)', category: 'social-media', logo: 'https://logo.clearbit.com/x.com' },
  { slug: 'linkedin', name: 'LinkedIn', category: 'social-media', logo: 'https://logo.clearbit.com/linkedin.com' },
  { slug: 'facebook', name: 'Facebook', category: 'social-media', logo: 'https://logo.clearbit.com/facebook.com' },
  { slug: 'instagram', name: 'Instagram', category: 'social-media', logo: 'https://logo.clearbit.com/instagram.com' },
  { slug: 'youtube', name: 'YouTube', category: 'social-media', logo: 'https://logo.clearbit.com/youtube.com' },
  { slug: 'pinterest', name: 'Pinterest', category: 'social-media', logo: 'https://logo.clearbit.com/pinterest.com' },
  { slug: 'reddit', name: 'Reddit', category: 'social-media', logo: 'https://logo.clearbit.com/reddit.com' },
  { slug: 'tiktok', name: 'TikTok', category: 'social-media', logo: 'https://logo.clearbit.com/tiktok.com' },
  { slug: 'mastodon', name: 'Mastodon', category: 'social-media', logo: 'https://logo.clearbit.com/joinmastodon.org' },
  { slug: 'threads', name: 'Threads', category: 'social-media', logo: 'https://logo.clearbit.com/threads.net' },

  // finance
  { slug: 'stripe', name: 'Stripe', category: 'finance', logo: 'https://logo.clearbit.com/stripe.com' },
  { slug: 'paypal', name: 'PayPal', category: 'finance', logo: 'https://logo.clearbit.com/paypal.com' },
  { slug: 'quickbooks', name: 'QuickBooks', category: 'finance', logo: 'https://logo.clearbit.com/quickbooks.intuit.com' },
  { slug: 'xero', name: 'Xero', category: 'finance', logo: 'https://logo.clearbit.com/xero.com' },
  { slug: 'plaid', name: 'Plaid', category: 'finance', logo: 'https://logo.clearbit.com/plaid.com' },
  { slug: 'wise', name: 'Wise', category: 'finance', logo: 'https://logo.clearbit.com/wise.com' },
  { slug: 'brex', name: 'Brex', category: 'finance', logo: 'https://logo.clearbit.com/brex.com' },
  { slug: 'ramp', name: 'Ramp', category: 'finance', logo: 'https://logo.clearbit.com/ramp.com' },

  // marketing
  { slug: 'mailchimp', name: 'Mailchimp', category: 'marketing', logo: 'https://logo.clearbit.com/mailchimp.com' },
  { slug: 'sendgrid', name: 'SendGrid', category: 'marketing', logo: 'https://logo.clearbit.com/sendgrid.com' },
  { slug: 'klaviyo', name: 'Klaviyo', category: 'marketing', logo: 'https://logo.clearbit.com/klaviyo.com' },
  { slug: 'activecampaign', name: 'ActiveCampaign', category: 'marketing', logo: 'https://logo.clearbit.com/activecampaign.com' },
  { slug: 'constantcontact', name: 'Constant Contact', category: 'marketing', logo: 'https://logo.clearbit.com/constantcontact.com' },
  { slug: 'marketo', name: 'Marketo', category: 'marketing', logo: 'https://logo.clearbit.com/marketo.com' },
  { slug: 'customerio', name: 'Customer.io', category: 'marketing', logo: 'https://logo.clearbit.com/customer.io' },
  { slug: 'braze', name: 'Braze', category: 'marketing', logo: 'https://logo.clearbit.com/braze.com' },

  // support
  { slug: 'zendesk', name: 'Zendesk', category: 'support', logo: 'https://logo.clearbit.com/zendesk.com' },
  { slug: 'freshdesk', name: 'Freshdesk', category: 'support', logo: 'https://logo.clearbit.com/freshworks.com' },
  { slug: 'helpscout', name: 'Help Scout', category: 'support', logo: 'https://logo.clearbit.com/helpscout.com' },
  { slug: 'intercom', name: 'Intercom', category: 'support', logo: 'https://logo.clearbit.com/intercom.com' },
  { slug: 'frontapp', name: 'Front', category: 'support', logo: 'https://logo.clearbit.com/front.com' },
  { slug: 'kayako', name: 'Kayako', category: 'support', logo: 'https://logo.clearbit.com/kayako.com' },
  { slug: 'groove', name: 'Groove', category: 'support', logo: 'https://logo.clearbit.com/groovehq.com' },
  { slug: 'gorgias', name: 'Gorgias', category: 'support', logo: 'https://logo.clearbit.com/gorgias.com' },

  // ecommerce
  { slug: 'shopify', name: 'Shopify', category: 'ecommerce', logo: 'https://logo.clearbit.com/shopify.com' },
  { slug: 'woocommerce', name: 'WooCommerce', category: 'ecommerce', logo: 'https://logo.clearbit.com/woocommerce.com' },
  { slug: 'bigcommerce', name: 'BigCommerce', category: 'ecommerce', logo: 'https://logo.clearbit.com/bigcommerce.com' },
  { slug: 'magento', name: 'Magento', category: 'ecommerce', logo: 'https://logo.clearbit.com/magento.com' },
  { slug: 'squarespace', name: 'Squarespace', category: 'ecommerce', logo: 'https://logo.clearbit.com/squarespace.com' },
  { slug: 'wix', name: 'Wix', category: 'ecommerce', logo: 'https://logo.clearbit.com/wix.com' },
  { slug: 'etsy', name: 'Etsy', category: 'ecommerce', logo: 'https://logo.clearbit.com/etsy.com' },
  { slug: 'amazonseller', name: 'Amazon Seller Central', category: 'ecommerce', logo: 'https://logo.clearbit.com/sellercentral.amazon.com' },

  // project-management
  { slug: 'asana', name: 'Asana', category: 'project-management', logo: 'https://logo.clearbit.com/asana.com' },
  { slug: 'mondaycom', name: 'monday.com', category: 'project-management', logo: 'https://logo.clearbit.com/monday.com' },
  { slug: 'clickup', name: 'ClickUp', category: 'project-management', logo: 'https://logo.clearbit.com/clickup.com' },
  { slug: 'basecamp', name: 'Basecamp', category: 'project-management', logo: 'https://logo.clearbit.com/basecamp.com' },
  { slug: 'wrike', name: 'Wrike', category: 'project-management', logo: 'https://logo.clearbit.com/wrike.com' },
  { slug: 'smartsheet', name: 'Smartsheet', category: 'project-management', logo: 'https://logo.clearbit.com/smartsheet.com' },
  { slug: 'teamwork', name: 'Teamwork', category: 'project-management', logo: 'https://logo.clearbit.com/teamwork.com' },
  { slug: 'height', name: 'Height', category: 'project-management', logo: 'https://logo.clearbit.com/height.app' },

  // scheduling
  { slug: 'calendly', name: 'Calendly', category: 'scheduling', logo: 'https://logo.clearbit.com/calendly.com' },
  { slug: 'acuityscheduling', name: 'Acuity Scheduling', category: 'scheduling', logo: 'https://logo.clearbit.com/acuityscheduling.com' },
  { slug: 'doodle', name: 'Doodle', category: 'scheduling', logo: 'https://logo.clearbit.com/doodle.com' },
  { slug: 'cal', name: 'Cal.com', category: 'scheduling', logo: 'https://logo.clearbit.com/cal.com' },

  // design
  { slug: 'figma', name: 'Figma', category: 'design', logo: 'https://logo.clearbit.com/figma.com' },
  { slug: 'canva', name: 'Canva', category: 'design', logo: 'https://logo.clearbit.com/canva.com' },
  { slug: 'adobexd', name: 'Adobe XD', category: 'design', logo: 'https://logo.clearbit.com/adobe.com' },
  { slug: 'sketch', name: 'Sketch', category: 'design', logo: 'https://logo.clearbit.com/sketch.com' },
  { slug: 'invision', name: 'InVision', category: 'design', logo: 'https://logo.clearbit.com/invisionapp.com' },
  { slug: 'miro', name: 'Miro', category: 'design', logo: 'https://logo.clearbit.com/miro.com' },

  // analytics
  { slug: 'googleanalytics', name: 'Google Analytics', category: 'analytics', logo: 'https://logo.clearbit.com/analytics.google.com' },
  { slug: 'mixpanel', name: 'Mixpanel', category: 'analytics', logo: 'https://logo.clearbit.com/mixpanel.com' },
  { slug: 'amplitude', name: 'Amplitude', category: 'analytics', logo: 'https://logo.clearbit.com/amplitude.com' },
  { slug: 'segment', name: 'Segment', category: 'analytics', logo: 'https://logo.clearbit.com/segment.com' },
  { slug: 'heap', name: 'Heap', category: 'analytics', logo: 'https://logo.clearbit.com/heap.io' },
  { slug: 'posthog', name: 'PostHog', category: 'analytics', logo: 'https://logo.clearbit.com/posthog.com' },

  // ai
  { slug: 'openai', name: 'OpenAI', category: 'ai', logo: 'https://logo.clearbit.com/openai.com' },
  { slug: 'anthropic', name: 'Anthropic', category: 'ai', logo: 'https://logo.clearbit.com/anthropic.com' },
  { slug: 'huggingface', name: 'Hugging Face', category: 'ai', logo: 'https://logo.clearbit.com/huggingface.co' },
  { slug: 'replicate', name: 'Replicate', category: 'ai', logo: 'https://logo.clearbit.com/replicate.com' },
  { slug: 'stabilityai', name: 'Stability AI', category: 'ai', logo: 'https://logo.clearbit.com/stability.ai' },
  { slug: 'cohere', name: 'Cohere', category: 'ai', logo: 'https://logo.clearbit.com/cohere.com' },

  // hr
  { slug: 'bamboohr', name: 'BambooHR', category: 'hr', logo: 'https://logo.clearbit.com/bamboohr.com' },
  { slug: 'gusto', name: 'Gusto', category: 'hr', logo: 'https://logo.clearbit.com/gusto.com' },
  { slug: 'workday', name: 'Workday', category: 'hr', logo: 'https://logo.clearbit.com/workday.com' },
  { slug: 'greenhouse', name: 'Greenhouse', category: 'hr', logo: 'https://logo.clearbit.com/greenhouse.io' },
  { slug: 'lever', name: 'Lever', category: 'hr', logo: 'https://logo.clearbit.com/lever.co' },
  { slug: 'rippling', name: 'Rippling', category: 'hr', logo: 'https://logo.clearbit.com/rippling.com' },

  // video
  { slug: 'loom', name: 'Loom', category: 'video', logo: 'https://logo.clearbit.com/loom.com' },
  { slug: 'vimeo', name: 'Vimeo', category: 'video', logo: 'https://logo.clearbit.com/vimeo.com' },
  { slug: 'wistia', name: 'Wistia', category: 'video', logo: 'https://logo.clearbit.com/wistia.com' },
  { slug: 'googlemeet', name: 'Google Meet', category: 'video', logo: 'https://logo.clearbit.com/meet.google.com' },

  // forms
  { slug: 'typeform', name: 'Typeform', category: 'forms', logo: 'https://logo.clearbit.com/typeform.com' },
  { slug: 'googleforms', name: 'Google Forms', category: 'forms', logo: 'https://logo.clearbit.com/forms.google.com' },
  { slug: 'jotform', name: 'Jotform', category: 'forms', logo: 'https://logo.clearbit.com/jotform.com' },
  { slug: 'surveymonkey', name: 'SurveyMonkey', category: 'forms', logo: 'https://logo.clearbit.com/surveymonkey.com' },
  { slug: 'formstack', name: 'Formstack', category: 'forms', logo: 'https://logo.clearbit.com/formstack.com' },

  // database
  { slug: 'postgresql', name: 'PostgreSQL', category: 'database', logo: 'https://logo.clearbit.com/postgresql.org' },
  { slug: 'mongodb', name: 'MongoDB', category: 'database', logo: 'https://logo.clearbit.com/mongodb.com' },
  { slug: 'airtable', name: 'Airtable', category: 'database', logo: 'https://logo.clearbit.com/airtable.com' },
  { slug: 'supabase', name: 'Supabase', category: 'database', logo: 'https://logo.clearbit.com/supabase.com' },
  { slug: 'firebase', name: 'Firebase', category: 'database', logo: 'https://logo.clearbit.com/firebase.google.com' },
  { slug: 'redis', name: 'Redis', category: 'database', logo: 'https://logo.clearbit.com/redis.io' },
  { slug: 'snowflake', name: 'Snowflake', category: 'database', logo: 'https://logo.clearbit.com/snowflake.com' },
  { slug: 'mysql', name: 'MySQL', category: 'database', logo: 'https://logo.clearbit.com/mysql.com' },
];
