import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from '../config/env.js';

export interface TokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(userId: number, role: Role): string {
  const options: SignOptions = {
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };
  return jwt.sign({ role }, config.jwt.secret, { ...options, subject: String(userId) });
}

/** מחזיר את תוכן ה-Token, או זורק שגיאה אם הוא לא תקין / פג תוקפו */
export function verifyAccessToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Invalid token payload');
  }
  return { sub: decoded.sub, role: decoded.role as Role };
}
