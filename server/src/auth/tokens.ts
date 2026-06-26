// JWT lifecycle with server-side revocation via a denylist (§16.3).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@orlanda/shared';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

export interface TokenClaims {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
  jti: string;
}

const TTL_SECONDS = env.JWT_TTL_MINUTES * 60;
export const COOKIE_NAME = 'of_token';

export function signToken(user: { id: string; email: string; name: string; role: Role }): {
  token: string;
  jti: string;
  maxAgeMs: number;
} {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { email: user.email, name: user.name, role: user.role, jti },
    env.JWT_SECRET,
    { subject: user.id, expiresIn: TTL_SECONDS },
  );
  return { token, jti, maxAgeMs: TTL_SECONDS * 1000 };
}

export function verifyToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  return {
    sub: String(decoded.sub),
    email: String(decoded.email),
    name: String(decoded.name),
    role: decoded.role as Role,
    jti: String(decoded.jti),
  };
}

/** Logout: add the token's jti to the denylist until its natural expiry. */
export async function revokeToken(jti: string, expEpochSeconds?: number): Promise<void> {
  const expiresAt = expEpochSeconds
    ? new Date(expEpochSeconds * 1000)
    : new Date(Date.now() + TTL_SECONDS * 1000);
  await prisma.authTokenDenylist.upsert({
    where: { jti },
    create: { jti, expiresAt },
    update: { expiresAt },
  });
}

export async function isRevoked(jti: string): Promise<boolean> {
  const row = await prisma.authTokenDenylist.findUnique({ where: { jti } });
  return !!row;
}

/** Sweep expired denylist rows (called by the retention/cleanup job). */
export async function purgeExpiredTokens(): Promise<number> {
  const res = await prisma.authTokenDenylist.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}
