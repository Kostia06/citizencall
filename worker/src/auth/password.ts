import { scrypt } from '@noble/hashes/scrypt.js';
import { COMMON_PASSWORDS } from './common-passwords';

const PARAMS = { N: 65536, r: 8, p: 1, dkLen: 32 };
const MIN_LEN = 12;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = scrypt(new TextEncoder().encode(plain), salt, PARAMS);
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${b64url(salt)}$${b64url(key)}`;
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const m = parts[1]?.match(/N=(\d+),r=(\d+),p=(\d+)/);
  if (!m || !m[1] || !m[2] || !m[3]) return false;
  const params = { N: +m[1], r: +m[2], p: +m[3], dkLen: 32 };
  const salt = fromB64url(parts[2]!);
  const expected = fromB64url(parts[3]!);
  const actual = scrypt(new TextEncoder().encode(plain), salt, params);
  return constantTimeEqual(actual, expected);
}

export function checkPasswordPolicy(plain: string): { ok: true } | { ok: false; reason: string } {
  if (plain.length < MIN_LEN) return { ok: false, reason: `Password must be at least ${MIN_LEN} characters.` };
  if (plain.length > 200) return { ok: false, reason: 'Password too long.' };
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) return { ok: false, reason: 'That password is too common.' };
  return { ok: true };
}
