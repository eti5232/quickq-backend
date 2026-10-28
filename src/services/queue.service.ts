import type { Appointment, AppointmentStatus, QueueDay, User } from '@prisma/client';
import { prisma, type Tx } from '../db/prisma.js';
import { badRequest, conflict, notFound } from '../utils/app-error.js';
import { addMinutes, dateOnly, dayBoundsUtc, minutesBetween, toLocalDateStr, todayStr } from '../utils/time.js';
import { loadProviderContext, theoreticalSlots, type ProviderContext } from './scheduling.service.js';

/**
 * התור החי:
 * - פתיחה/הפסקה/סגירה של יום
 * - מעברי סטטוס (הגיע, נכנס, סיים, לא הגיע) כולל תיקון טעויות
 * - חישוב חכם: קצב אמיתי, עיכוב, זמן משוער לכל ממתין ומתי לצאת מהבית
 */

const WAITING: AppointmentStatus[] = ['BOOKED', 'ARRIVED'];
const NOT_CANCELLED: AppointmentStatus[] = ['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

type AppointmentWithClient = Appointment & { client: User };

export interface Estimate {
  appointmentId: number;
  estimatedTime: Date;
  peopleAhead: number;
}

export interface DaySnapshot {
  ctx: ProviderContext;
  dateStr: string;
  queueDay: QueueDay | null;
  appointments: AppointmentWithClient[];
  averageMinutesPerClient: number;
  estimates: Map<number, Estimate>;
  inProgress: AppointmentWithClient | null;
}

function sortByQueue(a: Appointment, b: Appointment) {
  const qa = a.queueNumber ?? Number.MAX_SAFE_INTEGER;
  const qb = b.queueNumber ?? Number.MAX_SAFE_INTEGER;
  if (qa !== qb) return qa - qb;
  return a.startTime.getTime() - b.startTime.getTime();
}

/** טעינת כל מה שצריך כדי לחשב את מצב התור ביום מסוים */
export async function loadDaySnapshot(providerId: number, now = new Date(), db: Tx = prisma): Promise<DaySnapshot> {
  const ctx = await loadProviderContext(providerId, db);
  const dateStr = todayStr(now);
  const { start, end } = dayBoundsUtc(dateStr);
  const [queueDay, appointments] = await Promise.all([
    db.queueDay.findUnique({ where: { providerId_date: { providerId, date: dateOnly(dateStr) } } }),
    db.appointment.findMany({
      where: { providerId, startTime: { gte: start, lt: end }, status: { in: NOT_CANCELLED } },
      include: { client: true },
    }),
  ]);
  appointments.sort(sortByQueue);

  // קצב אמיתי: ממוצע משך הטיפולים שהסתיימו היום
  const durations = appointments
    .filter((a) => a.status === 'COMPLETED' && a.startedAt && a.completedAt)
    .map((a) => minutesBetween(a.startedAt as Date, a.completedAt as Date))
    .filter((d) => d > 0);
  const averageMinutesPerClient =
    durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : ctx.slotMinutes;

  const inProgress = appointments.find((a) => a.status === 'IN_PROGRESS') ?? null;
  const estimates = new Map<number, Estimate>();
  const waiting = appointments.filter((a) => WAITING.includes(a.status));

  if (!queueDay || queueDay.status === 'CLOSED') {
    // היום לא נפתח - ההערכה היא השעה המקורית
    waiting.forEach((a, i) => estimates.set(a.id, { appointmentId: a.id, estimatedTime: a.startTime, peopleAhead: i }));
  } else {
    let cursor = now;
    if (inProgress?.startedAt) {
      const remaining = Math.max(0, averageMinutesPerClient - minutesBetween(inProgress.startedAt, now));
      cursor = addMinutes(now, remaining);
    }
    const aheadBase = inProgress ? 1 : 0;
    waiting.forEach((a, i) => {
      const est = cursor > a.startTime ? cursor : a.startTime;
      estimates.set(a.id, { appointmentId: a.id, estimatedTime: est, peopleAhead: aheadBase + i });
      cursor = addMinutes(est, averageMinutesPerClient);
    });
  }

  return { ctx, dateStr, queueDay, appointments, averageMinutesPerClient, estimates, inProgress };
}

export type DayStatus = 'NO_SERVICE_TODAY' | 'NOT_OPENED' | 'OPEN' | 'PAUSED' | 'CLOSED';

/** מצב התור החי - ציבורי, בלי שמות. אם viewer הוא לקוח עם תור היום - מתווסף myAppointment */
export async function getLiveStatus(providerId: number, viewer: { id: number; role: string } | null, now = new Date()) {
  const snap = await loadDaySnapshot(providerId, now);
  const { ctx, queueDay, appointments, estimates, inProgress } = snap;
  if (!ctx.isActive || !ctx.clinic.isActive) throw notFound('איש המקצוע לא נמצא');

  const absent = await prisma.providerAbsence.findUnique({
    where: { providerId_date: { providerId, date: dateOnly(snap.dateStr) } },
  });
  const todaySlots = theoreticalSlots(ctx, snap.dateStr);
  let dayStatus: DayStatus;
  if (queueDay) dayStatus = queueDay.status;
  else if (absent || todaySlots.length === 0) dayStatus = 'NO_SERVICE_TODAY';
  else dayStatus = 'NOT_OPENED';

  const completedCount = appointments.filter((a) => a.status === 'COMPLETED').length;
  const noShowCount = appointments.filter((a) => a.status === 'NO_SHOW').length;
  const waiting = appointments.filter((a) => WAITING.includes(a.status));
  const total = appointments.length;

  const firstWaiting = waiting[0];
  const firstEstimate = firstWaiting ? estimates.get(firstWaiting.id) : undefined;
  const delayMinutes =
    firstWaiting && firstEstimate && queueDay?.status !== 'CLOSED' && queueDay
      ? Math.max(0, Math.round(minutesBetween(firstWaiting.startTime, firstEstimate.estimatedTime)))
      : 0;

  const avg = snap.averageMinutesPerClient;
  const pace = avg < ctx.slotMinutes * 0.9 ? 'FASTER' : avg > ctx.slotMinutes * 1.1 ? 'SLOWER' : 'ON_TIME';

  let myAppointment: Record<string, unknown> | null = null;
  if (viewer && viewer.role === 'CLIENT') {
    const mine = appointments.find(
      (a) => a.clientId === viewer.id && (WAITING.includes(a.status) || a.status === 'IN_PROGRESS'),
    );
    if (mine) {
      const est = estimates.get(mine.id);
      const estimatedTime = mine.status === 'IN_PROGRESS' ? (mine.startedAt ?? now) : (est?.estimatedTime ?? mine.startTime);
      const travel = mine.travelMinutes ?? mine.client.defaultTravelMinutes;
      myAppointment = {
        appointmentId: mine.id,
        status: mine.status,
        queueNumber: mine.queueNumber,
        peopleAhead: mine.status === 'IN_PROGRESS' ? 0 : (est?.peopleAhead ?? 0),
        scheduledTime: mine.startTime,
        estimatedTime,
        minutesUntilTurn: Math.max(0, Math.round(minutesBetween(now, estimatedTime))),
        travelMinutes: travel,
        leaveHomeAt: addMinutes(estimatedTime, -travel),
        reminderEnabled: mine.reminderEnabled,
      };
    }
  }

  return {
    provider: { id: ctx.id, fullName: ctx.fullName, specialty: ctx.specialty, slotMinutes: ctx.slotMinutes },
    clinic: { id: ctx.clinic.id, name: ctx.clinic.name, address: ctx.clinic.address, city: ctx.clinic.city },
    date: snap.dateStr,
    dayStatus,
    plannedOpenTime: todaySlots[0]?.time ?? null,
    currentQueueNumber: inProgress?.queueNumber ?? null,
    delayMinutes,
    averageMinutesPerClient: Math.round(avg),
    pace,
    completedCount,
    noShowCount,
    waitingCount: waiting.length,
    totalToday: total,
    progressPercent: total === 0 ? 0 : Math.round(((completedCount + noShowCount) / total) * 100),
    updatedAt: now,
    myAppointment,
  };
}

/** רשימת התור המלאה למנהל הקליניקה (כולל שמות) */
export async function getManagerQueue(providerId: number, now = new Date()) {
  const snap = await loadDaySnapshot(providerId, now);
  return {
    provider: { id: snap.ctx.id, fullName: snap.ctx.fullName, slotMinutes: snap.ctx.slotMinutes },
    date: snap.dateStr,
    dayStatus: snap.queueDay?.status ?? 'NOT_OPENED',
    openedAt: snap.queueDay?.openedAt ?? null,
    averageMinutesPerClient: Math.round(snap.averageMinutesPerClient),
    currentAppointmentId: snap.inProgress?.id ?? null,
    appointments: snap.appointments.map((a) => ({
      id: a.id,
      queueNumber: a.queueNumber,
      status: a.status,
      startTime: a.startTime,
      endTime: a.endTime,
      estimatedTime: snap.estimates.get(a.id)?.estimatedTime ?? null,
      arrivedAt: a.arrivedAt,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      notes: a.notes,
      source: a.source,
      client: { id: a.client.id, fullName: a.client.fullName, phone: a.client.phone },
    })),
  };
}

// ---------------------------------------------------------------------------
// פעולות מנהל
// ---------------------------------------------------------------------------

async function getTodayQueueDay(tx: Tx, providerId: number, now: Date) {
  return tx.queueDay.findUnique({ where: { providerId_date: { providerId, date: dateOnly(todayStr(now)) } } });
}

/** פתיחת היום: קובע מספרי תור לפי סדר השעות */
export async function openDay(providerId: number, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Provider" WHERE id = ${providerId} FOR UPDATE`;
    const dateStr = todayStr(now);
    const existing = await getTodayQueueDay(tx, providerId, now);
    if (existing && existing.status !== 'CLOSED') throw conflict('ALREADY_OPEN', 'היום כבר פתוח');

    const { start, end } = dayBoundsUtc(dateStr);
    const appts = await tx.appointment.findMany({
      where: { providerId, startTime: { gte: start, lt: end }, status: { in: NOT_CANCELLED } },
      orderBy: { startTime: 'asc' },
    });
    let next = Math.max(0, ...appts.map((a) => a.queueNumber ?? 0)) + 1;
    for (const a of appts) {
      if (a.queueNumber === null) {
        await tx.appointment.update({ where: { id: a.id }, data: { queueNumber: next++ } });
      }
    }
    if (existing) {
      return tx.queueDay.update({ where: { id: existing.id }, data: { status: 'OPEN', closedAt: null } });
    }
    return tx.queueDay.create({
      data: { providerId, date: dateOnly(dateStr), status: 'OPEN', openedAt: now },
    });
  });
}

