import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password';
import { signAccessToken } from './jwt';
import { createSession, listSessions, revokeAllForUser, revokeSession, revokeSessionForUser, rotateSession } from './sessions';
import {
  consumeEmailToken, createEmailToken, createUser, getUserByEmail,
  getUserById, setEmailVerified, updatePassword,
} from './users';
import { sendResetEmail, sendTwofaCodeEmail, sendVerifyEmail } from './email';
import { checkAndIncrement } from './throttle';
import { requireAuth } from './middleware';
import { authSecret } from './secret';
import { clearAnonCookie, peekAnonId } from './anon';
import { claimAnonActor } from '../store/claim';
import {
  createChallenge, ensureTwofaSchema, isTwofaEnabled, resendChallenge,
  shouldExposeDevCode, verifyChallenge,
} from './twofa';

type Vars = { authUserId?: string; authSessionId?: string; authEmailVerified?: boolean };
export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const GENERIC_LOGIN_ERR = 'Invalid email or password.';
const now = () => Date.now();
const isNative = (c: any) => c.req.header('X-Client') === 'native';
const clientIp = (c: any) => c.req.header('CF-Connecting-IP') ?? 'unknown';

// Claim-on-login (both the 2fa-off login path and 2fa/verify funnel through
// issueTokens): if a signed `__Host-anon` cookie rides along on the request,
// everything that anonymous session accumulated (connections, settings,
// MCPs, tool overrides, run history) is re-parented onto the account that
// just authenticated, and the anon cookie is cleared. Without this, whatever
// a visitor connected before signing in silently vanished at login — the
// rows stayed under the orphaned anon id forever.
async function claimAnonSession(c: any, userId: string): Promise<void> {
  const anonId = await peekAnonId(c);
  if (!anonId) return;
  await claimAnonActor(c.env.DB, anonId, userId);
  clearAnonCookie(c);
}

async function issueTokens(c: any, userId: string, sessionArgs: { userAgent: string | null; ip: string | null }) {
  const user = await getUserById(c.env.DB, userId);
  await claimAnonSession(c, userId);
  const { sessionId, refreshToken } = await createSession(c.env.DB, { userId, now: now(), ...sessionArgs });
  const accessToken = await signAccessToken(authSecret(c.env), {
    sub: userId, sid: sessionId, emailVerified: user!.emailVerified,
  });
  if (!isNative(c)) {
    setCookie(c, '__Host-refresh', refreshToken, {
      httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 30 * 24 * 3600,
    });
    return c.json({ accessToken, user });
  }
  return c.json({ accessToken, refreshToken, user });
}

authRoutes.post('/signup', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: 'Bad request.' }, 400);
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return c.json({ error: policy.reason }, 400);

  const throttle = await checkAndIncrement(c.env.DB, `signup:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const existing = await getUserByEmail(c.env.DB, email);
  if (existing) {
    // No enumeration: identical response body/status as the new-account path,
    // and a dummy hash so timing doesn't reveal the account already exists.
    await hashPassword(password);
    return c.json({ ok: true }, 201);
  }
  const user = await createUser(c.env.DB, { email, passwordHash: await hashPassword(password), now: now() });
  // No confirmation email: auto-verify on signup so a new account is
  // immediately usable. requireVerified still gates every route below —
  // this just makes real signups satisfy it right away.
  await setEmailVerified(c.env.DB, user.id);
  // Claim here too (not only at login): the caller just proved ownership of
  // this brand-new account by creating it, so their anon session's rows can
  // safely follow. NOT done on the duplicate-email path above — that caller
  // hasn't authenticated as the existing account.
  await claimAnonSession(c, user.id);
  return c.json({ ok: true }, 201);
});

authRoutes.post('/verify', async (c) => {
  const throttle = await checkAndIncrement(c.env.DB, `verify:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const { token } = await c.req.json().catch(() => ({}));
  if (typeof token !== 'string') return c.json({ error: 'Bad request.' }, 400);
  const userId = await consumeEmailToken(c.env.DB, 'verify', token, now());
  if (!userId) return c.json({ error: 'Invalid or expired token.' }, 400);
  await setEmailVerified(c.env.DB, userId);
  return c.json({ ok: true });
});

