// Seed one admin user (§10). Compiles to server/dist/seed.js so it can run in
// the production image without tsx. Run: `npm run seed` (prod) / `npm run
// seed:dev` (local). Reads ADMIN_EMAIL / ADMIN_PASSWORD; if no password is
// given, a strong one is generated and printed once.
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'armann@orlanda.info').toLowerCase().trim();
  let password = process.env.ADMIN_PASSWORD ?? '';
  let generated = false;
  if (password.trim().length < 12) {
    password = crypto.randomBytes(15).toString('base64url');
    generated = true;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'Orlanda Admin', role: 'admin', passwordHash },
  });

  // eslint-disable-next-line no-console
  console.log(`\nAdmin user ready: ${user.email}`);
  if (generated) {
    // eslint-disable-next-line no-console
    console.log(`Generated admin password (save it now, shown once): ${password}\n`);
  } else {
    // eslint-disable-next-line no-console
    console.log('Using ADMIN_PASSWORD from environment.\n');
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
