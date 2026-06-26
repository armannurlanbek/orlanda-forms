// Fail-fast environment validation (§16.3). The server REFUSES TO BOOT if
// required secrets are missing, empty, placeholders, or too weak.

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const PLACEHOLDERS = new Set([
  'changeme',
  'change_me',
  'secret',
  'password',
  'placeholder',
  'todo',
  'xxx',
]);

function looksPlaceholder(v: string): boolean {
  const low = v.toLowerCase();
  if (PLACEHOLDERS.has(low)) return true;
  return /change_?me/i.test(v);
}

const strongSecret = z
  .string()
  .min(32, 'must be at least 32 characters')
  .refine((v) => !looksPlaceholder(v), 'must not be a placeholder value');

const nonEmpty = z.string().min(1).refine((v) => !looksPlaceholder(v), 'must not be a placeholder value');

const numStr = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .refine((n) => Number.isFinite(n) && n > 0, 'must be a positive number');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: numStr(8001),
  APP_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: nonEmpty,
  JWT_SECRET: strongSecret,
  JWT_TTL_MINUTES: numStr(60),

  ANTHROPIC_API_KEY: nonEmpty,
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  AI_DAILY_CALL_LIMIT: numStr(500),

  MONDAY_API_TOKEN: nonEmpty,

  SUBMIT_RATE_PER_MIN_PER_IP: numStr(5),
  SUBMIT_RATE_PER_HOUR_PER_IP: numStr(30),
  SUBMIT_RATE_GLOBAL_PER_MIN: numStr(60),
  FORM_DAILY_CAP_DEFAULT: numStr(200),
  LOGIN_RATE_PER_MIN: numStr(5),

  SUBMISSION_RETENTION_DAYS: numStr(90),

  SENTRY_DSN: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // eslint-disable-next-line no-console
    console.error(`\nInvalid environment configuration. Fix .env and restart:\n${lines.join('\n')}\n`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
