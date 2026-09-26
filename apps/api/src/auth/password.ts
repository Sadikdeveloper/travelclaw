import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Argon2id is the current OWASP first choice for password storage (winner of the
 * Password Hashing Competition, resistant to both GPU/ASIC and cache-timing attacks —
 * the "id" variant blends Argon2i's side-channel resistance with Argon2d's GPU
 * resistance). Node has no built-in Argon2, and the mainstream `argon2` package is a
 * native addon (compiled per platform), which this repo otherwise avoids (see
 * `node:sqlite` over `better-sqlite3`). `hash-wasm` ships Argon2 as WebAssembly with
 * zero native compilation and zero further dependencies, so it keeps that property.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet's top recommendation:
 * m=19 MiB, t=2, p=1.
 */
const ARGON2ID_MEMORY_KIB = 19_456;
const ARGON2ID_ITERATIONS = 2;
const ARGON2ID_PARALLELISM = 1;
const ARGON2ID_HASH_LENGTH = 32;
const ARGON2ID_SALT_LENGTH = 16;

/**
 * Legacy format from before Argon2id was wired up. Kept for verification only — no
 * new password is ever hashed this way — so an account created against an earlier
 * build of this branch still signs in, and `login()` transparently upgrades it.
 * Parameters match OWASP's scrypt row for this memory tier (N=2^17, r=8, p=1, 128MB).
 */
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(ARGON2ID_SALT_LENGTH);
  return argon2id({
    password,
    salt,
    parallelism: ARGON2ID_PARALLELISM,
    iterations: ARGON2ID_ITERATIONS,
    memorySize: ARGON2ID_MEMORY_KIB,
    hashLength: ARGON2ID_HASH_LENGTH,
    outputType: 'encoded',
  });
}

export function isLegacyScryptHash(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

/**
 * Always does real cryptographic work whether or not `stored` is set, so a login
 * against an email with no password (a Google-only account) does not answer faster
 * than one with a wrong password — that timing gap is itself a user-enumeration leak.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) {
    await argon2id({
      password,
      salt: randomBytes(ARGON2ID_SALT_LENGTH),
      parallelism: ARGON2ID_PARALLELISM,
      iterations: ARGON2ID_ITERATIONS,
      memorySize: ARGON2ID_MEMORY_KIB,
      hashLength: ARGON2ID_HASH_LENGTH,
      outputType: 'encoded',
    });
    return false;
  }
  if (isLegacyScryptHash(stored)) return verifyLegacyScrypt(password, stored);
  if (!stored.startsWith('$argon2id$')) return false;
  try {
    return await argon2Verify({ password, hash: stored });
  } catch {
    // A corrupt or truncated hash string must fail closed, not throw past the caller.
    return false;
  }
}

function verifyLegacyScrypt(password: string, stored: string): boolean {
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
    maxmem: SCRYPT_MAX_MEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Exported only so a test can assert the legacy path still verifies a fixture hash. */
export function hashPasswordLegacyScryptForTests(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEM,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}
