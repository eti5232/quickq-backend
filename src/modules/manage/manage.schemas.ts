import { z } from 'zod';
import {
  dateField,
  emailField,
  fullNameField,
  isoDateTimeField,
  nationalIdField,
  paginationQuery,
  phoneField,
  timeField,
  travelMinutesField,
} from '../../utils/validation.js';
import { timeToMinutes } from '../../utils/time.js';

export const updateClinicSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    city: z.string().trim().min(2).max(60).optional(),
    address: z.string().trim().min(2).max(200).optional(),
    phone: phoneField.optional(),
    description: z.string().trim().max(1000).nullish(),
    changeDeadlineHours: z.number().int().min(0).max(168).optional(),
    maxFutureAppointmentsPerProvider: z.number().int().min(1).max(20).optional(),
    bookingHorizonDays: z.number().int().min(1).max(365).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

export const createProviderSchema = z.object({
  fullName: fullNameField,
  specialty: z.string().trim().max(100).nullish(),
  slotMinutes: z.number().int().min(5, 'משך תור מינימלי 5 דקות').max(120, 'משך תור מקסימלי 120 דקות').default(10),
});

export const updateProviderSchema = z
  .object({
    fullName: fullNameField.optional(),
    specialty: z.string().trim().max(100).nullish(),
    slotMinutes: z.number().int().min(5).max(120).optional(),
    isActive: z.boolean().optional(),
    /** חובה true כדי להשבית איש מקצוע שיש לו תורים עתידיים */
    cancelFutureAppointments: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

const workingRange = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6, 'יום בשבוע: 0 (ראשון) עד 6 (שבת)'),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => timeToMinutes(r.startTime) < timeToMinutes(r.endTime), 'שעת ההתחלה חייבת להיות לפני שעת הסיום');

export const workingHoursSchema = z
  .object({ hours: z.array(workingRange).max(50) })
  .superRefine((v, ctx) => {
    for (let d = 0; d <= 6; d++) {
      const ranges = v.hours
        .filter((h) => h.dayOfWeek === d)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      for (let i = 1; i < ranges.length; i++) {
        const prev = ranges[i - 1];
        const cur = ranges[i];
        if (prev && cur && timeToMinutes(cur.startTime) < timeToMinutes(prev.endTime)) {
          ctx.addIssue({ code: 'custom', path: ['hours'], message: `טווחי שעות חופפים ביום ${d}` });
        }
      }
    }
  });

export const createAbsenceSchema = z.object({
  date: dateField,
  reason: z.string().trim().max(200).nullish(),
});

export const createClinicAbsenceSchema = createAbsenceSchema.extend({
  /** אם לא נשלח - ההיעדרות חלה על כל אנשי המקצוע בקליניקה */
  providerIds: z.array(z.number().int().positive()).min(1).optional(),
});

export const listAppointmentsQuery = paginationQuery.extend({
  providerId: z.coerce.number().int().positive().optional(),
  date: dateField.optional(),
  from: dateField.optional(),
  to: dateField.optional(),
  status: z
    .enum(['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLINIC'])
    .optional(),
  q: z.string().trim().max(100).optional(),
});

const newClientSchema = z.object({
  fullName: fullNameField,
  phone: phoneField,
  nationalId: nationalIdField,
  email: emailField.optional(),
});

export const manageBookSchema = z
  .object({
    providerId: z.number().int().positive(),
    startTime: isoDateTimeField,
    clientId: z.number().int().positive().optional(),
    client: newClientSchema.optional(),
    notes: z.string().trim().max(500).nullish(),
    reminderEnabled: z.boolean().default(false),
    travelMinutes: travelMinutesField.nullish(),
  })
  .refine((v) => Boolean(v.clientId) !== Boolean(v.client), 'יש לשלוח clientId (לקוח קיים) או client (לקוח חדש) - אחד מהם בלבד');

export const manageUpdateAppointmentSchema = z
  .object({
    startTime: isoDateTimeField.optional(),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

export const statusChangeSchema = z.object({
  status: z.enum(['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'], 'סטטוס לא תקין'),
});

export const clientsQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
});

export const updateClientSchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: phoneField.optional(),
    email: emailField.nullish(),
    nationalId: nationalIdField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

export const createStaffSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  phone: phoneField,
});

export const updateStaffSchema = z.object({
  isActive: z.boolean(),
});

export type ManageBookInput = z.infer<typeof manageBookSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuery>;