export async function setDayStatus(providerId: number, target: 'PAUSED' | 'OPEN', now = new Date()) {
  const day = await getTodayQueueDay(prisma, providerId, now);
  if (!day || day.status === 'CLOSED') throw conflict('QUEUE_NOT_OPEN', 'יום התור לא פתוח');
  if (target === 'PAUSED' && day.status === 'PAUSED') throw conflict('ALREADY_PAUSED', 'התור כבר בהפסקה');
  if (target === 'OPEN' && day.status === 'OPEN') throw conflict('NOT_PAUSED', 'התור לא בהפסקה');
  return prisma.queueDay.update({ where: { id: day.id }, data: { status: target } });
}

/** סגירת היום: מי שבטיפול מסומן "סיים", מי שלא נכנס מסומן "לא הגיע" */
export async function closeDay(providerId: number, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const day = await getTodayQueueDay(tx, providerId, now);
    if (!day || day.status === 'CLOSED') throw conflict('QUEUE_NOT_OPEN', 'יום התור לא פתוח');
    const { start, end } = dayBoundsUtc(todayStr(now));
    const completed = await tx.appointment.updateMany({
      where: { providerId, startTime: { gte: start, lt: end }, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    const noShow = await tx.appointment.updateMany({
      where: { providerId, startTime: { gte: start, lt: end }, status: { in: WAITING } },
      data: { status: 'NO_SHOW' },
    });
    const updated = await tx.queueDay.update({ where: { id: day.id }, data: { status: 'CLOSED', closedAt: now } });
    return { queueDay: updated, markedCompleted: completed.count, markedNoShow: noShow.count };
  });
}

/** מעברי סטטוס מותרים (כולל תיקון טעויות) */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: ['ARRIVED', 'IN_PROGRESS', 'NO_SHOW'],
  ARRIVED: ['IN_PROGRESS', 'NO_SHOW', 'BOOKED'],
  IN_PROGRESS: ['COMPLETED', 'ARRIVED'],
  COMPLETED: ['IN_PROGRESS'],
  NO_SHOW: ['ARRIVED', 'BOOKED'],
  CANCELLED_BY_CLIENT: [],
  CANCELLED_BY_CLINIC: [],
};

