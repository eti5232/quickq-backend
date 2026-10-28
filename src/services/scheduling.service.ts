import type { AppointmentSource, AppointmentStatus, Clinic, Prisma, Provider, WorkingHours } from '@prisma/client';
import { prisma, type Tx } from '../db/prisma.js';
import { badRequest, conflict, notFound } from '../utils/app-error.js';
import {
  addDays,
  addMinutes,
  dateOnly,
  dateOnlyToStr,
  dayBoundsUtc,
  dayOfWeek,
  diffDays,
  localToUtc,
  minutesToTime,
  timeToMinutes,
  toLocalDateStr,
  todayStr,
} from '../utils/time.js';

/**
 * לוגיקת קביעת תורים:
 * - חישוב משבצות פנויות לפי שעות פעילות, היעדרויות ותורים קיימים
 * - בדיקת חפיפה בזמן (ולא רק התאמה מדויקת של שעת התחלה)
 * - קביעת תור בתוך טרנזקציה עם נעילה, כדי ששני אנשים לא יתפסו אותה שעה
 */

/** סטטוסים שתופסים זמן ביומן של איש המקצוע */
export const OCCUPYING_STATUSES: AppointmentStatus[] = ['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];
/** תורים "פעילים" מבחינת הלקוח (עוד לא קרו) */
export const ACTIVE_STATUSES: AppointmentStatus[] = ['BOOKED', 'ARRIVED'];

export type ProviderContext = Provider & { clinic: Clinic; workingHours: WorkingHours[] };

export interface Slot {
  start: Date;
  end: Date;
  time: string;
}

export async function loadProviderContext(providerId: number, db: Tx = prisma): Promise<ProviderContext> {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    include: { clinic: true, workingHours: true },
  });
  if (!provider) throw notFound('איש המקצוע לא נמצא');
  return provider;
}

export function isBookable(ctx: ProviderContext): boolean {
  return ctx.isActive && ctx.clinic.isActive;
}

/** כל המשבצות התיאורטיות ביום מסוים (לפני סינון תפוסות) */
export function theoreticalSlots(ctx: ProviderContext, dateStr: string): Slot[] {
  const dow = dayOfWeek(dateStr);
  const ranges = ctx.workingHours
    .filter((h) => h.dayOfWeek === dow)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const slots: Slot[] = [];
  for (const r of ranges) {
    const startMin = timeToMinutes(r.startTime);
    const endMin = timeToMinutes(r.endTime);
    for (let m = startMin; m + ctx.slotMinutes <= endMin; m += ctx.slotMinutes) {
      const time = minutesToTime(m);
      const start = localToUtc(dateStr, time);
      slots.push({ start, end: addMinutes(start, ctx.slotMinutes), time });
    }
  }
  return slots;
}

