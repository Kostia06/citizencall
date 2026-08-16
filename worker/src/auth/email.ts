import type { Env } from '../env';

/** Resolves false when the email did NOT deliver (no key = stub, upstream
 * rejection, unverified domain…) — 2FA fails OPEN on that signal: the code
 * surfaces in the login response instead of locking the user out (found
 * live: production with a key but an unverified sender domain could not
 * deliver codes to anyone, making login impossible). */
async function send(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email stub] to=${to} subject=${subject}`); // dev/test path
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      // Sender is configurable: while the citizencall.dev domain is still
      // verifying, Resend ACCEPTS sends from it (202, delivered=true) and
      // drops them async — which silently defeated the devCode fail-open
      // and locked production login (audit FAIL #1/#2). onboarding@resend.dev
      // rejects non-owner recipients SYNCHRONOUSLY, so the fail-open fires.
      // Once the domain verifies: `wrangler secret put RESEND_FROM` with
      // "CitizenCall <auth@citizencall.dev>" — zero code change.
      body: JSON.stringify({ from: env.RESEND_FROM ?? 'CitizenCall <onboarding@resend.dev>', to, subject, html }),
    });
    if (!res.ok) console.error(`[email] resend failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.error('[email] resend unreachable', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Branded template. Email clients ignore external CSS and most modern layout,
// so this is deliberately old-school: one centered table-free card, inline
// styles only, light surface (dark-mode emails render unpredictably across
// clients), the accent used once. `content` is trusted internal HTML —
// user-supplied values never flow in here (codes/links are server-minted).

const ACCENT = '#6d7cff';

function shell(preheader: string, content: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
    <div style="max-width:440px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;padding-bottom:18px;">
        <span style="font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#14151a;">Citizen<span style="color:${ACCENT};">Call</span></span>
      </div>
      <div style="background:#ffffff;border:1px solid #e6e8f2;border-radius:16px;padding:32px 28px;">
        ${content}
      </div>
      <p style="text-align:center;color:#9aa0b5;font-size:11.5px;line-height:1.6;padding-top:18px;margin:0;">
        One command bar for 1,200+ apps — routed to cheap specialist models, verified.<br/>
        <a href="https://citizencall.dev" style="color:#9aa0b5;">citizencall.dev</a>
      </p>
    </div>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 26px;border-radius:999px;">${label}</a>`;
}

const H = 'margin:0 0 10px;font-size:19px;font-weight:700;color:#14151a;letter-spacing:-0.01em;';
const P = 'margin:0 0 18px;font-size:13.5px;line-height:1.65;color:#5a6072;';
const FINE = 'margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#9aa0b5;';

export function sendVerifyEmail(env: Env, to: string, link: string): Promise<boolean> {
  const html = shell(
    'Confirm your email to finish setting up CitizenCall.',
    `<h1 style="${H}">Confirm your email</h1>
     <p style="${P}">One click and your CitizenCall account is ready.</p>
     <div style="text-align:center;padding:6px 0 4px;">${button(link, 'Verify email')}</div>
     <p style="${FINE}">Button not working? Paste this into your browser:<br/><a href="${link}" style="color:${ACCENT};word-break:break-all;">${link}</a></p>`
  );
  return send(env, to, 'Verify your CitizenCall email', html);
}

export function sendResetEmail(env: Env, to: string, link: string): Promise<boolean> {
  const html = shell(
    'Reset your CitizenCall password.',
    `<h1 style="${H}">Reset your password</h1>
     <p style="${P}">Someone (hopefully you) asked to reset the password for this account. If it wasn't you, ignore this email — nothing changes.</p>
     <div style="text-align:center;padding:6px 0 4px;">${button(link, 'Choose a new password')}</div>
     <p style="${FINE}">Button not working? Paste this into your browser:<br/><a href="${link}" style="color:${ACCENT};word-break:break-all;">${link}</a></p>`
  );
  return send(env, to, 'Reset your CitizenCall password', html);
}

export function sendTwofaCodeEmail(env: Env, to: string, code: string): Promise<boolean> {
  const html = shell(
    `Your sign-in code is ${code}.`,
    `<h1 style="${H}">Your sign-in code</h1>
     <p style="${P}">Enter this code to finish signing in:</p>
     <div style="text-align:center;padding:2px 0 6px;">
       <span style="display:inline-block;background:#f4f5fb;border:1px solid #e6e8f2;border-radius:12px;padding:14px 22px;font-size:30px;font-weight:700;letter-spacing:10px;color:#14151a;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;">${code}</span>
     </div>
     <p style="${FINE}">The code expires in 10 minutes. If you didn't try to sign in, you can safely ignore this email.</p>`
  );
  return send(env, to, 'Your CitizenCall sign-in code', html);
}

/** Sent once, right after the account's first successful verification —
 * best-effort (a failed welcome must never affect the auth flow). */
export function sendWelcomeEmail(env: Env, to: string): Promise<boolean> {
  const html = shell(
    'Welcome to CitizenCall — here is what to try first.',
    `<h1 style="${H}">Welcome to CitizenCall 👋</h1>
     <p style="${P}">You have one command bar that routes each request to a cheap specialist model, verifies the answer, and escalates only when the check fails. A few things to try:</p>
     <p style="${P}">
       <strong style="color:#14151a;">Connect your apps</strong> — GitHub, Gmail, Discord and 1,200+ more, then "list my open pull requests".<br/><br/>
       <strong style="color:#14151a;">Teach it about you</strong> — "my name is Jeff — remember that". It shows up on your Memory page.<br/><br/>
       <strong style="color:#14151a;">Automate</strong> — "create a routine that checks my email every morning", then bind it to a bar button.<br/><br/>
       <strong style="color:#14151a;">Install it</strong> — CitizenCall installs as an app straight from the browser: Settings → Personal → Install.
     </p>
     <div style="text-align:center;padding:6px 0 4px;">${button('https://citizencall.dev', 'Open CitizenCall')}</div>`
  );
  return send(env, to, 'Welcome to CitizenCall', html);
}
