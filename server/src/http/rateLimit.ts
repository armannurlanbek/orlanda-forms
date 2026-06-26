// Rate limiters (§16.1, §16.3). In-memory store — correct here because the app
// runs single-instance (the role agent ensures only the primary runs it).
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';
import { getClientIp } from './clientIp';

const ipKey = (req: Request) => getClientIp(req);
const genericLimitMessage = { error: 'Too many requests. Please slow down.' };

export const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.LOGIN_RATE_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Too many login attempts. Try again shortly.' },
});

export const submitPerMinuteLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.SUBMIT_RATE_PER_MIN_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: genericLimitMessage,
});

export const submitPerHourLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: env.SUBMIT_RATE_PER_HOUR_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: genericLimitMessage,
});

// Global circuit breaker across all IPs on the submit route (§16.1).
export const submitGlobalLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.SUBMIT_RATE_GLOBAL_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'global',
  message: genericLimitMessage,
});
