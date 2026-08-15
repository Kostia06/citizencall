// Worker environment bindings. Not part of the shared contract (types.ts) —
// this is Cloudflare-runtime plumbing, kept separate on purpose.

export interface Env {
  DB: D1Database;
  RUN: DurableObjectNamespace;
  ASSETS?: Fetcher;
  DEMO_USERS: string;
  FEATHERLESS_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  RESEND_API_KEY?: string;
  AUTH_JWT_SECRET?: string;
  APP_URL?: string;
  DEV_AUTH_BYPASS?: string;
}
