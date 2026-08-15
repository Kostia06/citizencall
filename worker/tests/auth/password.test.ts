import { expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../../src/auth/password';

it('hashes and verifies a correct password', async () => {
  const enc = await hashPassword('correct horse battery staple');
  expect(enc.startsWith('scrypt$')).toBe(true);
  expect(await verifyPassword('correct horse battery staple', enc)).toBe(true);
});

it('rejects a wrong password', async () => {
  const enc = await hashPassword('correct horse battery staple');
  expect(await verifyPassword('wrong password entirely', enc)).toBe(false);
});

it('rejects short and common passwords', () => {
  expect(checkPasswordPolicy('short').ok).toBe(false);
  expect(checkPasswordPolicy('password1234').ok).toBe(false); // in blocklist
  expect(checkPasswordPolicy('a-perfectly-fine-passphrase').ok).toBe(true);
});
