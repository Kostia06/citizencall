# Understudy Worker

## Auth

Set secrets before deploying:

```bash
wrangler secret put AUTH_JWT_SECRET   # 32+ random bytes
wrangler secret put RESEND_API_KEY    # from resend.com
```

Vars in `wrangler.jsonc`: `APP_URL` (for email links). Optional
`DEV_AUTH_BYPASS=1` for local dev only (send `X-Dev-User: <id>`).

Apply the auth schema to D1:

```bash
wrangler d1 execute understudy --file=schema.auth.sql
```
