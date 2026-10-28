import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Hash קבוע להשוואה כשמשתמש לא קיים - כדי שזמן התגובה לא יחשוף אם המייל קיים */
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', ROUNDS);

/** סיסמה זמנית קריאה: 10 תווים עם אותיות וספרות */
export function generateTemporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)] as string;
  const chars = [pick(letters), pick(digits)];
  while (chars.length < 10) chars.push(pick(all));
  // ערבוב
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

/** קוד בן 6 ספרות לשחזור סיסמה */
export function generateResetCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
