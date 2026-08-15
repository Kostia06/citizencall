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
export function sendTwofaCodeEmail(env: Env, to: string, code: string): Promise<void> {
  return send(
    env, to, 'Your Understudy sign-in code',
    `<p>Your sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't try to sign in, you can ignore this email.</p>`
  );
}
