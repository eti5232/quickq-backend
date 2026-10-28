import { z } from 'zod';
import { isValidNationalId, normalizeNationalId } from './national-id.js';
import { isValidDateStr } from './time.js';

/** סכמות ולידציה משותפות */

export const idParam = z.object({
  id: z.coerce.number().int().positive('מזהה לא תקין'),
});

export const fullNameField = z
  .string()
  .trim()
  .min(2, 'השם חייב להכיל לפחות 2 תווים')
  .max(100, 'השם ארוך מדי');

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('כתובת מייל לא תקינה'));

export const phoneField = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+972|0)\d{8,9}$/, 'מספר טלפון לא תקין (לדוגמה 0501234567)'));

export const passwordField = z
  .string()
  .min(8, 'הסיסמה חייבת להכיל לפחות 8 תווים')
  .max(72, 'הסיסמה ארוכה מדי')
  .regex(/[A-Za-z]/, 'הסיסמה חייבת להכיל לפחות אות אחת באנגלית')
  .regex(/\d/, 'הסיסמה חייבת להכיל לפחות ספרה אחת');

export const nationalIdField = z
  .string()
  .trim()
  .refine(isValidNationalId, 'מספר תעודת זהות לא תקין')
  .transform(normalizeNationalId);

export const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה (פורמט HH:MM)');

export const dateField = z.string().refine(isValidDateStr, 'תאריך לא תקין (פורמט YYYY-MM-DD)');

export const isoDateTimeField = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)) && /T/.test(v), 'זמן לא תקין (פורמט ISO, לדוגמה 2026-11-03T14:10:00.000Z)')
  .transform((v) => new Date(v));

export const travelMinutesField = z.coerce
  .number()
  .int('זמן הגעה חייב להיות מספר שלם')
  .min(0, 'זמן הגעה לא יכול להיות שלילי')
  .max(300, 'זמן הגעה מקסימלי הוא 300 דקות');

export const booleanQuery = z
  .enum(['true', 'false'], 'ערך חייב להיות true או false')
  .transform((v) => v === 'true');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const categoryEnum = z.enum(
  ['DENTAL', 'GENERAL_MEDICINE', 'PHYSIOTHERAPY', 'CONSULTING', 'OTHER'],
  'תחום לא תקין',
);

export function paginate<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
