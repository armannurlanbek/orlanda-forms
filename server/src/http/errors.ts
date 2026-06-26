// App error type + async wrapper + central error handler.
import type { NextFunction, Request, Response } from 'express';
import type { ApiError } from '@orlanda/shared';
import { logger } from '../config/logger';
import { captureError } from '../observability/sentry';

export class AppError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  expose: boolean;

  constructor(
    status: number,
    message: string,
    opts: { code?: string; fields?: Record<string, string>; expose?: boolean } = {},
  ) {
    super(message);
    this.status = status;
    this.code = opts.code;
    this.fields = opts.fields;
    // 4xx messages are safe to expose; 5xx default to a generic message.
    this.expose = opts.expose ?? status < 500;
  }
}

// Common helpers.
export const badRequest = (msg: string, fields?: Record<string, string>) =>
  new AppError(400, msg, { fields });
export const unauthorized = (msg = 'Unauthorized') => new AppError(401, msg);
export const forbidden = (msg = 'Forbidden') => new AppError(403, msg);
// Return 404 for unauthorized object access to avoid enumeration (§16.5).
export const notFound = (msg = 'Not found') => new AppError(404, msg);
export const conflict = (msg: string) => new AppError(409, msg);
export const tooManyRequests = (msg = 'Too many requests') => new AppError(429, msg);

// Wrap async route handlers so thrown errors reach the error middleware.
export function asyncHandler<T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: U, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appErr = err instanceof AppError ? err : null;
  const status = appErr?.status ?? 500;

  if (status >= 500) {
    logger.error({ err, path: req.path, method: req.method }, 'request failed');
    captureError(err, { path: req.path, method: req.method });
  } else {
    logger.warn({ msg: (err as Error)?.message, path: req.path, status }, 'request rejected');
  }

  const body: ApiError = {
    error: appErr?.expose ? appErr.message : 'Something went wrong.',
  };
  if (appErr?.code) body.code = appErr.code;
  if (appErr?.fields) body.fields = appErr.fields;
  res.status(status).json(body);
}
