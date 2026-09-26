import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * scrypt is built into Node, so hashing needs no dependency. Params follow the
 * OWASP baseline (N=2^15, r=8, p=1) for an interactive login on a small self-hosted box.
 */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Always spends roughly the same time whether or not `stored` is set, so a login
 * against an email with no password (a Google-only account) does not answer faster
 * than one with a wrong password — that timing gap is itself a user-enumeration leak.
 */
export function verifyPassword(
  password: string,
  stored: string | null | undefined,
): boolean {
  if (!stored) {
    scryptSync(password, randomBytes(16), KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: MAX_MEM,
    });
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n <= 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2], 'hex');
    expected = Buffer.from(parts[3], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, {
    N: n,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
