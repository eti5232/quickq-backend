import { z } from 'zod';
import { dateField } from '../../utils/validation.js';

export const availabilityQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'חודש לא תקין (פורמט YYYY-MM)'),
});

export const slotsQuery = z.object({
  date: dateField,
});
