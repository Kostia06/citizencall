// Static catalog of 100+ popular apps for the Connections grid — guarantees
// a fully demoable "100+ app" connect experience with zero backend (MOCK
// mode, or a live Worker that hasn't implemented GET /api/toolkits yet).
//
// Icons resolve through a three-step chain, cheapest/crispest first:
//   1. Simple Icons CDN (`cdn.simpleicons.org/<slug>`) — brand-colored SVG,
//      no auth/token. Left empty for brands confirmed absent from the
//      current Simple Icons catalog (verified against the live npm package
//      data, not assumed — several well-known brands, e.g. Slack, Salesforce,
//      LinkedIn, OpenAI, Heroku, have been removed from Simple Icons over
//      time) so those tiles skip straight to step 2.
//   2. Clearbit logo (`logo.clearbit.com/<domain>`) — real favicon-grade
//      brand mark keyed off the real domain.
//   3. Google favicon service (`google.com/s2/favicons?domain=<domain>`) —
//      near-100% coverage for any live domain, guarantees no blank tile.
// `AppTile` (ConnectionsPanel.tsx) walks this candidate list on each
// `onError`, falling back to a neutral initials monogram only if all three
// image sources fail (offline demo, ad-blocker) — never a colored swatch.
export interface ToolkitApp {
  slug: string;
  name: string;
  category: string;
  /** Primary icon — Simple Icons CDN (brand-colored SVG). Empty string when
   * the brand isn't in the current Simple Icons catalog, so the tile skips
   * straight to the Clearbit fallback. */
  icon: string;
  /** Secondary fallback — Clearbit logo CDN, keyed off the real domain. */
  logo: string;
  /** Real domain for the brand — keys both the Clearbit logo above and the
   * guaranteed Google favicon fallback (tertiary, in AppTile). */
  domain: string;
}

// [slug, name, category, domain, simpleIconsSlug] — simpleIconsSlug is ''
// when the brand has no Simple Icons entry (confirmed via the live catalog).
type RawApp = [slug: string, name: string, category: string, domain: string, simpleIcons: string];

