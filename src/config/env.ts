import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGINS: z.string().default('*'),
  APP_TIMEZONE: z.string().default('Asia/Jerusalem'),
  CRON_SECRET: z.string().optional().default(''),
  REMINDER_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('QuickQ <no-reply@example.com>'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
});

// משתנה שהוגדר ריק (למשל ב-Render) נחשב כאילו לא הוגדר - כדי שערך ברירת המחדל ייכנס
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''));
const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n❌ Invalid environment variables:\n${problems}\nSee .env.example\n`);
  throw new Error('Invalid environment configuration');
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  corsOrigins:
    env.CORS_ORIGINS.trim() === '*'
      ? ('*' as const)
      : env.CORS_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
  timezone: env.APP_TIMEZONE,
  cronSecret: env.CRON_SECRET,
  reminderIntervalSeconds: env.REMINDER_INTERVAL_SECONDS,
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  emailFrom: env.EMAIL_FROM,
  frontendUrl: env.FRONTEND_URL.replace(/\/$/, ''),
};
