/**
 * בדיקת תקינות תעודת זהות ישראלית (9 ספרות + ספרת ביקורת).
 * מספרים קצרים מ-9 ספרות מרופדים באפסים משמאל.
 */
export function normalizeNationalId(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.padStart(9, '0');
}

export function isValidNationalId(value: string): boolean {
  if (!/^\d{5,9}$/.test(value.trim())) return false;
  const id = normalizeNationalId(value);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(id[i]) * ((i % 2) + 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

/** יצירת ספרת ביקורת ל-8 ספרות (שימושי ליצירת נתוני הדגמה מומצאים) */
export function withCheckDigit(first8: string): string {
  const base = first8.padStart(8, '0').slice(0, 8);
  for (let c = 0; c <= 9; c++) {
    const candidate = `${base}${c}`;
    if (isValidNationalId(candidate)) return candidate;
  }
  throw new Error('unreachable');
}
