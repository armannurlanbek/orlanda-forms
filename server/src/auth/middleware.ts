// Auth + CSRF middleware (§16.3/§16.4/§16.5).
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../http/errors';
import { COOKIE_NAME, isRevoked, verifyToken } from './tokens';

/** Require a valid, non-revoked session cookie. Attaches req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw unauthorized();
    const claims = verifyToken(token);
    if (await isRevoked(claims.jti)) throw unauthorized();
    req.user = {
      id: claims.sub,
      email: claims.email,
      name: claims.name,
      role: claims.role,
      jti: claims.jti,
    };
    next();
  } catch (err) {
    next(err instanceof Error && 'status' in err ? err : unauthorized());
  }
}

/** Admin-only (user/seed management, data-subject deletion — §16.5). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') return next(forbidden());
  next();
}

/**
 * CSRF defense via strict Origin/Referer allowlist against APP_URL (§16.4).
 * Applied to state-changing builder routes. The public submit route (no cookie
 * auth) is exempt and is covered by rate limits (§16.1).
 */
export function csrfProtect(req: Request, _res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const appOrigin = new URL(env.APP_URL).origin;
  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin) {
    if (origin === appOrigin) return next();
    return next(forbidden('Bad origin'));
  }
  if (referer) {
    try {
      if (new URL(referer).origin === appOrigin) return next();
    } catch {
      /* fall through */
    }
    return next(forbidden('Bad referer'));
  }
  // No Origin/Referer on a state-changing request → reject.
  return next(forbidden('Missing origin'));
}