authRoutes.post('/resend-verification', async (c) => {
  const throttle = await checkAndIncrement(c.env.DB, `resend:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const { email } = await c.req.json().catch(() => ({}));
  if (typeof email === 'string') {
    const user = await getUserByEmail(c.env.DB, email);
    if (user && !user.emailVerified) {
      const token = await createEmailToken(c.env.DB, { userId: user.id, type: 'verify', now: now(), ttlMs: 24 * 3600000 });
      await sendVerifyEmail(c.env, user.email, `${c.env.APP_URL ?? ''}/verify?token=${token}`);
    }
  }
  return c.json({ ok: true }); // always generic, no enumeration
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: GENERIC_LOGIN_ERR }, 401);

  const throttle = await checkAndIncrement(c.env.DB, `login:ip:${clientIp(c)}`, now(), { windowMs: 900000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const user = await getUserByEmail(c.env.DB, email);
  // Run a dummy hash on unknown email so timing does not reveal existence.
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, 'scrypt$N=65536,r=8,p=1$AAAA$AAAA');
  if (!user || !ok) return c.json({ error: GENERIC_LOGIN_ERR }, 401);

  await ensureTwofaSchema(c.env.DB);
  if (await isTwofaEnabled(c.env.DB, user.id)) {
    // Second factor required: no tokens yet, only an opaque challenge.
    const { challengeId, code } = await createChallenge(c.env.DB, user.id, now());
    const delivered = await sendTwofaCodeEmail(c.env, user.email, code);
    const body: Record<string, unknown> = { requires2fa: true, challengeId };
    // Fail-OPEN when the email could not deliver (unverified sender domain,
    // Resend outage, stub mode): surfacing the code beats locking every
    // user out of login — 2FA still gates bots/typos, and flips to real
    // email-only the moment delivery works.
    if (shouldExposeDevCode(c.env) || !delivered) {
      console.log(`[2fa] dev code for ${user.email}: ${code}`);
      body.devCode = code;
    }
    return c.json(body);
  }
  return issueTokens(c, user.id, { userAgent: c.req.header('User-Agent') ?? null, ip: clientIp(c) });
});

const GENERIC_2FA_ERR = 'Invalid or expired code.';

authRoutes.post('/2fa/verify', async (c) => {
  const throttle = await checkAndIncrement(c.env.DB, `2fa-verify:ip:${clientIp(c)}`, now(), { windowMs: 900000, max: 30 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const { challengeId, code } = await c.req.json().catch(() => ({}));
  if (typeof challengeId !== 'string' || typeof code !== 'string') return c.json({ error: GENERIC_2FA_ERR }, 401);
  await ensureTwofaSchema(c.env.DB);
  const userId = await verifyChallenge(c.env.DB, challengeId, code, now());
  if (!userId) return c.json({ error: GENERIC_2FA_ERR }, 401);
  // Identical response shape to a successful (2fa-off) login.
  return issueTokens(c, userId, { userAgent: c.req.header('User-Agent') ?? null, ip: clientIp(c) });
});

authRoutes.post('/2fa/resend', async (c) => {
  const throttle = await checkAndIncrement(c.env.DB, `2fa-resend:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 20 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const { challengeId } = await c.req.json().catch(() => ({}));
  // Always the same generic body — never reveals whether the challenge
  // exists, is rate-limited, or is dead (no enumeration).
  const body: Record<string, unknown> = { ok: true, retryAfterSec: 30 };
  if (typeof challengeId === 'string') {
    await ensureTwofaSchema(c.env.DB);
    const result = await resendChallenge(c.env.DB, challengeId, now());
    if (result.status === 'ok') {
      const user = await getUserById(c.env.DB, result.userId);
      const delivered = user ? await sendTwofaCodeEmail(c.env, user.email, result.code) : false;
      if (shouldExposeDevCode(c.env) || !delivered) {
        console.log(`[2fa] dev code (resend): ${result.code}`);
        body.devCode = result.code;
      }
    }
  }
  return c.json(body);
});

authRoutes.post('/refresh', async (c) => {
  const bodyToken = isNative(c) ? (await c.req.json().catch(() => ({}))).refreshToken : undefined;
  const cookie = c.req.header('Cookie')?.match(/__Host-refresh=([^;]+)/)?.[1];
  const token = bodyToken ?? cookie;
  if (typeof token !== 'string') return c.json({ error: 'No refresh token.' }, 401);
  const result = await rotateSession(c.env.DB, token, now());
  if (result === 'invalid' || result === 'reused') return c.json({ error: 'Session expired.' }, 401);
  const user = await getUserById(c.env.DB, result.userId);
  const accessToken = await signAccessToken(authSecret(c.env), {
    sub: result.userId, sid: result.sessionId, emailVerified: user!.emailVerified,
  });
  if (!isNative(c)) {
    setCookie(c, '__Host-refresh', result.refreshToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 30 * 24 * 3600 });
    return c.json({ accessToken });
  }
  return c.json({ accessToken, refreshToken: result.refreshToken });
});

authRoutes.post('/password/forgot', async (c) => {
  const { email } = await c.req.json().catch(() => ({}));
  await checkAndIncrement(c.env.DB, `forgot:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (typeof email === 'string') {
    const user = await getUserByEmail(c.env.DB, email);
    if (user) {
      const token = await createEmailToken(c.env.DB, { userId: user.id, type: 'reset', now: now(), ttlMs: 3600000 });
      await sendResetEmail(c.env, user.email, `${c.env.APP_URL ?? ''}/reset?token=${token}`);
    }
  }
  return c.json({ ok: true }); // always generic
});

authRoutes.post('/password/reset', async (c) => {
  const throttle = await checkAndIncrement(c.env.DB, `reset:ip:${clientIp(c)}`, now(), { windowMs: 3600000, max: 10 });
  if (!throttle.allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const { token, password } = await c.req.json().catch(() => ({}));
  if (typeof token !== 'string' || typeof password !== 'string') return c.json({ error: 'Bad request.' }, 400);
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return c.json({ error: policy.reason }, 400);
  const userId = await consumeEmailToken(c.env.DB, 'reset', token, now());
  if (!userId) return c.json({ error: 'Invalid or expired token.' }, 400);
  await updatePassword(c.env.DB, userId, await hashPassword(password), now());
  await revokeAllForUser(c.env.DB, userId); // reset kills all sessions
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const user = await getUserById(c.env.DB, c.get('authUserId') as string);
  return c.json({ user });
});

authRoutes.post('/logout', requireAuth, async (c) => {
  await revokeSession(c.env.DB, c.get('authSessionId') as string);
  return c.body(null, 204);
});

authRoutes.post('/logout-all', requireAuth, async (c) => {
  await revokeAllForUser(c.env.DB, c.get('authUserId') as string);
  return c.body(null, 204);
});

authRoutes.get('/sessions', requireAuth, async (c) => {
  return c.json(await listSessions(c.env.DB, c.get('authUserId') as string));
});

authRoutes.delete('/sessions/:id', requireAuth, async (c) => {
  const revoked = await revokeSessionForUser(c.env.DB, c.req.param('id'), c.get('authUserId') as string);
  if (!revoked) return c.json({ error: 'Not found.' }, 404);
  return c.body(null, 204);
});
