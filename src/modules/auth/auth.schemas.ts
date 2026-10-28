import { z } from 'zod';
import {
  emailField,
  fullNameField,
  nationalIdField,
  passwordField,
  phoneField,
  travelMinutesField,
} from '../../utils/validation.js';

export const registerSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  phone: phoneField,
  nationalId: nationalIdField,
  password: passwordField,
  defaultTravelMinutes: travelMinutesField.optional(),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'יש להזין סיסמה'),
});

export const updateMeSchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: phoneField.optional(),
    defaultTravelMinutes: travelMinutesField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'יש להזין את הסיסמה הנוכחית'),
  newPassword: passwordField,
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  code: z.string().regex(/^\d{6}$/, 'הקוד חייב להכיל 6 ספרות'),
  newPassword: passwordField,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