export type ManagerStatus = 'BOOKED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW';

async function applyStatus(tx: Tx, appt: Appointment, target: ManagerStatus, now: Date) {
  if (!TRANSITIONS[appt.status].includes(target)) {
    throw conflict('INVALID_TRANSITION', `לא ניתן לשנות סטטוס מ-${appt.status} ל-${target}`);
  }
  if (target === 'IN_PROGRESS') {
    const other = await tx.appointment.findFirst({
      where: {
        providerId: appt.providerId,
        status: 'IN_PROGRESS',
        id: { not: appt.id },
        ...dayRange(appt.startTime),
      },
    });
    if (other) throw conflict('ANOTHER_IN_PROGRESS', 'יש כבר לקוח אחר בטיפול. יש לסיים אותו קודם');
  }
  const data: Partial<Appointment> = { status: target };
  switch (target) {
    case 'BOOKED':
      Object.assign(data, { arrivedAt: null, startedAt: null, completedAt: null });
      break;
    case 'ARRIVED':
      Object.assign(data, { arrivedAt: appt.arrivedAt ?? now, startedAt: null, completedAt: null });
      break;
    case 'IN_PROGRESS':
      Object.assign(data, { arrivedAt: appt.arrivedAt ?? now, startedAt: appt.status === 'COMPLETED' ? appt.startedAt : now, completedAt: null });
      break;
    case 'COMPLETED':
      Object.assign(data, { completedAt: now });
      break;
    case 'NO_SHOW':
      Object.assign(data, { arrivedAt: null, startedAt: null, completedAt: null });
      break;
  }
  return tx.appointment.update({ where: { id: appt.id }, data });
}

