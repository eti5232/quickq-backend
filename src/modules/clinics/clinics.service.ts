import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../utils/app-error.js';
import { serializeClinic } from '../../utils/serializers.js';
import { addDays, dateOnly, dayOfWeek, localToUtc, timeToMinutes, toLocalTimeStr, todayStr } from '../../utils/time.js';
import { paginate } from '../../utils/validation.js';
import { findNextAvailable } from '../../services/scheduling.service.js';
import type { SearchClinicsInput } from './clinics.schemas.js';

const LOOKAHEAD_DAYS = 30;

/** חיפוש קליניקות עם סינון ומיון */
export async function searchClinics(input: SearchClinicsInput, now = new Date()) {
  const where: Prisma.ClinicWhereInput = { isActive: true };
  if (input.category) where.category = input.category;
  if (input.city) where.city = { equals: input.city, mode: 'insensitive' };
  if (input.q) {
    where.OR = [
      { name: { contains: input.q, mode: 'insensitive' } },
      { providers: { some: { isActive: true, fullName: { contains: input.q, mode: 'insensitive' } } } },
    ];
  }

  const clinics = await prisma.clinic.findMany({
    where,
    include: { providers: { where: { isActive: true }, include: { workingHours: true } } },
    orderBy: { name: 'asc' },
  });

  const today = todayStr(now);
  const providerIds = clinics.flatMap((c) => c.providers.map((p) => p.id));
  const todayDate = dateOnly(today);
  const queueDays = await prisma.queueDay.findMany({
    where: { providerId: { in: providerIds }, date: todayDate },
    select: { providerId: true, status: true },
  });
  const queueStatus = new Map(queueDays.map((d) => [d.providerId, d.status]));
  const absences = await prisma.providerAbsence.findMany({
    where: { providerId: { in: providerIds }, date: todayDate },
    select: { providerId: true },
  });
  const absentToday = new Set(absences.map((a) => a.providerId));

  /** פתוח עכשיו: התור החי פתוח, או (אם המנהל לא סגר את היום ואין היעדרות) אנחנו בתוך שעות הפעילות */
  const todayDow = dayOfWeek(today);
  const nowMinutes = timeToMinutes(toLocalTimeStr(now));
  const isProviderOpen = (p: (typeof clinics)[number]['providers'][number]) => {
    const status = queueStatus.get(p.id);
    if (status === 'OPEN' || status === 'PAUSED') return true;
    if (status === 'CLOSED' || absentToday.has(p.id)) return false;
    return p.workingHours.some(
      (h) => h.dayOfWeek === todayDow && timeToMinutes(h.startTime) <= nowMinutes && nowMinutes < timeToMinutes(h.endTime),
    );
  };

  const contexts = clinics.flatMap((c) => c.providers.map((p) => ({ ...p, clinic: c })));
  const nextByProvider = await findNextAvailable(contexts, LOOKAHEAD_DAYS, now);
  const weekEnd = localToUtc(addDays(today, 7), '00:00');

  let rows = clinics.map((c) => {
    let next: { startTime: Date; providerId: number; providerName: string } | null = null;
    for (const p of c.providers) {
      const t = nextByProvider.get(p.id);
      if (t && (!next || t < next.startTime)) next = { startTime: t, providerId: p.id, providerName: p.fullName };
    }
    const { providers, ...clinic } = c;
    return {
      ...serializeClinic(clinic),
      providersCount: providers.length,
      isOpenNow: providers.some(isProviderOpen),
      nextAvailableSlot: next,
    };
  });

  if (input.openNow !== undefined) rows = rows.filter((r) => r.isOpenNow === input.openNow);
  if (input.hasAvailabilityThisWeek !== undefined) {
    rows = rows.filter(
      (r) => (r.nextAvailableSlot !== null && r.nextAvailableSlot.startTime < weekEnd) === input.hasAvailabilityThisWeek,
    );
  }
  if (input.sort === 'nextAvailable') {
    rows.sort((a, b) => {
      const ta = a.nextAvailableSlot?.startTime.getTime() ?? Number.POSITIVE_INFINITY;
      const tb = b.nextAvailableSlot?.startTime.getTime() ?? Number.POSITIVE_INFINITY;
      return ta - tb || a.name.localeCompare(b.name, 'he');
    });
  } else {
    rows.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }

  const total = rows.length;
  const start = (input.page - 1) * input.pageSize;
  return paginate(rows.slice(start, start + input.pageSize), total, input.page, input.pageSize);
}

export async function listCities() {
  const rows = await prisma.clinic.findMany({
    where: { isActive: true },
    distinct: ['city'],
    select: { city: true },
    orderBy: { city: 'asc' },
  });
  return rows.map((r) => r.city);
}

export async function getClinic(id: number, now = new Date()) {
  const clinic = await prisma.clinic.findFirst({
    where: { id, isActive: true },
    include: { providers: { where: { isActive: true }, orderBy: { fullName: 'asc' } } },
  });
  if (!clinic) throw notFound('הקליניקה לא נמצאה');
  const days = await prisma.queueDay.findMany({
    where: { providerId: { in: clinic.providers.map((p) => p.id) }, date: dateOnly(todayStr(now)) },
  });
  const statusBy = new Map(days.map((d) => [d.providerId, d.status]));
  const { providers, ...rest } = clinic;
  return {
    ...serializeClinic(rest),
    providers: providers.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      specialty: p.specialty,
      slotMinutes: p.slotMinutes,
      todayQueueStatus: statusBy.get(p.id) ?? 'NOT_OPENED',
    })),
  };
}
