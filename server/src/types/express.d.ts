import type { Role } from '@orlanda/shared';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: Role;
        jti: string;
        exp?: number;
      };
    }
  }
}

export {};
