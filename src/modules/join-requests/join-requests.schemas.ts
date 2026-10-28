import { z } from 'zod';
import { categoryEnum, emailField, fullNameField, phoneField } from '../../utils/validation.js';

export const createJoinRequestSchema = z.object({
  clinicName: z.string().trim().min(2, 'שם הקליניקה קצר מדי').max(100),
  category: categoryEnum,
  city: z.string().trim().min(2, 'שם העיר קצר מדי').max(60),
  contactName: fullNameField,
  email: emailField,
  phone: phoneField,
  message: z.string().trim().max(1000, 'ההודעה ארוכה מדי').optional(),
});

export type CreateJoinRequestInput = z.infer<typeof createJoinRequestSchema>;