interface Busy {
  startTime: Date;
  endTime: Date;
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

export function freeSlotsFor(
  ctx: ProviderContext,
  dateStr: string,
  busy: Busy[],
  absentDates: Set<string>,
  now: Date,
): Slot[] {
  if (absentDates.has(dateStr)) return [];
  return theoreticalSlots(ctx, dateStr).filter(
    (s) => s.start > now && !busy.some((b) => overlaps(s.start, s.end, b.startTime, b.endTime)),
  );
}

/** טעינת תורים תופסים והיעדרויות לטווח תאריכים */
async function loadBusyAndAbsences(providerIds: number[], fromDate: string, toDateExclusive: string, db: Tx = prisma) {
  const from = dayBoundsUtc(fromDate).start;
  const to = dayBoundsUtc(toDateExclusive).start;
  const [appointments, absences] = await Promise.all([
    db.appointment.findMany({
      where: {
        providerId: { in: providerIds },
        status: { in: OCCUPYING_STATUSES },
        startTime: { lt: to },
        endTime: { gt: from },
      },
      select: { providerId: true, startTime: true, endTime: true },
    }),
    db.providerAbsence.findMany({
      where: { providerId: { in: providerIds }, date: { gte: dateOnly(fromDate), lt: dateOnly(toDateExclusive) } },
      select: { providerId: true, date: true },
    }),
  ]);
  const busyBy = new Map<number, Busy[]>();
  for (const a of appointments) {
    const list = busyBy.get(a.providerId) ?? [];
    list.push(a);
    busyBy.set(a.providerId, list);
  }
  const absentBy = new Map<number, Set<string>>();
  for (const ab of absences) {
    const set = absentBy.get(ab.providerId) ?? new Set<string>();
    set.add(dateOnlyToStr(ab.date));
    absentBy.set(ab.providerId, set);
  }
  return { busyBy, absentBy };
}

/** הימים שבהם מותר לקבוע תור (מהיום ועד גבול הזמן של הקליניקה) */
function lastBookableDate(ctx: ProviderContext, now: Date) {
  return addDays(todayStr(now), ctx.clinic.bookingHorizonDays);
}

/** שעות פנויות ביום מסוים */
export async function getFreeSlots(providerId: number, dateStr: string, now = new Date()) {
  const ctx = await loadProviderContext(providerId);
  if (!isBookable(ctx)) throw notFound('איש המקצוע לא נמצא');
  const today = todayStr(now);
  const base = { providerId, date: dateStr, slotMinutes: ctx.slotMinutes };
  if (dateStr < today || dateStr > lastBookableDate(ctx, now)) return { ...base, isAbsent: false, slots: [] };
  const { busyBy, absentBy } = await loadBusyAndAbsences([providerId], dateStr, addDays(dateStr, 1));
  const absent = absentBy.get(providerId) ?? new Set<string>();
  const slots = freeSlotsFor(ctx, dateStr, busyBy.get(providerId) ?? [], absent, now);
  return {
    ...base,
    isAbsent: absent.has(dateStr),
    slots: slots.map((s) => ({ time: s.time, startTime: s.start.toISOString() })),
  };
}

export type DayAvailabilityStatus = 'AVAILABLE' | 'FULL' | 'NOT_WORKING' | 'ABSENT' | 'PAST' | 'BEYOND_HORIZON';

/** זמינות לכל יום בחודש (ללוח השנה) */
export async function getMonthAvailability(providerId: number, month: string, now = new Date()) {
  const ctx = await loadProviderContext(providerId);
  if (!isBookable(ctx)) throw notFound('איש המקצוע לא נמצא');
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const nextMonthFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const daysInMonth = diffDays(first, nextMonthFirst);
  const today = todayStr(now);
  const horizon = lastBookableDate(ctx, now);
  const { busyBy, absentBy } = await loadBusyAndAbsences([providerId], first, nextMonthFirst);
  const busy = busyBy.get(providerId) ?? [];
  const absent = absentBy.get(providerId) ?? new Set<string>();

  const days: { date: string; status: DayAvailabilityStatus; freeSlots: number }[] = [];
  for (let i = 0; i < daysInMonth; i++) {
    const date = addDays(first, i);
    let status: DayAvailabilityStatus;
    let freeSlots = 0;
    if (date < today) status = 'PAST';
    else if (date > horizon) status = 'BEYOND_HORIZON';
    else if (absent.has(date)) status = 'ABSENT';
    else if (theoreticalSlots(ctx, date).length === 0) status = 'NOT_WORKING';
    else {
      freeSlots = freeSlotsFor(ctx, date, busy, absent, now).length;
      status = freeSlots > 0 ? 'AVAILABLE' : 'FULL';
    }
    days.push({ date, status, freeSlots });
  }
  return { providerId, month, slotMinutes: ctx.slotMinutes, days };
}

/**
 * התור הפנוי הקרוב ביותר עבור כמה אנשי מקצוע (לחיפוש קליניקות).
 * מחזיר מפה: providerId -> זמן המשבצת הפנויה הראשונה (או null).
 */
export async function findNextAvailable(contexts: ProviderContext[], lookaheadDays: number, now = new Date()) {
  const result = new Map<number, Date | null>();
  const bookable = contexts.filter(isBookable);
  if (bookable.length === 0) return result;
  const today = todayStr(now);
  const end = addDays(today, lookaheadDays);
  const { busyBy, absentBy } = await loadBusyAndAbsences(
    bookable.map((c) => c.id),
    today,
    end,
  );
  for (const ctx of bookable) {
    const horizon = lastBookableDate(ctx, now);
    let found: Date | null = null;
    for (let i = 0; i < lookaheadDays && !found; i++) {
      const date = addDays(today, i);
      if (date > horizon) break;
      const free = freeSlotsFor(ctx, date, busyBy.get(ctx.id) ?? [], absentBy.get(ctx.id) ?? new Set(), now);
      if (free[0]) found = free[0].start;
    }
    result.set(ctx.id, found);
  }
  return result;
}

// ---------------------------------------------------------------------------
// קביעת תור - בתוך טרנזקציה
// ---------------------------------------------------------------------------

/** נעילת שורת איש המקצוע עד סוף הטרנזקציה - מונע קביעה כפולה במקביל */
export async function lockProvider(tx: Tx, providerId: number) {
  await tx.$queryRaw`SELECT id FROM "Provider" WHERE id = ${providerId} FOR UPDATE`;
}

export async function lockUser(tx: Tx, userId: number) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

interface SlotValidationOptions {
  /** לבדוק שהשעה היא משבצת חוקית בשעות הפעילות (לא בייבוא) */
  requireWorkingSlot: boolean;
  /** לבדוק את גבול הזמן קדימה של הקליניקה */
  enforceHorizon: boolean;
  excludeAppointmentId?: number;
  now?: Date;
}

/** בודק שאפשר לקבוע תור בזמן הזה. מחזיר את זמן הסיום */
export async function validateSlot(tx: Tx, ctx: ProviderContext, startTime: Date, opts: SlotValidationOptions): Promise<Date> {
  const now = opts.now ?? new Date();
  if (!isBookable(ctx)) throw conflict('PROVIDER_INACTIVE', 'איש המקצוע או הקליניקה אינם פעילים');
  if (startTime <= now) throw badRequest('PAST_TIME', 'לא ניתן לקבוע תור לזמן שכבר עבר');

  const dateStr = toLocalDateStr(startTime);
  if (opts.enforceHorizon && dateStr > lastBookableDate(ctx, now)) {
    throw badRequest('BEYOND_HORIZON', `אפשר לקבוע תורים עד ${ctx.clinic.bookingHorizonDays} ימים קדימה`);
  }

  const absence = await tx.providerAbsence.findUnique({
    where: { providerId_date: { providerId: ctx.id, date: dateOnly(dateStr) } },
  });
  if (absence) throw conflict('PROVIDER_ABSENT', 'איש המקצוע לא עובד ביום זה');

  const endTime = addMinutes(startTime, ctx.slotMinutes);

  if (opts.requireWorkingSlot) {
    const valid = theoreticalSlots(ctx, dateStr).some((s) => s.start.getTime() === startTime.getTime());
    if (!valid) throw badRequest('INVALID_SLOT', 'השעה שנבחרה אינה משבצת חוקית בשעות הפעילות');
  }

  const clash = await tx.appointment.findFirst({
    where: {
      providerId: ctx.id,
      status: { in: OCCUPYING_STATUSES },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      ...(opts.excludeAppointmentId ? { id: { not: opts.excludeAppointmentId } } : {}),
    },
  });
  if (clash) throw conflict('SLOT_TAKEN', 'השעה כבר תפוסה');
  return endTime;
}

/** לקוח לא יכול להחזיק שני תורים חופפים (גם בקליניקות שונות) */
export async function assertClientFree(tx: Tx, clientId: number, start: Date, end: Date, excludeAppointmentId?: number) {
  const clash = await tx.appointment.findFirst({
    where: {
      clientId,
      status: { in: ACTIVE_STATUSES.concat('IN_PROGRESS') },
      startTime: { lt: end },
      endTime: { gt: start },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
  });
  if (clash) throw conflict('CLIENT_OVERLAP', 'כבר יש לך תור אחר שחופף לשעה זו');
}

/** אם יום התור כבר נפתח - תור חדש לאותו יום מקבל את המספר הבא בתור */
export async function nextQueueNumberIfOpened(tx: Tx, providerId: number, startTime: Date): Promise<number | null> {
  const dateStr = toLocalDateStr(startTime);
  const day = await tx.queueDay.findUnique({ where: { providerId_date: { providerId, date: dateOnly(dateStr) } } });
  if (!day) return null;
  const { start, end } = dayBoundsUtc(dateStr);
  const max = await tx.appointment.aggregate({
    where: { providerId, startTime: { gte: start, lt: end } },
    _max: { queueNumber: true },
  });
  return (max._max.queueNumber ?? 0) + 1;
}

export interface CreateAppointmentInput {
  providerId: number;
  clientId: number;
  startTime: Date;
  source: AppointmentSource;
  notes?: string | null;
  reminderEnabled?: boolean;
  travelMinutes?: number | null;
}

/** יוצר תור אחרי כל הבדיקות. חייב לרוץ בתוך טרנזקציה */
export async function createAppointmentTx(
  tx: Tx,
  input: CreateAppointmentInput,
  opts: { requireWorkingSlot: boolean; enforceHorizon: boolean; enforceClientLimit: boolean; now?: Date },
) {
  await lockProvider(tx, input.providerId);
  await lockUser(tx, input.clientId);
  const ctx = await loadProviderContext(input.providerId, tx);
  const endTime = await validateSlot(tx, ctx, input.startTime, opts);
  await assertClientFree(tx, input.clientId, input.startTime, endTime);

  if (opts.enforceClientLimit) {
    const futureCount = await tx.appointment.count({
      where: {
        clientId: input.clientId,
        providerId: input.providerId,
        status: { in: ACTIVE_STATUSES },
        startTime: { gt: opts.now ?? new Date() },
      },
    });
    if (futureCount >= ctx.clinic.maxFutureAppointmentsPerProvider) {
      throw conflict(
        'MAX_FUTURE_APPOINTMENTS',
        `אפשר להחזיק עד ${ctx.clinic.maxFutureAppointmentsPerProvider} תורים עתידיים אצל איש מקצוע זה`,
      );
    }
  }

  const queueNumber = await nextQueueNumberIfOpened(tx, input.providerId, input.startTime);
  const data: Prisma.AppointmentUncheckedCreateInput = {
    providerId: input.providerId,
    clientId: input.clientId,
    startTime: input.startTime,
    endTime,
    source: input.source,
    notes: input.notes ?? null,
    reminderEnabled: input.reminderEnabled ?? false,
    travelMinutes: input.travelMinutes ?? null,
    queueNumber,
  };
  return tx.appointment.create({ data });
}

/** האם תור קיים נמצא בתוך שעות הפעילות (לאזהרה אחרי שינוי שעות) */
export function isWithinWorkingHours(hours: Pick<WorkingHours, 'dayOfWeek' | 'startTime' | 'endTime'>[], start: Date, end: Date) {
  const dateStr = toLocalDateStr(start);
  const dow = dayOfWeek(dateStr);
  return hours
    .filter((h) => h.dayOfWeek === dow)
    .some((h) => localToUtc(dateStr, h.startTime) <= start && localToUtc(dateStr, h.endTime) >= end);
}
