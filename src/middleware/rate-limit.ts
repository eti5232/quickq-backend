import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const tooMany = (message: string) => ({ error: { code: 'TOO_MANY_REQUESTS', message } });

/** הגבלת ניסיונות התחברות - מונע ניחוש סיסמאות */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => config.isTest,
  message: tooMany('יותר מדי ניסיונות התחברות. נסי שוב בעוד 15 דקות'),
});

/** הגבלה לטפסים ציבוריים (פניית הצטרפות, הרשמה, שחזור סיסמה) */
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: tooMany('יותר מדי בקשות. נסי שוב מאוחר יותר'),
});

/** הגבלה כללית לכל ה-API */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: tooMany('יותר מדי בקשות. נסי שוב בעוד דקה'),
});
