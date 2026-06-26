import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env';

// Single shared Prisma client.
export const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export type { Prisma } from '@prisma/client';
