import { z } from 'zod';
import {
  booleanQuery,
  categoryEnum,
  emailField,
  fullNameField,
  nationalIdField,
  paginationQuery,
  phoneField,
} from '../../utils/validation.js';

export const joinRequestsQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const approveJoinRequestSchema = z
  .object({
    /** תיקון המייל לפני האישור (למשל אם הוא כבר תפוס) */
    email: emailField.optional(),
  })
  .default({});

export const rejectJoinRequestSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .default({});

export const clinicsQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  category: categoryEnum.optional(),
  isActive: booleanQuery.optional(),
});

const clinicFields = {
  name: z.string().trim().min(2, 'שם הקליניקה קצר מדי').max(100),
  category: categoryEnum,
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().min(2).max(200),
  phone: phoneField,
  description: z.string().trim().max(1000).nullish(),
};

export const createClinicSchema = z.object({
  ...clinicFields,
  manager: z.object({
    fullName: fullNameField,
    email: emailField,
    phone: phoneField,
  }),
});

export const updateClinicSchema = z
  .object({
    name: clinicFields.name.optional(),
    category: categoryEnum.optional(),
    city: clinicFields.city.optional(),
    address: clinicFields.address.optional(),
    phone: phoneField.optional(),
    description: clinicFields.description,
    isActive: z.boolean().optional(),
    cancelFutureAppointments: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');

export const usersQuery = paginationQuery.extend({
  role: z.enum(['SUPER_ADMIN', 'CLINIC_MANAGER', 'CLIENT']).optional(),
  q: z.string().trim().max(100).optional(),
  isActive: booleanQuery.optional(),
});

export const updateUserSchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: phoneField.optional(),
    email: emailField.optional(),
    nationalId: nationalIdField.optional(),
    isActive: z.boolean().optional(),
    cancelFutureAppointments: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'יש לשלוח לפחות שדה אחד לעדכון');
