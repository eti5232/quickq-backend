import { Router } from 'express';
import { prisma } from '../../db/prisma.js';

export const healthRouter = Router();

/** בדיקת חיים: השרת עובד וגם מסד הנתונים מגיב */
healthRouter.get('/', async (_req, res) => {
  let database: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'error';
  }
  res.status(database === 'ok' ? 200 : 503).json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});
