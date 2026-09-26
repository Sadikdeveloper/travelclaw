import {
  hashPassword,
  hashPasswordLegacyScryptForTests,
  isLegacyScryptHash,
  verifyPassword,
} from '../src/auth/password';

describe('password hashing', () => {
  it('never stores the plaintext or a reversible blob, using Argon2id', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('round-trips the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash (and salt) for the same password twice', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('treats a missing, empty, or malformed hash as no match, never throwing', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', undefined)).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$oops$$')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$16384$zz$zz')).toBe(false);
    expect(await verifyPassword('anything', '$argon2id$garbage')).toBe(false);
  });

  it('still verifies a hash minted by the old scrypt scheme (backward compatibility)', async () => {
    const legacyHash = hashPasswordLegacyScryptForTests('an old-school password');
    expect(isLegacyScryptHash(legacyHash)).toBe(true);
    expect(await verifyPassword('an old-school password', legacyHash)).toBe(true);
    expect(await verifyPassword('wrong password', legacyHash)).toBe(false);
  });

  it('never mints new scrypt hashes — only Argon2id going forward', async () => {
    const hash = await hashPassword('fresh account');
    expect(isLegacyScryptHash(hash)).toBe(false);
  });
});
