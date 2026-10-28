import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import { prisma } from '../../db/prisma.js';
import { AppError, badRequest } from '../../utils/app-error.js';
import { isValidNationalId, normalizeNationalId } from '../../utils/national-id.js';
import { addDays, isValidDateStr, localToUtc, todayStr } from '../../utils/time.js';
import { createAppointmentTx } from '../../services/scheduling.service.js';
import { findOrCreateClient } from './manage-appointments.service.js';

/**
 * ייבוא תורים מקובץ CSV (נשמר מאקסל).
 * - תומך בקידוד UTF-8 (מומלץ: "CSV UTF-8") וגם בקידוד העברי הישן של Windows (1255)
 * - תומך בכותרות בעברית או באנגלית, ובמפריד פסיק או נקודה-פסיק
 * - שורות תקינות נקלטות; שורות שגויות מדווחות בסיכום
 */

export const MAX_ROWS = 5000;

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date', 'תאריך'],
  time: ['time', 'שעה'],
  provider: ['provider', 'רופא', 'איש מקצוע', 'שם הרופא', 'שם איש המקצוע'],
  clientName: ['clientname', 'client name', 'שם לקוח', 'שם הלקוח', 'שם מלא', 'שם'],
  phone: ['phone', 'טלפון', 'נייד'],
  nationalId: ['nationalid', 'national id', 'תעודת זהות', 'ת"ז', 'תז', 'ת.ז'],
  email: ['email', 'מייל', 'אימייל', 'דוא"ל', 'דואל'],
};
const REQUIRED = ['date', 'time', 'provider', 'clientName', 'phone', 'nationalId'];

export function decodeCsv(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, 'win1255');
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0] && counts[0].n > 0 ? counts[0].d : ',';
}

/** DD/MM/YYYY, D.M.YYYY, DD-MM-YY או YYYY-MM-DD -> YYYY-MM-DD */
export function parseDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return isValidDateStr(v) ? v : null;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isValidDateStr(iso) ? iso : null;
}

export function parseTime(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const normalizeHeader = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase();

export interface ImportRowError {
  row: number;
  message: string;
}

export async function importAppointments(clinicId: number, buffer: Buffer) {
  const text = decodeCsv(buffer);
  let records: string[][];
  try {
    records = parse(text, {
      delimiter: detectDelimiter(text),
      skip_empty_lines: true,
      relax_column_count: true,
      // בעברית נפוץ גרש כפול בתוך טקסט (ד"ר, ת"ז) גם בלי מרכאות סביב השדה
      relax_quotes: true,
      trim: true,
    }) as string[][];
  } catch {
    throw badRequest('INVALID_CSV', 'לא ניתן לקרוא את הקובץ. יש לשמור אותו מאקסל בפורמט CSV');
  }
  if (records.length < 2) throw badRequest('EMPTY_CSV', 'הקובץ ריק או שחסרה שורת כותרות');

  const header = (records[0] ?? []).map(normalizeHeader);
  const colIndex: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) colIndex[field] = idx;
  }
  const missing = REQUIRED.filter((f) => colIndex[f] === undefined);
  if (missing.length > 0) {
    throw badRequest('MISSING_COLUMNS', 'חסרות עמודות חובה בקובץ', {
      missing,
      expected: 'תאריך, שעה, רופא, שם לקוח, טלפון, תעודת זהות, מייל (לא חובה)',
    });
  }
  const dataRows = records.slice(1);
  if (dataRows.length > MAX_ROWS) throw badRequest('TOO_MANY_ROWS', `אפשר לייבא עד ${MAX_ROWS} שורות בקובץ אחד`);

  const providers = await prisma.provider.findMany({ where: { clinicId, isActive: true } });
  const providerByName = new Map(providers.map((p) => [p.fullName.trim().toLowerCase(), p]));
  const now = new Date();

  const errors: ImportRowError[] = [];
  let imported = 0;
  let createdClients = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // שורה 1 היא הכותרות
    const cells = dataRows[i] ?? [];
    const get = (field: string) => {
      const idx = colIndex[field];
      return idx === undefined ? '' : (cells[idx] ?? '').trim();
    };
    try {
      const date = parseDate(get('date'));
      if (!date) throw badRequest('ROW', `תאריך לא תקין: "${get('date')}" (פורמט: 03/11/2026)`);
      const time = parseTime(get('time'));
      if (!time) throw badRequest('ROW', `שעה לא תקינה: "${get('time')}" (פורמט: 16:30)`);
      const provider = providerByName.get(get('provider').toLowerCase());
      if (!provider) throw badRequest('ROW', `איש מקצוע לא קיים בקליניקה: "${get('provider')}"`);
      const fullName = get('clientName');
      if (fullName.length < 2) throw badRequest('ROW', 'שם לקוח חסר');
      const phone = get('phone').replace(/[\s-]/g, '');
      if (!/^(\+972|0)\d{8,9}$/.test(phone)) throw badRequest('ROW', `טלפון לא תקין: "${get('phone')}"`);
      const rawId = get('nationalId');
      if (!isValidNationalId(rawId)) throw badRequest('ROW', `תעודת זהות לא תקינה: "${rawId}"`);
      const email = get('email').toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('ROW', `מייל לא תקין: "${email}"`);
      if (date > addDays(todayStr(now), 730)) throw badRequest('ROW', 'התאריך רחוק מדי (עד שנתיים קדימה)');

      const startTime = localToUtc(date, time);
      const created = await prisma.$transaction(async (tx) => {
        const { client, created: isNew } = await findOrCreateClient(tx, {
          fullName,
          phone,
          nationalId: normalizeNationalId(rawId),
          email: email || undefined,
        });
        await createAppointmentTx(
          tx,
          { providerId: provider.id, clientId: client.id, startTime, source: 'IMPORT' },
          { requireWorkingSlot: false, enforceHorizon: false, enforceClientLimit: false, now },
        );
        return isNew;
      });
      imported++;
      if (created) createdClients++;
    } catch (err) {
      if (err instanceof AppError) errors.push({ row: rowNumber, message: err.message });
      else throw err;
    }
  }

  return {
    totalRows: dataRows.length,
    imported,
    failed: errors.length,
    createdClients,
    errors,
  };
}

/** קובץ CSV לדוגמה עם אנשי המקצוע של הקליניקה */
export async function buildTemplate(clinicId: number): Promise<string> {
  const providers = await prisma.provider.findMany({ where: { clinicId, isActive: true }, take: 2 });
  const p1 = providers[0]?.fullName ?? 'ד"ר דוגמה';
  const p2 = providers[1]?.fullName ?? p1;
  const fmt = (iso: string) => iso.split('-').reverse().join('/');
  const d1 = fmt(addDays(todayStr(), 7));
  const d2 = fmt(addDays(todayStr(), 8));
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [
    ['תאריך', 'שעה', 'רופא', 'שם לקוח', 'טלפון', 'תעודת זהות', 'מייל'].join(','),
    [d1, '09:00', q(p1), q('ישראל ישראלי'), '0501234567', '123456782', 'israel@example.com'].join(','),
    [d1, '09:20', q(p1), q('שרה לוי'), '0527654321', '000000018', ''].join(','),
    [d2, '10:00', q(p2), q('דוד כהן'), '0549876543', '000000026', ''].join(','),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
