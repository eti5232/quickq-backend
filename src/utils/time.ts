import { config } from '../config/env.js';

/**
 * כלי עזר לזמנים לפי אזור הזמן של המערכת (ברירת מחדל: Asia/Jerusalem).
 * בשרת כל הזמנים נשמרים ב-UTC; הפונקציות כאן ממירות ל"שעון מקומי" ובחזרה,
 * כולל טיפול נכון בשעון קיץ/חורף.
 *
 * "dateStr" = מחרוזת תאריך מקומית בפורמט YYYY-MM-DD
 * "timeStr" = מחרוזת שעה מקומית בפורמט HH:MM
 */

const MINUTE = 60_000;

const partsFormatter = () =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

let cachedFormatter: Intl.DateTimeFormat | null = null;

function getParts(date: Date) {
  cachedFormatter ??= partsFormatter();
  const out: Record<string, number> = {};
  for (const p of cachedFormatter.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** ההפרש (במילישניות) בין השעון המקומי ל-UTC ברגע נתון */
function offsetMs(date: Date): number {
  const p = getParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** תאריך מקומי (YYYY-MM-DD) של רגע נתון */
export function toLocalDateStr(date: Date): string {
  const p = getParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** שעה מקומית (HH:MM) של רגע נתון */
export function toLocalTimeStr(date: Date): string {
  const p = getParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** המרת תאריך+שעה מקומיים לרגע UTC */
export function localToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const [hh, mm] = timeStr.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMs(new Date(guess));
  let result = guess - off1;
  const off2 = offsetMs(new Date(result));
  if (off2 !== off1) result = guess - off2;
  return new Date(result);
}

/** היום המקומי של היום */
export function todayStr(now: Date = new Date()): string {
  return toLocalDateStr(now);
}

/** יום בשבוע (0=ראשון ... 6=שבת) של תאריך מקומי */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** הוספת ימים לתאריך מקומי */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** מספר הימים בין שני תאריכים מקומיים (b - a) */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** תחילת וסוף היום המקומי ב-UTC */
export function dayBoundsUtc(dateStr: string): { start: Date; end: Date } {
  return { start: localToUtc(dateStr, '00:00'), end: localToUtc(addDays(dateStr, 1), '00:00') };
}

/** ערך עבור עמודת DATE במסד הנתונים */
export function dateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** המרת עמודת DATE ממסד הנתונים למחרוזת */
export function dateOnlyToStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "HH:MM" -> דקות מתחילת היום */
export function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** דקות מתחילת היום -> "HH:MM" */
export function minutesToTime(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MINUTE;
}

export function isValidDateStr(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
