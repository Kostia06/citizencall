// Static catalog of 100+ popular apps for the Connections grid — guarantees
// a fully demoable "100+ app" connect experience with zero backend (MOCK
// mode, or a live Worker that hasn't implemented GET /api/toolkits yet).
// Logos resolve via Clearbit's public logo CDN (`logo.clearbit.com/<domain>`)
// keyed off each app's real domain, so every entry renders a real brand mark
// with no icon-slug guessing. `AppTile` (ConnectionsPanel.tsx) falls back to
// a colored initial avatar if a logo fails to load (offline demo, ad-blocker,
// etc.) — see `appColor` below.
export interface ToolkitApp {
  slug: string;
  name: string;
  category: string;
  logo: string;
}

type RawApp = [slug: string, name: string, category: string, domain: string];

const RAW_APPS: RawApp[] = [
  // Dev Tools
  ['github', 'GitHub', 'Dev Tools', 'github.com'],
  ['gitlab', 'GitLab', 'Dev Tools', 'gitlab.com'],
  ['bitbucket', 'Bitbucket', 'Dev Tools', 'bitbucket.org'],
  ['jira', 'Jira', 'Dev Tools', 'atlassian.com'],
  ['confluence', 'Confluence', 'Dev Tools', 'atlassian.com'],
  ['circleci', 'CircleCI', 'Dev Tools', 'circleci.com'],
  ['jenkins', 'Jenkins', 'Dev Tools', 'jenkins.io'],
  ['docker', 'Docker', 'Dev Tools', 'docker.com'],
  ['vercel', 'Vercel', 'Dev Tools', 'vercel.com'],
  ['netlify', 'Netlify', 'Dev Tools', 'netlify.com'],
  ['npm', 'npm', 'Dev Tools', 'npmjs.com'],
  ['pypi', 'PyPI', 'Dev Tools', 'pypi.org'],
  ['postman', 'Postman', 'Dev Tools', 'postman.com'],
  ['sentry', 'Sentry', 'Dev Tools', 'sentry.io'],
  ['datadog', 'Datadog', 'Dev Tools', 'datadoghq.com'],
  ['pagerduty', 'PagerDuty', 'Dev Tools', 'pagerduty.com'],
  ['linear', 'Linear', 'Dev Tools', 'linear.app'],
  ['heroku', 'Heroku', 'Dev Tools', 'heroku.com'],
  ['digitalocean', 'DigitalOcean', 'Dev Tools', 'digitalocean.com'],
  ['cloudflare', 'Cloudflare', 'Dev Tools', 'cloudflare.com'],
  ['terraform', 'Terraform', 'Dev Tools', 'terraform.io'],
  ['supabase', 'Supabase', 'Dev Tools', 'supabase.com'],
  ['railway', 'Railway', 'Dev Tools', 'railway.app'],

  // Communication
  ['slack', 'Slack', 'Communication', 'slack.com'],
  ['discord', 'Discord', 'Communication', 'discord.com'],
  ['microsoft-teams', 'Microsoft Teams', 'Communication', 'microsoft.com'],
  ['zoom', 'Zoom', 'Communication', 'zoom.us'],
  ['google-meet', 'Google Meet', 'Communication', 'meet.google.com'],
  ['telegram', 'Telegram', 'Communication', 'telegram.org'],
  ['whatsapp', 'WhatsApp', 'Communication', 'whatsapp.com'],
  ['twilio', 'Twilio', 'Communication', 'twilio.com'],
  ['intercom', 'Intercom', 'Communication', 'intercom.com'],
  ['zendesk', 'Zendesk', 'Communication', 'zendesk.com'],
  ['front', 'Front', 'Communication', 'front.com'],
  ['loom', 'Loom', 'Communication', 'loom.com'],
  ['calendly', 'Calendly', 'Communication', 'calendly.com'],
  ['ringcentral', 'RingCentral', 'Communication', 'ringcentral.com'],
  ['webex', 'Webex', 'Communication', 'webex.com'],

  // Productivity
  ['notion', 'Notion', 'Productivity', 'notion.so'],
  ['trello', 'Trello', 'Productivity', 'trello.com'],
  ['asana', 'Asana', 'Productivity', 'asana.com'],
  ['monday', 'monday.com', 'Productivity', 'monday.com'],
  ['clickup', 'ClickUp', 'Productivity', 'clickup.com'],
  ['todoist', 'Todoist', 'Productivity', 'todoist.com'],
  ['evernote', 'Evernote', 'Productivity', 'evernote.com'],
  ['airtable', 'Airtable', 'Productivity', 'airtable.com'],
  ['coda', 'Coda', 'Productivity', 'coda.io'],
  ['miro', 'Miro', 'Productivity', 'miro.com'],
  ['basecamp', 'Basecamp', 'Productivity', 'basecamp.com'],
  ['wrike', 'Wrike', 'Productivity', 'wrike.com'],
  ['smartsheet', 'Smartsheet', 'Productivity', 'smartsheet.com'],
  ['google-calendar', 'Google Calendar', 'Productivity', 'calendar.google.com'],
  ['google-docs', 'Google Docs', 'Productivity', 'docs.google.com'],
  ['gmail', 'Gmail', 'Productivity', 'gmail.com'],

  // CRM / Sales
  ['salesforce', 'Salesforce', 'CRM', 'salesforce.com'],
  ['hubspot', 'HubSpot', 'CRM', 'hubspot.com'],
  ['pipedrive', 'Pipedrive', 'CRM', 'pipedrive.com'],
  ['zoho-crm', 'Zoho CRM', 'CRM', 'zoho.com'],
  ['freshsales', 'Freshsales', 'CRM', 'freshworks.com'],
  ['close', 'Close', 'CRM', 'close.com'],
  ['copper', 'Copper', 'CRM', 'copper.com'],
  ['insightly', 'Insightly', 'CRM', 'insightly.com'],
  ['nutshell', 'Nutshell', 'CRM', 'nutshell.com'],
  ['activecampaign', 'ActiveCampaign', 'CRM', 'activecampaign.com'],

  // Storage
  ['google-drive', 'Google Drive', 'Storage', 'drive.google.com'],
  ['dropbox', 'Dropbox', 'Storage', 'dropbox.com'],
  ['box', 'Box', 'Storage', 'box.com'],
  ['onedrive', 'OneDrive', 'Storage', 'onedrive.live.com'],
  ['icloud', 'iCloud', 'Storage', 'icloud.com'],
  ['amazon-s3', 'Amazon S3', 'Storage', 'aws.amazon.com'],
  ['backblaze', 'Backblaze', 'Storage', 'backblaze.com'],
  ['pcloud', 'pCloud', 'Storage', 'pcloud.com'],
  ['mega', 'MEGA', 'Storage', 'mega.io'],
  ['egnyte', 'Egnyte', 'Storage', 'egnyte.com'],

  // Social
  ['twitter', 'X (Twitter)', 'Social', 'x.com'],
  ['facebook', 'Facebook', 'Social', 'facebook.com'],
  ['instagram', 'Instagram', 'Social', 'instagram.com'],
  ['linkedin', 'LinkedIn', 'Social', 'linkedin.com'],
  ['youtube', 'YouTube', 'Social', 'youtube.com'],
  ['tiktok', 'TikTok', 'Social', 'tiktok.com'],
  ['pinterest', 'Pinterest', 'Social', 'pinterest.com'],
  ['reddit', 'Reddit', 'Social', 'reddit.com'],
  ['snapchat', 'Snapchat', 'Social', 'snapchat.com'],
  ['threads', 'Threads', 'Social', 'threads.net'],

  // Design
  ['figma', 'Figma', 'Design', 'figma.com'],
  ['adobe-xd', 'Adobe XD', 'Design', 'adobe.com'],
  ['sketch', 'Sketch', 'Design', 'sketch.com'],
  ['canva', 'Canva', 'Design', 'canva.com'],
  ['invision', 'InVision', 'Design', 'invisionapp.com'],
  ['framer', 'Framer', 'Design', 'framer.com'],
  ['zeplin', 'Zeplin', 'Design', 'zeplin.io'],
  ['photoshop', 'Photoshop', 'Design', 'adobe.com'],
  ['illustrator', 'Illustrator', 'Design', 'adobe.com'],
  ['webflow', 'Webflow', 'Design', 'webflow.com'],

  // Finance
  ['stripe', 'Stripe', 'Finance', 'stripe.com'],
  ['paypal', 'PayPal', 'Finance', 'paypal.com'],
  ['square', 'Square', 'Finance', 'squareup.com'],
  ['quickbooks', 'QuickBooks', 'Finance', 'quickbooks.intuit.com'],
  ['xero', 'Xero', 'Finance', 'xero.com'],
  ['freshbooks', 'FreshBooks', 'Finance', 'freshbooks.com'],
  ['wave', 'Wave', 'Finance', 'waveapps.com'],
  ['plaid', 'Plaid', 'Finance', 'plaid.com'],
  ['brex', 'Brex', 'Finance', 'brex.com'],
  ['ramp', 'Ramp', 'Finance', 'ramp.com'],

  // AI
  ['openai', 'OpenAI', 'AI', 'openai.com'],
  ['anthropic', 'Anthropic', 'AI', 'anthropic.com'],
  ['huggingface', 'Hugging Face', 'AI', 'huggingface.co'],
  ['midjourney', 'Midjourney', 'AI', 'midjourney.com'],
  ['replicate', 'Replicate', 'AI', 'replicate.com'],
  ['cohere', 'Cohere', 'AI', 'cohere.com'],
  ['stability-ai', 'Stability AI', 'AI', 'stability.ai'],
  ['perplexity', 'Perplexity', 'AI', 'perplexity.ai'],
  ['elevenlabs', 'ElevenLabs', 'AI', 'elevenlabs.io'],
  ['runwayml', 'Runway', 'AI', 'runwayml.com'],

  // Marketing
  ['mailchimp', 'Mailchimp', 'Marketing', 'mailchimp.com'],
  ['google-ads', 'Google Ads', 'Marketing', 'ads.google.com'],
  ['facebook-ads', 'Meta Ads', 'Marketing', 'business.facebook.com'],
  ['marketo', 'Marketo', 'Marketing', 'marketo.com'],
  ['klaviyo', 'Klaviyo', 'Marketing', 'klaviyo.com'],
  ['sendgrid', 'SendGrid', 'Marketing', 'sendgrid.com'],
  ['constant-contact', 'Constant Contact', 'Marketing', 'constantcontact.com'],
  ['convertkit', 'ConvertKit', 'Marketing', 'convertkit.com'],
  ['braze', 'Braze', 'Marketing', 'braze.com'],
  ['hootsuite', 'Hootsuite', 'Marketing', 'hootsuite.com'],

  // Analytics
  ['google-analytics', 'Google Analytics', 'Analytics', 'analytics.google.com'],
  ['mixpanel', 'Mixpanel', 'Analytics', 'mixpanel.com'],
  ['amplitude', 'Amplitude', 'Analytics', 'amplitude.com'],
  ['segment', 'Segment', 'Analytics', 'segment.com'],
  ['hotjar', 'Hotjar', 'Analytics', 'hotjar.com'],
  ['tableau', 'Tableau', 'Analytics', 'tableau.com'],
  ['looker', 'Looker', 'Analytics', 'looker.com'],
  ['powerbi', 'Power BI', 'Analytics', 'powerbi.microsoft.com'],
  ['snowflake', 'Snowflake', 'Analytics', 'snowflake.com'],
  ['shopify', 'Shopify', 'Analytics', 'shopify.com'],
  ['wordpress', 'WordPress', 'Analytics', 'wordpress.com'],
  ['etsy', 'Etsy', 'Analytics', 'etsy.com'],
];

export const APPS: ToolkitApp[] = RAW_APPS.map(([slug, name, category, domain]) => ({
  slug,
  name,
  category,
  logo: `https://logo.clearbit.com/${domain}`,
}));

export const CATEGORIES: string[] = [...new Set(APPS.map((a) => a.category))].sort();

// Hash-based color swatch per app — deterministic, no per-brand color
// hardcoding required (and no risk of getting a brand color wrong). Used
// both as the fallback-avatar background (ConnectionsPanel.tsx) and as the
// "color" filter dimension.
export const COLOR_SWATCHES: string[] = [
  '#F87171', // red
  '#FB923C', // orange
  '#FBBF24', // amber
  '#34D399', // emerald
  '#22D3EE', // cyan
  '#60A5FA', // blue
  '#818CF8', // indigo
  '#A78BFA', // violet
  '#F472B6', // pink
  '#94A3B8', // slate
];

export function appColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return COLOR_SWATCHES[hash % COLOR_SWATCHES.length];
}
