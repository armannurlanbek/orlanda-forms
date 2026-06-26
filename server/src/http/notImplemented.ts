import type { Request, Response } from 'express';

// Placeholder handler for routes still under construction in a parallel wave.
export function notImplemented(_req: Request, res: Response): void {
  res.status(501).json({ error: 'Not implemented yet.' });
}
