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
      // "Understudy <auth@citizencall.dev>" — zero code change.
      body: JSON.stringify({ from: env.RESEND_FROM ?? 'Understudy <onboarding@resend.dev>', to, subject, html }),
    });
    if (!res.ok) console.error(`[email] resend failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.error('[email] resend unreachable', err);
    return false;
  }
}

export function sendVerifyEmail(env: Env, to: string, link: string): Promise<boolean> {
  return send(env, to, 'Verify your Understudy email', `<p>Confirm your email:</p><p><a href="${link}">${link}</a></p>`);
}
export function sendResetEmail(env: Env, to: string, link: string): Promise<boolean> {
  return send(env, to, 'Reset your Understudy password', `<p>Reset your password:</p><p><a href="${link}">${link}</a></p>`);
}
export function sendTwofaCodeEmail(env: Env, to: string, code: string): Promise<boolean> {
  return send(
    env, to, 'Your Understudy sign-in code',
    `<p>Your sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't try to sign in, you can ignore this email.</p>`
  );
}
