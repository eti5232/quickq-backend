import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { forbidden, unauthorized } from '../utils/app-error.js';

/** מאפשר גישה רק לתפקידים שצוינו. אחרת 403 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) {
      throw forbidden('אין לך הרשאה לבצע פעולה זו');
    }
    next();
  };
}

/** מחזיר את מזהה הקליניקה של מנהל הקליניקה המחובר */
export function managerClinicId(req: Request): number {
  const user = req.user;
  if (!user) throw unauthorized();
  if (user.role !== 'CLINIC_MANAGER' || !user.clinicId) {
    throw forbidden('פעולה זו מיועדת למנהלי קליניקה בלבד');
  }
  return user.clinicId;
}
