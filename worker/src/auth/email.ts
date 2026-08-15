import type { Env } from '../env';

async function send(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email stub] to=${to} subject=${subject}`); // dev/test path
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Understudy <auth@understudy.app>', to, subject, html }),
  });
  if (!res.ok) console.error(`[email] resend failed ${res.status}`);
}

export function sendVerifyEmail(env: Env, to: string, link: string): Promise<void> {
  return send(env, to, 'Verify your Understudy email', `<p>Confirm your email:</p><p><a href="${link}">${link}</a></p>`);
}
export function sendResetEmail(env: Env, to: string, link: string): Promise<void> {
  return send(env, to, 'Reset your Understudy password', `<p>Reset your password:</p><p><a href="${link}">${link}</a></p>`);
}
