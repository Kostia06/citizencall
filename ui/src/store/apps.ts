// Static catalog of 100+ popular apps for the Connections grid — guarantees
// a fully demoable "100+ app" connect experience with zero backend (MOCK
// mode, or a live Worker that hasn't implemented GET /api/toolkits yet).
//
// Icons resolve via Simple Icons' public CDN
// (`cdn.simpleicons.org/<simpleicons-slug>`), which serves brand-colored SVG
// marks with no auth/token and near-100% uptime. Each app also carries a
// Clearbit `logo.clearbit.com/<domain>` URL as a secondary fallback for the
// handful of brands not in the Simple Icons catalog. `AppTile`
// (ConnectionsPanel.tsx) tries Simple Icons first, then Clearbit, then a
// neutral initials avatar if both fail — never a colored swatch.
export interface ToolkitApp {
  slug: string;
  name: string;
  category: string;
  /** Primary icon — Simple Icons CDN (brand-colored SVG). */
  icon: string;
  /** Secondary fallback — Clearbit logo CDN, keyed off the real domain. */
  logo: string;
}

// [slug, name, category, domain, simpleIconsSlug]
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
  ['heroku', 'Heroku', 'Dev Tools', 'heroku.com', 'heroku'],
  ['digitalocean', 'DigitalOcean', 'Dev Tools', 'digitalocean.com', 'digitalocean'],
  ['cloudflare', 'Cloudflare', 'Dev Tools', 'cloudflare.com', 'cloudflare'],
  ['terraform', 'Terraform', 'Dev Tools', 'terraform.io', 'terraform'],
  ['supabase', 'Supabase', 'Dev Tools', 'supabase.com', 'supabase'],
  ['railway', 'Railway', 'Dev Tools', 'railway.app', 'railway'],

  // Communication
  ['slack', 'Slack', 'Communication', 'slack.com', 'slack'],
  ['discord', 'Discord', 'Communication', 'discord.com', 'discord'],
  ['microsoft-teams', 'Microsoft Teams', 'Communication', 'microsoft.com', 'microsoftteams'],
  ['zoom', 'Zoom', 'Communication', 'zoom.us', 'zoom'],
  ['google-meet', 'Google Meet', 'Communication', 'meet.google.com', 'googlemeet'],
  ['telegram', 'Telegram', 'Communication', 'telegram.org', 'telegram'],
  ['whatsapp', 'WhatsApp', 'Communication', 'whatsapp.com', 'whatsapp'],
  ['twilio', 'Twilio', 'Communication', 'twilio.com', 'twilio'],
  ['intercom', 'Intercom', 'Communication', 'intercom.com', 'intercom'],
  ['zendesk', 'Zendesk', 'Communication', 'zendesk.com', 'zendesk'],
  ['front', 'Front', 'Communication', 'front.com', 'front'],
  ['loom', 'Loom', 'Communication', 'loom.com', 'loom'],
  ['calendly', 'Calendly', 'Communication', 'calendly.com', 'calendly'],
  ['ringcentral', 'RingCentral', 'Communication', 'ringcentral.com', 'ringcentral'],
  ['webex', 'Webex', 'Communication', 'webex.com', 'webex'],

  // Productivity
  ['notion', 'Notion', 'Productivity', 'notion.so', 'notion'],
  ['trello', 'Trello', 'Productivity', 'trello.com', 'trello'],
  ['asana', 'Asana', 'Productivity', 'asana.com', 'asana'],
  ['monday', 'monday.com', 'Productivity', 'monday.com', 'mondaydotcom'],
  ['clickup', 'ClickUp', 'Productivity', 'clickup.com', 'clickup'],
  ['todoist', 'Todoist', 'Productivity', 'todoist.com', 'todoist'],
  ['evernote', 'Evernote', 'Productivity', 'evernote.com', 'evernote'],
  ['airtable', 'Airtable', 'Productivity', 'airtable.com', 'airtable'],
  ['coda', 'Coda', 'Productivity', 'coda.io', 'coda'],
  ['miro', 'Miro', 'Productivity', 'miro.com', 'miro'],
  ['basecamp', 'Basecamp', 'Productivity', 'basecamp.com', 'basecamp'],
  ['wrike', 'Wrike', 'Productivity', 'wrike.com', 'wrike'],
  ['smartsheet', 'Smartsheet', 'Productivity', 'smartsheet.com', 'smartsheet'],
  ['google-calendar', 'Google Calendar', 'Productivity', 'calendar.google.com', 'googlecalendar'],
  ['google-docs', 'Google Docs', 'Productivity', 'docs.google.com', 'googledocs'],
  ['gmail', 'Gmail', 'Productivity', 'gmail.com', 'gmail'],

  // CRM / Sales
  ['salesforce', 'Salesforce', 'CRM', 'salesforce.com', 'salesforce'],
  ['hubspot', 'HubSpot', 'CRM', 'hubspot.com', 'hubspot'],
  ['pipedrive', 'Pipedrive', 'CRM', 'pipedrive.com', 'pipedrive'],
  ['zoho-crm', 'Zoho CRM', 'CRM', 'zoho.com', 'zoho'],
  ['freshsales', 'Freshsales', 'CRM', 'freshworks.com', 'freshworks'],
  ['close', 'Close', 'CRM', 'close.com', 'close'],
  ['copper', 'Copper', 'CRM', 'copper.com', 'copper'],
  ['insightly', 'Insightly', 'CRM', 'insightly.com', 'insightly'],
  ['nutshell', 'Nutshell', 'CRM', 'nutshell.com', 'nutshell'],
  ['activecampaign', 'ActiveCampaign', 'CRM', 'activecampaign.com', 'activecampaign'],

  // Storage
  ['google-drive', 'Google Drive', 'Storage', 'drive.google.com', 'googledrive'],
  ['dropbox', 'Dropbox', 'Storage', 'dropbox.com', 'dropbox'],
  ['box', 'Box', 'Storage', 'box.com', 'box'],
  ['onedrive', 'OneDrive', 'Storage', 'onedrive.live.com', 'microsoftonedrive'],
  ['icloud', 'iCloud', 'Storage', 'icloud.com', 'icloud'],
  ['amazon-s3', 'Amazon S3', 'Storage', 'aws.amazon.com', 'amazons3'],
  ['backblaze', 'Backblaze', 'Storage', 'backblaze.com', 'backblaze'],
  ['pcloud', 'pCloud', 'Storage', 'pcloud.com', 'pcloud'],
  ['mega', 'MEGA', 'Storage', 'mega.io', 'mega'],
  ['egnyte', 'Egnyte', 'Storage', 'egnyte.com', 'egnyte'],

  // Social
  ['twitter', 'X (Twitter)', 'Social', 'x.com', 'x'],
  ['facebook', 'Facebook', 'Social', 'facebook.com', 'facebook'],
  ['instagram', 'Instagram', 'Social', 'instagram.com', 'instagram'],
  ['linkedin', 'LinkedIn', 'Social', 'linkedin.com', 'linkedin'],
  ['youtube', 'YouTube', 'Social', 'youtube.com', 'youtube'],
  ['tiktok', 'TikTok', 'Social', 'tiktok.com', 'tiktok'],
  ['pinterest', 'Pinterest', 'Social', 'pinterest.com', 'pinterest'],
  ['reddit', 'Reddit', 'Social', 'reddit.com', 'reddit'],
  ['snapchat', 'Snapchat', 'Social', 'snapchat.com', 'snapchat'],
  ['threads', 'Threads', 'Social', 'threads.net', 'threads'],

  // Design
  ['figma', 'Figma', 'Design', 'figma.com', 'figma'],
  ['adobe-xd', 'Adobe XD', 'Design', 'adobe.com', 'adobexd'],
  ['sketch', 'Sketch', 'Design', 'sketch.com', 'sketch'],
  ['canva', 'Canva', 'Design', 'canva.com', 'canva'],
  ['invision', 'InVision', 'Design', 'invisionapp.com', 'invision'],
  ['framer', 'Framer', 'Design', 'framer.com', 'framer'],
  ['zeplin', 'Zeplin', 'Design', 'zeplin.io', 'zeplin'],
  ['photoshop', 'Photoshop', 'Design', 'adobe.com', 'adobephotoshop'],
  ['illustrator', 'Illustrator', 'Design', 'adobe.com', 'adobeillustrator'],
  ['webflow', 'Webflow', 'Design', 'webflow.com', 'webflow'],

  // Finance
  ['stripe', 'Stripe', 'Finance', 'stripe.com', 'stripe'],
  ['paypal', 'PayPal', 'Finance', 'paypal.com', 'paypal'],
  ['square', 'Square', 'Finance', 'squareup.com', 'square'],
  ['quickbooks', 'QuickBooks', 'Finance', 'quickbooks.intuit.com', 'quickbooks'],
  ['xero', 'Xero', 'Finance', 'xero.com', 'xero'],
  ['freshbooks', 'FreshBooks', 'Finance', 'freshbooks.com', 'freshbooks'],
  ['wave', 'Wave', 'Finance', 'waveapps.com', 'wave'],
  ['plaid', 'Plaid', 'Finance', 'plaid.com', 'plaid'],
  ['brex', 'Brex', 'Finance', 'brex.com', 'brex'],
  ['ramp', 'Ramp', 'Finance', 'ramp.com', 'ramp'],

  // AI
  ['openai', 'OpenAI', 'AI', 'openai.com', 'openai'],
  ['anthropic', 'Anthropic', 'AI', 'anthropic.com', 'anthropic'],
  ['huggingface', 'Hugging Face', 'AI', 'huggingface.co', 'huggingface'],
  ['midjourney', 'Midjourney', 'AI', 'midjourney.com', 'midjourney'],
  ['replicate', 'Replicate', 'AI', 'replicate.com', 'replicate'],
  ['cohere', 'Cohere', 'AI', 'cohere.com', 'cohere'],
  ['stability-ai', 'Stability AI', 'AI', 'stability.ai', 'stabilityai'],
  ['perplexity', 'Perplexity', 'AI', 'perplexity.ai', 'perplexity'],
  ['elevenlabs', 'ElevenLabs', 'AI', 'elevenlabs.io', 'elevenlabs'],
  ['runwayml', 'Runway', 'AI', 'runwayml.com', 'runway'],

  // Marketing
  ['mailchimp', 'Mailchimp', 'Marketing', 'mailchimp.com', 'mailchimp'],
  ['google-ads', 'Google Ads', 'Marketing', 'ads.google.com', 'googleads'],
  ['facebook-ads', 'Meta Ads', 'Marketing', 'business.facebook.com', 'meta'],
  ['marketo', 'Marketo', 'Marketing', 'marketo.com', 'marketo'],
  ['klaviyo', 'Klaviyo', 'Marketing', 'klaviyo.com', 'klaviyo'],
  ['sendgrid', 'SendGrid', 'Marketing', 'sendgrid.com', 'twiliosendgrid'],
  ['constant-contact', 'Constant Contact', 'Marketing', 'constantcontact.com', 'constantcontact'],
  ['convertkit', 'ConvertKit', 'Marketing', 'convertkit.com', 'convertkit'],
  ['braze', 'Braze', 'Marketing', 'braze.com', 'braze'],
  ['hootsuite', 'Hootsuite', 'Marketing', 'hootsuite.com', 'hootsuite'],

  // Analytics
  ['google-analytics', 'Google Analytics', 'Analytics', 'analytics.google.com', 'googleanalytics'],
  ['mixpanel', 'Mixpanel', 'Analytics', 'mixpanel.com', 'mixpanel'],
  ['amplitude', 'Amplitude', 'Analytics', 'amplitude.com', 'amplitude'],
  ['segment', 'Segment', 'Analytics', 'segment.com', 'segment'],
  ['hotjar', 'Hotjar', 'Analytics', 'hotjar.com', 'hotjar'],
  ['tableau', 'Tableau', 'Analytics', 'tableau.com', 'tableau'],
  ['looker', 'Looker', 'Analytics', 'looker.com', 'looker'],
  ['powerbi', 'Power BI', 'Analytics', 'powerbi.microsoft.com', 'powerbi'],
  ['snowflake', 'Snowflake', 'Analytics', 'snowflake.com', 'snowflake'],
  ['shopify', 'Shopify', 'Analytics', 'shopify.com', 'shopify'],
  ['wordpress', 'WordPress', 'Analytics', 'wordpress.com', 'wordpress'],
  ['etsy', 'Etsy', 'Analytics', 'etsy.com', 'etsy'],
];

export const APPS: ToolkitApp[] = RAW_APPS.map(([slug, name, category, domain, simpleIcons]) => ({
  slug,
  name,
  category,
  icon: `https://cdn.simpleicons.org/${simpleIcons}`,
  logo: `https://logo.clearbit.com/${domain}`,
}));

export const CATEGORIES: string[] = [...new Set(APPS.map((a) => a.category))].sort();
