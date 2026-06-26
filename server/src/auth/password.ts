// Password hashing — argon2id (§16.3). No fast/unsalted hashes.
import argon2 from 'argon2';

const OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Password policy (§16.3): min 12 chars, not whitespace-only.
export function isAcceptablePassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.trim().length >= 12;
}
