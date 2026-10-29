import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { AppError } from '../utils/app-error.js';
import { config } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `הכתובת ${req.method} ${req.path} לא קיימת` },
  });
}

/** טיפול מרכזי בכל השגיאות - מבנה תשובה אחיד */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0]?.message ?? 'הנתונים שנשלחו אינם תקינים',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'הקובץ גדול מדי (מקסימום 2MB)' : 'שגיאה בהעלאת הקובץ';
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: { code: 'DUPLICATE', message: 'קיימת כבר רשומה עם ערך זהה', details: err.meta } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'הרשומה לא נמצאה' } });
      return;
    }
  }

  // אילוץ ה-EXCLUDE במסד (Appointment_no_overlap): נשבר רק אם נתיב עקף את הנעילה בקוד
  if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes('Appointment_no_overlap')) {
    res.status(409).json({ error: { code: 'SLOT_TAKEN', message: 'השעה כבר תפוסה' } });
    return;
  }

  // JSON לא תקין בגוף הבקשה
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.parse.failed'
  ) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'גוף הבקשה אינו JSON תקין' } });
    return;
  }

  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'הבקשה גדולה מדי' } });
    return;
  }

  if (!config.isTest) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', err);
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'שגיאה פנימית בשרת' } });
}
