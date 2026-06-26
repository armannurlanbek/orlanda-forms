// Auth routes: login / logout / me (§4, §16.3).
import { Router } from 'express';
import { z } from 'zod';
import type { AuthUser } from '@orlanda/shared';
import { prisma } from '../db/prisma';
import { env, isProd } from '../config/env';
import { asyncHandler, badRequest, tooManyRequests, unauthorized } from '../http/errors';
import { loginLimiter } from '../http/rateLimit';
import { csrfProtect, requireAuth } from './middleware';
import { verifyPassword } from './password';
import { COOKIE_NAME, revokeToken, signToken } from './tokens';

export const authRouter = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Per-email consecutive-failure lockout (§16.3). In-memory; single instance.
const failures = new Map<string, { count: number; until: number }>();
const LOCK_THRESHOLD = 10;
const LOCK_MS = 15 * 60_000;

function recordFailure(email: string): void {
  const e = failures.get(email) ?? { count: 0, until: 0 };
  e.count += 1;
  if (e.count >= LOCK_THRESHOLD) e.until = Date.now() + LOCK_MS;
  failures.set(email, e);
}
function isLocked(email: string): boolean {
  const e = failures.get(email);
  return !!e && e.until > Date.now();
}
function clearFailures(email: string): void {
  failures.delete(email);
}

const cookieOpts = () =>
  ({
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ('strict' as const) : ('lax' as const),
    path: '/',
  });

authRouter.post(
  '/login',
  loginLimiter,
  csrfProtect,
  asyncHandler(async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid credentials');
    const email = parsed.data.email.toLowerCase().trim();

    if (isLocked(email)) throw tooManyRequests('Account temporarily locked. Try again later.');

    const user = await prisma.user.findUnique({ where: { email } });
    // Generic message regardless of whether the email exists (§16.3).
    const ok = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
    if (!user || !ok) {
      recordFailure(email);
      throw unauthorized('Invalid credentials');
    }
    clearFailures(email);

    const { token, maxAgeMs } = signToken(user);
    res.cookie(COOKIE_NAME, token, { ...cookieOpts(), maxAge: maxAgeMs });
    const body: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    res.json(body);
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  csrfProtect,
  asyncHandler(async (req, res) => {
    if (req.user) await revokeToken(req.user.jti, req.user.exp);
    res.clearCookie(COOKIE_NAME, cookieOpts());
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body: AuthUser = {
      id: req.user!.id,
      email: req.user!.email,
      name: req.user!.name,
      role: req.user!.role,
    };
    res.json(body);
  }),
);

void env; // referenced for cookie domain decisions if needed later