function dayRange(time: Date) {
  const { start, end } = dayBoundsUtc(toLocalDateStr(time));
  return { startTime: { gte: start, lt: end } };
}

/** שינוי סטטוס של תור ביום הנוכחי (מנהל קליניקה) */
export async function changeStatus(appointmentId: number, clinicId: number, target: ManagerStatus, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { provider: true } });
    if (!appt || appt.provider.clinicId !== clinicId) throw notFound('התור לא נמצא');
    await tx.$queryRaw`SELECT id FROM "Provider" WHERE id = ${appt.providerId} FOR UPDATE`;
    if (toLocalDateStr(appt.startTime) !== todayStr(now)) {
      throw badRequest('NOT_TODAY', 'אפשר לעדכן סטטוס רק לתורים של היום');
    }
    const day = await getTodayQueueDay(tx, appt.providerId, now);
    if (!day || day.status === 'CLOSED') throw conflict('QUEUE_NOT_OPEN', 'יש לפתוח את יום התור קודם');
    return applyStatus(tx, appt, target, now);
  });
}

/** "הבא בתור": מסיים את הנוכחי ומכניס את הבא מבין אלה שהגיעו */
export async function nextInQueue(providerId: number, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Provider" WHERE id = ${providerId} FOR UPDATE`;
    const day = await getTodayQueueDay(tx, providerId, now);
    if (!day || day.status === 'CLOSED') throw conflict('QUEUE_NOT_OPEN', 'יש לפתוח את יום התור קודם');
    if (day.status === 'PAUSED') throw conflict('QUEUE_PAUSED', 'התור בהפסקה. יש להמשיך את התור קודם');

    const range = dayRange(now);
    const current = await tx.appointment.findFirst({ where: { providerId, status: 'IN_PROGRESS', ...range } });
    let completed = null;
    if (current) completed = await applyStatus(tx, current, 'COMPLETED', now);

    const arrived = await tx.appointment.findMany({ where: { providerId, status: 'ARRIVED', ...range } });
    arrived.sort(sortByQueue);
    const nextAppt = arrived[0];
    let started = null;
    if (nextAppt) started = await applyStatus(tx, nextAppt, 'IN_PROGRESS', now);

    return {
      completedAppointmentId: completed?.id ?? null,
      startedAppointmentId: started?.id ?? null,
      startedQueueNumber: started?.queueNumber ?? null,
      message: started ? `מספר ${started.queueNumber ?? ''} נכנס לטיפול` : 'אין כרגע לקוחות שסומנו "הגיע"',
    };
  });
}
