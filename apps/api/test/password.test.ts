import { hashPassword, verifyPassword } from '../src/auth/password';

describe('password hashing', () => {
  it('never stores the plaintext or a reversible blob', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('round-trips the right password and rejects a wrong one', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash (and salt) for the same password twice', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a).not.toBe(b);
    expect(verifyPassword('same password', a)).toBe(true);
    expect(verifyPassword('same password', b)).toBe(true);
  });

  it('treats a missing, empty, or malformed hash as no match, never throwing', () => {
    expect(verifyPassword('anything', null)).toBe(false);
    expect(verifyPassword('anything', undefined)).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$oops$$')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$16384$zz$zz')).toBe(false);
  });
});
