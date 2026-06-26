// Structured logging (§22). Correlate by submission id where relevant.
import pino from 'pino';
import { env, isProd } from './env';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  // Pretty transport is opt-in (dev) to avoid a hard dependency in prod images.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.passwordHash', '*.password'],
    remove: true,
  },
  base: { app: 'orlanda-forms', env: env.NODE_ENV },
});

/** Child logger scoped to a submission for end-to-end traceability (§22). */
export function submissionLogger(submissionId: string) {
  return logger.child({ submissionId });
}