const RAW_APPS: RawApp[] = [
  // Dev Tools
  ['github', 'GitHub', 'Dev Tools', 'github.com', 'github'],
  ['gitlab', 'GitLab', 'Dev Tools', 'gitlab.com', 'gitlab'],
  ['bitbucket', 'Bitbucket', 'Dev Tools', 'bitbucket.org', 'bitbucket'],
  ['jira', 'Jira', 'Dev Tools', 'atlassian.com', 'jira'],
  ['confluence', 'Confluence', 'Dev Tools', 'atlassian.com', 'confluence'],
  ['circleci', 'CircleCI', 'Dev Tools', 'circleci.com', 'circleci'],
  ['jenkins', 'Jenkins', 'Dev Tools', 'jenkins.io', 'jenkins'],
  ['docker', 'Docker', 'Dev Tools', 'docker.com', 'docker'],
  ['vercel', 'Vercel', 'Dev Tools', 'vercel.com', 'vercel'],
  ['netlify', 'Netlify', 'Dev Tools', 'netlify.com', 'netlify'],
  ['npm', 'npm', 'Dev Tools', 'npmjs.com', 'npm'],
  ['pypi', 'PyPI', 'Dev Tools', 'pypi.org', 'pypi'],
  ['postman', 'Postman', 'Dev Tools', 'postman.com', 'postman'],
  ['sentry', 'Sentry', 'Dev Tools', 'sentry.io', 'sentry'],
  ['datadog', 'Datadog', 'Dev Tools', 'datadoghq.com', 'datadog'],
  ['pagerduty', 'PagerDuty', 'Dev Tools', 'pagerduty.com', 'pagerduty'],
  ['linear', 'Linear', 'Dev Tools', 'linear.app', 'linear'],
  ['heroku', 'Heroku', 'Dev Tools', 'heroku.com', ''],
  ['digitalocean', 'DigitalOcean', 'Dev Tools', 'digitalocean.com', 'digitalocean'],
  ['cloudflare', 'Cloudflare', 'Dev Tools', 'cloudflare.com', 'cloudflare'],
  ['terraform', 'Terraform', 'Dev Tools', 'terraform.io', 'terraform'],
  ['supabase', 'Supabase', 'Dev Tools', 'supabase.com', 'supabase'],
  ['railway', 'Railway', 'Dev Tools', 'railway.app', 'railway'],

  // Communication
  ['slack', 'Slack', 'Communication', 'slack.com', ''],
  ['discord', 'Discord', 'Communication', 'discord.com', 'discord'],
  ['microsoft-teams', 'Microsoft Teams', 'Communication', 'microsoft.com', ''],
  ['zoom', 'Zoom', 'Communication', 'zoom.us', 'zoom'],
  ['google-meet', 'Google Meet', 'Communication', 'meet.google.com', 'googlemeet'],
  ['telegram', 'Telegram', 'Communication', 'telegram.org', 'telegram'],
  ['whatsapp', 'WhatsApp', 'Communication', 'whatsapp.com', 'whatsapp'],
  ['twilio', 'Twilio', 'Communication', 'twilio.com', ''],
  ['intercom', 'Intercom', 'Communication', 'intercom.com', 'intercom'],
  ['zendesk', 'Zendesk', 'Communication', 'zendesk.com', 'zendesk'],
  ['front', 'Front', 'Communication', 'front.com', ''],
  ['loom', 'Loom', 'Communication', 'loom.com', 'loom'],
  ['calendly', 'Calendly', 'Communication', 'calendly.com', 'calendly'],
  ['ringcentral', 'RingCentral', 'Communication', 'ringcentral.com', ''],
  ['webex', 'Webex', 'Communication', 'webex.com', 'webex'],

  // Productivity
  ['notion', 'Notion', 'Productivity', 'notion.so', 'notion'],
  ['trello', 'Trello', 'Productivity', 'trello.com', 'trello'],
  ['asana', 'Asana', 'Productivity', 'asana.com', 'asana'],
  ['monday', 'monday.com', 'Productivity', 'monday.com', ''],
  ['clickup', 'ClickUp', 'Productivity', 'clickup.com', 'clickup'],
  ['todoist', 'Todoist', 'Productivity', 'todoist.com', 'todoist'],
  ['evernote', 'Evernote', 'Productivity', 'evernote.com', 'evernote'],
  ['airtable', 'Airtable', 'Productivity', 'airtable.com', 'airtable'],
  ['coda', 'Coda', 'Productivity', 'coda.io', 'coda'],
  ['miro', 'Miro', 'Productivity', 'miro.com', 'miro'],
  ['basecamp', 'Basecamp', 'Productivity', 'basecamp.com', 'basecamp'],
  ['wrike', 'Wrike', 'Productivity', 'wrike.com', ''],
  ['smartsheet', 'Smartsheet', 'Productivity', 'smartsheet.com', ''],
  ['google-calendar', 'Google Calendar', 'Productivity', 'calendar.google.com', 'googlecalendar'],
  ['google-docs', 'Google Docs', 'Productivity', 'docs.google.com', 'googledocs'],
  ['gmail', 'Gmail', 'Productivity', 'gmail.com', 'gmail'],

  // CRM / Sales
  ['salesforce', 'Salesforce', 'CRM', 'salesforce.com', ''],
  ['hubspot', 'HubSpot', 'CRM', 'hubspot.com', 'hubspot'],
  ['pipedrive', 'Pipedrive', 'CRM', 'pipedrive.com', ''],
  ['zoho-crm', 'Zoho CRM', 'CRM', 'zoho.com', 'zoho'],
  ['freshsales', 'Freshsales', 'CRM', 'freshworks.com', ''],
  ['close', 'Close', 'CRM', 'close.com', ''],
  ['copper', 'Copper', 'CRM', 'copper.com', ''],
  ['insightly', 'Insightly', 'CRM', 'insightly.com', ''],
  ['nutshell', 'Nutshell', 'CRM', 'nutshell.com', ''],
  ['activecampaign', 'ActiveCampaign', 'CRM', 'activecampaign.com', ''],

  // Storage
  ['google-drive', 'Google Drive', 'Storage', 'drive.google.com', 'googledrive'],
  ['dropbox', 'Dropbox', 'Storage', 'dropbox.com', 'dropbox'],
  ['box', 'Box', 'Storage', 'box.com', 'box'],
  ['onedrive', 'OneDrive', 'Storage', 'onedrive.live.com', ''],
  ['icloud', 'iCloud', 'Storage', 'icloud.com', 'icloud'],
  ['amazon-s3', 'Amazon S3', 'Storage', 'aws.amazon.com', ''],
  ['backblaze', 'Backblaze', 'Storage', 'backblaze.com', 'backblaze'],
  ['pcloud', 'pCloud', 'Storage', 'pcloud.com', ''],
  ['mega', 'MEGA', 'Storage', 'mega.io', 'mega'],
  ['egnyte', 'Egnyte', 'Storage', 'egnyte.com', 'egnyte'],

  // Social
  ['twitter', 'X (Twitter)', 'Social', 'x.com', 'x'],
  ['facebook', 'Facebook', 'Social', 'facebook.com', 'facebook'],
  ['instagram', 'Instagram', 'Social', 'instagram.com', 'instagram'],
  ['linkedin', 'LinkedIn', 'Social', 'linkedin.com', ''],
  ['youtube', 'YouTube', 'Social', 'youtube.com', 'youtube'],
  ['tiktok', 'TikTok', 'Social', 'tiktok.com', 'tiktok'],
  ['pinterest', 'Pinterest', 'Social', 'pinterest.com', 'pinterest'],
  ['reddit', 'Reddit', 'Social', 'reddit.com', 'reddit'],
  ['snapchat', 'Snapchat', 'Social', 'snapchat.com', 'snapchat'],
  ['threads', 'Threads', 'Social', 'threads.net', 'threads'],

  // Design
  ['figma', 'Figma', 'Design', 'figma.com', 'figma'],
  ['adobe-xd', 'Adobe XD', 'Design', 'adobe.com', ''],
  ['sketch', 'Sketch', 'Design', 'sketch.com', 'sketch'],
  ['canva', 'Canva', 'Design', 'canva.com', ''],
  ['invision', 'InVision', 'Design', 'invisionapp.com', ''],
  ['framer', 'Framer', 'Design', 'framer.com', 'framer'],
  ['zeplin', 'Zeplin', 'Design', 'zeplin.io', ''],
  ['photoshop', 'Photoshop', 'Design', 'adobe.com', ''],
  ['illustrator', 'Illustrator', 'Design', 'adobe.com', ''],
  ['webflow', 'Webflow', 'Design', 'webflow.com', 'webflow'],

  // Finance
  ['stripe', 'Stripe', 'Finance', 'stripe.com', 'stripe'],
  ['paypal', 'PayPal', 'Finance', 'paypal.com', 'paypal'],
  ['square', 'Square', 'Finance', 'squareup.com', 'square'],
  ['quickbooks', 'QuickBooks', 'Finance', 'quickbooks.intuit.com', 'quickbooks'],
  ['xero', 'Xero', 'Finance', 'xero.com', 'xero'],
  ['freshbooks', 'FreshBooks', 'Finance', 'freshbooks.com', ''],
  ['wave', 'Wave', 'Finance', 'waveapps.com', ''],
  ['plaid', 'Plaid', 'Finance', 'plaid.com', ''],
  ['brex', 'Brex', 'Finance', 'brex.com', 'brex'],
  ['ramp', 'Ramp', 'Finance', 'ramp.com', ''],

  // AI
  ['openai', 'OpenAI', 'AI', 'openai.com', ''],
  ['anthropic', 'Anthropic', 'AI', 'anthropic.com', 'anthropic'],
  ['huggingface', 'Hugging Face', 'AI', 'huggingface.co', 'huggingface'],
  ['midjourney', 'Midjourney', 'AI', 'midjourney.com', ''],
  ['replicate', 'Replicate', 'AI', 'replicate.com', 'replicate'],
  ['cohere', 'Cohere', 'AI', 'cohere.com', ''],
  ['stability-ai', 'Stability AI', 'AI', 'stability.ai', ''],
  ['perplexity', 'Perplexity', 'AI', 'perplexity.ai', 'perplexity'],
  ['elevenlabs', 'ElevenLabs', 'AI', 'elevenlabs.io', 'elevenlabs'],
  ['runwayml', 'Runway', 'AI', 'runwayml.com', ''],

  // Marketing
  ['mailchimp', 'Mailchimp', 'Marketing', 'mailchimp.com', 'mailchimp'],
  ['google-ads', 'Google Ads', 'Marketing', 'ads.google.com', 'googleads'],
  ['facebook-ads', 'Meta Ads', 'Marketing', 'business.facebook.com', 'meta'],
  ['marketo', 'Marketo', 'Marketing', 'marketo.com', ''],
  ['klaviyo', 'Klaviyo', 'Marketing', 'klaviyo.com', ''],
  ['sendgrid', 'SendGrid', 'Marketing', 'sendgrid.com', ''],
  ['constant-contact', 'Constant Contact', 'Marketing', 'constantcontact.com', ''],
  ['convertkit', 'ConvertKit', 'Marketing', 'convertkit.com', ''],
  ['braze', 'Braze', 'Marketing', 'braze.com', ''],
  ['hootsuite', 'Hootsuite', 'Marketing', 'hootsuite.com', 'hootsuite'],

  // Analytics
  ['google-analytics', 'Google Analytics', 'Analytics', 'analytics.google.com', 'googleanalytics'],
  ['mixpanel', 'Mixpanel', 'Analytics', 'mixpanel.com', 'mixpanel'],
  ['amplitude', 'Amplitude', 'Analytics', 'amplitude.com', ''],
  ['segment', 'Segment', 'Analytics', 'segment.com', ''],
  ['hotjar', 'Hotjar', 'Analytics', 'hotjar.com', 'hotjar'],
  ['tableau', 'Tableau', 'Analytics', 'tableau.com', ''],
  ['looker', 'Looker', 'Analytics', 'looker.com', 'looker'],
  ['powerbi', 'Power BI', 'Analytics', 'powerbi.microsoft.com', ''],
  ['snowflake', 'Snowflake', 'Analytics', 'snowflake.com', 'snowflake'],
  ['shopify', 'Shopify', 'Analytics', 'shopify.com', 'shopify'],
  ['wordpress', 'WordPress', 'Analytics', 'wordpress.com', 'wordpress'],
  ['etsy', 'Etsy', 'Analytics', 'etsy.com', 'etsy'],
];

export const APPS: ToolkitApp[] = RAW_APPS.map(([slug, name, category, domain, simpleIcons]) => ({
  slug,
  name,
  category,
  icon: simpleIcons ? `https://cdn.simpleicons.org/${simpleIcons}` : '',
  logo: `https://logo.clearbit.com/${domain}`,
  domain,
}));

export const CATEGORIES: string[] = [...new Set(APPS.map((a) => a.category))].sort();
