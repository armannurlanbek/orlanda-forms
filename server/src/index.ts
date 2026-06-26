import { env } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';
import { initSentry } from './observability/sentry';
import { startScheduledJobs, startWorker, stopWorker } from './worker';
import { prisma } from './db/prisma';

async function main(): Promise<void> {
  initSentry();

  // Note: `prisma migrate deploy` runs in the container entrypoint BEFORE this
  // process starts accepting traffic (§22). See deploy/entrypoint.sh.
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Orlanda Forms API listening');
  });

  startWorker();
  startScheduledJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await stopWorker();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
