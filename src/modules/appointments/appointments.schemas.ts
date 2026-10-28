import { z } from 'zod';
import { dateField, isoDateTimeField, paginationQuery, travelMinutesField } from '../../utils/validation.js';

export const bookAppointmentSchema = z.object({
  providerId: z.coerce.number().int().positive('יש לבחור איש מקצוע'),
  startTime: isoDateTimeField,
  reminderEnabled: z.boolean().default(false),
  travelMinutes: travelMinutesField.nullish(),
  notes: z.string().trim().max(500, 'ההערה ארוכה מדי (עד 500 תווים)').nullish(),
});

export const updateAppointmentSchema = z
  .object({
    startTime: isoDateTimeField.optional(),
    reminderEnabled: z.boolean().optional(),
    travelMinutes: travelMinutesField.nullish(),
    notes: z.string().trim().max(500, 'ההערה ארוכה מדי (עד 500 תווים)').nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

export const myAppointmentsQuery = paginationQuery.extend({
  status: z.enum(['upcoming', 'past', 'cancelled', 'all'], 'סטטוס לא תקין').default('upcoming'),
  from: dateField.optional(),
  to: dateField.optional(),
});

export const cancelSchema = z
  .object({
    reason: z.string().trim().max(200).optional(),
  })
  .default({});

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type MyAppointmentsQuery = z.infer<typeof myAppointmentsQuery>;
