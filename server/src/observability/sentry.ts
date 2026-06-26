// Optional error monitoring (§22). No-op when SENTRY_DSN is unset.
import * as Sentry from '@sentry/node';
import { env, isProd } from '../config/env';
import { logger } from '../config/logger';

let enabled = false;

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry disabled (no SENTRY_DSN)');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    enabled: isProd,
    tracesSampleRate: 0,
  });
  enabled = true;
  logger.info('Sentry initialized');
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
