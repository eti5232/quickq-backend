import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { verifyAccessToken } from '../auth/jwt.js';
import { AppError, forbidden, unauthorized } from '../utils/app-error.js';

export interface AuthUser {
  id: number;
  role: Role;
  clinicId: number | null;
  fullName: string;
  email: string | null;
  record: User;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * מזהה את המשתמש לפי ה-Token בלבד, ובודק במסד הנתונים שהוא עדיין פעיל.
 * כך משתמש שהושבת נחסם מיד, גם אם ה-Token שלו עדיין בתוקף.
 */
async function resolveUser(token: string): Promise<AuthUser> {
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('פג תוקף ההתחברות, יש להתחבר מחדש', 'TOKEN_EXPIRED');
    }
    throw unauthorized('Token לא תקין', 'INVALID_TOKEN');
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) throw unauthorized('Token לא תקין', 'INVALID_TOKEN');

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { clinic: true } });
  if (!user || !user.passwordHash) throw unauthorized('Token לא תקין', 'INVALID_TOKEN');
  if (!user.isActive) throw unauthorized('המשתמש הושבת', 'USER_INACTIVE');
  if (user.role === 'CLINIC_MANAGER' && (!user.clinic || !user.clinic.isActive)) {
    throw forbidden('הקליניקה שלך מושבתת', 'CLINIC_INACTIVE');
  }

  const { clinic: _clinic, ...record } = user;
  return {
    id: user.id,
    role: user.role,
    clinicId: user.clinicId,
    fullName: user.fullName,
    email: user.email,
    record,
  };
}

interface AuthOptions {
  /** לאפשר גישה גם כשהמשתמש עוד חייב להחליף סיסמה זמנית */
  allowPendingPasswordChange?: boolean;
}

/** מחייב Bearer Token תקין. אחרת 401 */
export function requireAuth(options: AuthOptions = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearer(req);
    if (!token) throw unauthorized('נדרשת התחברות (Bearer Token)', 'UNAUTHORIZED');
    const user = await resolveUser(token);
    if (user.record.mustChangePassword && !options.allowPendingPasswordChange) {
      throw forbidden('יש להחליף את הסיסמה הזמנית לפני המשך השימוש', 'PASSWORD_CHANGE_REQUIRED');
    }
    req.user = user;
    next();
  };
}

/** Token לא חובה: אם נשלח Token תקין - המשתמש מזוהה; אם נשלח Token לא תקין - 401 */
export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearer(req);
    if (token) {
      try {
        req.user = await resolveUser(token);
      } catch (err) {
        if (err instanceof AppError && err.status === 403) {
          // משתמש עם קליניקה מושבתת יכול עדיין לצפות במידע ציבורי
          req.user = undefined;
        } else {
          throw err;
        }
      }
    }
    next();
  };
}

/** מחזיר את המשתמש המחובר (לשימוש בבקרים אחרי requireAuth) */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
