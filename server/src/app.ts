import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { securityHeaders } from './http/securityHeaders';
import { errorHandler } from './http/errors';
import { apiRouter } from './routes';
import { prisma } from './db/prisma';

export function createApp(): express.Express {
  const app = express();

  // Behind the Cloudflare tunnel; real client IP read via getClientIp().
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(
    cors({
      origin: env.APP_URL,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));
  // JSON limit; the public multipart submit enforces its own stricter caps.
  app.use(express.json({ limit: '1mb' }));

  // DB-free health for the Cloudflare load balancer (§deploy / runbook §11).
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // DB-aware health (proves app -> router -> primary DB works).
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });

  app.use('/api', apiRouter);

  // Serve the built client (prod / single-container). SPA fallback handles both
  // the builder routes (/app/*) and public form routes (/{slug}).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
