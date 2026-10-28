import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { isValidNationalId, normalizeNationalId, withCheckDigit } from '../src/utils/national-id.js';
import { addDays, dayOfWeek, localToUtc, toLocalDateStr, toLocalTimeStr } from '../src/utils/time.js';
import { decodeCsv, parseDate, parseTime } from '../src/modules/manage/import.service.js';

describe('national id', () => {
  it('accepts valid ids and rejects invalid ones', () => {
    expect(isValidNationalId('123456782')).toBe(true);
    expect(isValidNationalId('000000018')).toBe(true);
    expect(isValidNationalId('123456789')).toBe(false);
    expect(isValidNationalId('abc')).toBe(false);
    expect(isValidNationalId('')).toBe(false);
  });
  it('pads short ids and generates check digits', () => {
    expect(normalizeNationalId('18')).toBe('000000018');
    expect(isValidNationalId(withCheckDigit('31234567'))).toBe(true);
  });
});

describe('time helpers (Asia/Jerusalem)', () => {
  it('converts local time to UTC with winter (UTC+2) and summer (UTC+3) offsets', () => {
    expect(localToUtc('2026-01-15', '10:00').toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(localToUtc('2026-07-15', '10:00').toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });
  it('round-trips local date and time', () => {
    const d = localToUtc('2026-11-03', '16:10');
    expect(toLocalDateStr(d)).toBe('2026-11-03');
    expect(toLocalTimeStr(d)).toBe('16:10');
  });
  it('handles local midnight and day arithmetic', () => {
    expect(localToUtc('2026-11-03', '00:00').toISOString()).toBe('2026-11-02T22:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayOfWeek('2026-11-01')).toBe(0); // יום ראשון
  });
});

describe('CSV parsing helpers', () => {
  it('parses Israeli date formats', () => {
    expect(parseDate('03/11/2026')).toBe('2026-11-03');
    expect(parseDate('3.1.2027')).toBe('2027-01-03');
    expect(parseDate('2026-11-03')).toBe('2026-11-03');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });
  it('parses times', () => {
    expect(parseTime('9:05')).toBe('09:05');
    expect(parseTime('16:30:00')).toBe('16:30');
    expect(parseTime('25:00')).toBeNull();
  });
  it('decodes UTF-8 (with BOM) and legacy Windows-1255 Hebrew', () => {
    const text = 'שלום עולם';
    expect(decodeCsv(Buffer.from(text, 'utf8'))).toBe(text);
    expect(decodeCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]))).toBe(text);
    expect(decodeCsv(iconv.encode(text, 'win1255'))).toBe(text);
  });
});
