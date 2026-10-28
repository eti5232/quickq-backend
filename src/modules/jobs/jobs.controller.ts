import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../../config/env.js';
import { AppError, unauthorized } from '../../utils/app-error.js';
import { processReminders } from '../../services/reminder.service.js';

function secretMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(config.cronSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** נקרא על ידי cron-job.org כל כמה דקות (עם הכותרת x-cron-secret) */
export async function sendReminders(req: Request, res: Response) {
  if (!config.cronSecret) {
    throw new AppError(503, 'JOBS_DISABLED', 'המשימה כבויה: לא הוגדר CRON_SECRET בשרת');
  }
  if (!secretMatches(req.header('x-cron-secret'))) {
    throw unauthorized('סוד ה-Cron שגוי או חסר', 'INVALID_CRON_SECRET');
  }
  res.json(await processReminders());
}
