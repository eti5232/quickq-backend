import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/app-error.js';
import { serializeClinic, serializeProvider, serializeUser } from '../../utils/serializers.js';
import { dateOnly, dateOnlyToStr, dayBoundsUtc, todayStr } from '../../utils/time.js';
import { paginate } from '../../utils/validation.js';
import { generateTemporaryPassword, hashPassword } from '../../utils/password.js';
import { ACTIVE_STATUSES, isWithinWorkingHours } from '../../services/scheduling.service.js';
import { cancelByClinic, countFutureActive } from '../../services/cancellation.service.js';
import { emailTemplates, sendEmail } from '../../services/email.service.js';
import type {
  clientsQuery,
  createAbsenceSchema,
  createClinicAbsenceSchema,
  createProviderSchema,
  createStaffSchema,
  updateClientSchema,
  updateClinicSchema,
  updateProviderSchema,
  workingHoursSchema,
} from './manage.schemas.js';

/** כל הפעולות כאן מוגבלות לקליניקה של המנהל המחובר (clinicId מגיע מה-Token) */

export async function getOwnProvider(clinicId: number, providerId: number) {
  const provider = await prisma.provider.findUnique({ where: { id: providerId } });
  if (!provider || provider.clinicId !== clinicId) throw notFound('איש המקצוע לא נמצא');
  return provider;
}

// ---------- קליניקה ----------

export async function getClinic(clinicId: number) {
  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
  return serializeClinic(clinic);
}

export async function updateClinic(clinicId: number, input: z.infer<typeof updateClinicSchema>) {
  const clinic = await prisma.clinic.update({ where: { id: clinicId }, data: input });
  return serializeClinic(clinic);
}

// ---------- אנשי מקצוע ----------

export async function listProviders(clinicId: number) {
  const providers = await prisma.provider.findMany({
    where: { clinicId },
    include: { workingHours: true },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
  });
  return {
    items: providers.map((p) => ({
      ...serializeProvider(p),
      workingHours: p.workingHours
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
        .map((h) => ({ dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime })),
    })),
  };
}

export async function createProvider(clinicId: number, input: z.infer<typeof createProviderSchema>) {
  const provider = await prisma.provider.create({
    data: { clinicId, fullName: input.fullName, specialty: input.specialty ?? null, slotMinutes: input.slotMinutes },
  });
  return serializeProvider(provider);
}

export async function updateProvider(clinicId: number, id: number, input: z.infer<typeof updateProviderSchema>) {
  const provider = await getOwnProvider(clinicId, id);
  const { cancelFutureAppointments, ...data } = input;
  let cancelledAppointments = 0;

  if (data.isActive === false && provider.isActive) {
    const future = await countFutureActive({ providerId: id });
    if (future > 0 && !cancelFutureAppointments) {
      throw conflict(
        'HAS_FUTURE_APPOINTMENTS',
        `לאיש המקצוע יש ${future} תורים עתידיים. כדי להשבית ולבטל אותם שלחי cancelFutureAppointments: true`,
        { futureAppointments: future },
      );
    }
    cancelledAppointments = await cancelByClinic({ providerId: id, startTime: { gt: new Date() } }, 'איש המקצוע אינו זמין');
  }

  const updated = await prisma.provider.update({ where: { id }, data });
  return { ...serializeProvider(updated), cancelledAppointments };
}

// ---------- שעות פעילות ----------

export async function getWorkingHours(clinicId: number, providerId: number) {
  await getOwnProvider(clinicId, providerId);
  const hours = await prisma.workingHours.findMany({
    where: { providerId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
  return { providerId, hours: hours.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })) };
}

/** החלפה מלאה של השעות השבועיות + אזהרה על תורים קיימים שנשארו מחוץ לשעות */
export async function replaceWorkingHours(
  clinicId: number,
  providerId: number,
  input: z.infer<typeof workingHoursSchema>,
) {
  await getOwnProvider(clinicId, providerId);
  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { providerId } }),
    prisma.workingHours.createMany({ data: input.hours.map((h) => ({ ...h, providerId })) }),
  ]);
  const future = await prisma.appointment.findMany({
    where: { providerId, status: { in: ACTIVE_STATUSES }, startTime: { gt: new Date() } },
    select: { id: true, startTime: true, endTime: true },
  });
  const outside = future.filter((a) => !isWithinWorkingHours(input.hours, a.startTime, a.endTime));
  const result = await getWorkingHours(clinicId, providerId);
  return {
    ...result,
    warning:
      outside.length > 0
        ? {
            message: `שימי לב: ${outside.length} תורים קיימים נמצאים מחוץ לשעות החדשות. הם לא בוטלו.`,
            appointmentIds: outside.map((a) => a.id),
          }
        : null,
  };
}

// ---------- היעדרויות ----------

export async function listAbsences(clinicId: number, providerId: number) {
  await getOwnProvider(clinicId, providerId);
  const absences = await prisma.providerAbsence.findMany({
    where: { providerId, date: { gte: dateOnly(todayStr()) } },
    orderBy: { date: 'asc' },
  });
  return { items: absences.map(serializeAbsence) };
}

function serializeAbsence(a: { id: number; providerId: number; date: Date; reason: string | null; createdAt: Date }) {
  return { id: a.id, providerId: a.providerId, date: dateOnlyToStr(a.date), reason: a.reason, createdAt: a.createdAt };
}

async function addAbsence(providerId: number, date: string, reason: string | null) {
  const absence = await prisma.providerAbsence.create({ data: { providerId, date: dateOnly(date), reason } });
  const { start, end } = dayBoundsUtc(date);
  const cancelled = await cancelByClinic(
    { providerId, startTime: { gte: start, lt: end } },
    reason ? `היעדרות: ${reason}` : 'איש המקצוע לא יעבוד ביום זה',
  );
  return { absence, cancelled };
}

export async function createAbsence(clinicId: number, providerId: number, input: z.infer<typeof createAbsenceSchema>) {
  await getOwnProvider(clinicId, providerId);
  if (input.date < todayStr()) throw badRequest('PAST_DATE', 'לא ניתן להוסיף היעדרות לתאריך שעבר');
  const exists = await prisma.providerAbsence.findUnique({
    where: { providerId_date: { providerId, date: dateOnly(input.date) } },
  });
  if (exists) throw conflict('ABSENCE_EXISTS', 'כבר קיימת היעדרות בתאריך זה');
  const { absence, cancelled } = await addAbsence(providerId, input.date, input.reason ?? null);
  return { absence: serializeAbsence(absence), cancelledAppointments: cancelled };
}

/** היעדרות לכמה אנשי מקצוע / לכל הקליניקה (חג, שיפוץ) */
export async function createClinicAbsence(clinicId: number, input: z.infer<typeof createClinicAbsenceSchema>) {
  if (input.date < todayStr()) throw badRequest('PAST_DATE', 'לא ניתן להוסיף היעדרות לתאריך שעבר');
  const providers = await prisma.provider.findMany({
    where: { clinicId, ...(input.providerIds ? { id: { in: input.providerIds } } : { isActive: true }) },
  });
  if (input.providerIds && providers.length !== input.providerIds.length) {
    throw notFound('אחד או יותר מאנשי המקצוע לא נמצאו');
  }
  const existing = await prisma.providerAbsence.findMany({
    where: { providerId: { in: providers.map((p) => p.id) }, date: dateOnly(input.date) },
  });
  const skip = new Set(existing.map((e) => e.providerId));
  const created = [];
  let cancelledAppointments = 0;
  for (const p of providers) {
    if (skip.has(p.id)) continue;
    const { absence, cancelled } = await addAbsence(p.id, input.date, input.reason ?? null);
    created.push(serializeAbsence(absence));
    cancelledAppointments += cancelled;
  }
  return { absences: created, skippedExisting: skip.size, cancelledAppointments };
}

export async function deleteAbsence(clinicId: number, absenceId: number) {
  const absence = await prisma.providerAbsence.findUnique({ where: { id: absenceId }, include: { provider: true } });
  if (!absence || absence.provider.clinicId !== clinicId) throw notFound('ההיעדרות לא נמצאה');
  await prisma.providerAbsence.delete({ where: { id: absenceId } });
}

// ---------- צוות (מנהלי קליניקה נוספים) ----------

export async function listStaff(clinicId: number) {
  const staff = await prisma.user.findMany({ where: { clinicId, role: 'CLINIC_MANAGER' }, orderBy: { fullName: 'asc' } });
  return { items: staff.map(serializeUser) };
}

export async function createStaff(clinicId: number, input: z.infer<typeof createStaffSchema>) {
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw conflict('EMAIL_TAKEN', 'כתובת המייל כבר רשומה במערכת');
  const temporaryPassword = generateTemporaryPassword();
  const user = await prisma.user.create({
    data: {
      role: 'CLINIC_MANAGER',
      clinicId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    },
    include: { clinic: true },
  });
  await sendEmail({
    to: input.email,
    ...emailTemplates.welcomeStaff({
      fullName: user.fullName,
      clinicName: user.clinic?.name ?? '',
      email: input.email,
      temporaryPassword,
    }),
  });
  const { clinic: _c, ...record } = user;
  return { user: serializeUser(record), temporaryPassword };
}

export async function updateStaff(clinicId: number, actorId: number, staffId: number, isActive: boolean) {
  const staff = await prisma.user.findUnique({ where: { id: staffId } });
  if (!staff || staff.clinicId !== clinicId || staff.role !== 'CLINIC_MANAGER') throw notFound('המשתמש לא נמצא');
  if (staffId === actorId && !isActive) throw badRequest('CANNOT_DEACTIVATE_SELF', 'לא ניתן להשבית את עצמך');
  const updated = await prisma.user.update({ where: { id: staffId }, data: { isActive } });
  return serializeUser(updated);
}

// ---------- לקוחות ----------

export async function listClients(clinicId: number, q: z.infer<typeof clientsQuery>) {
  const where: Prisma.UserWhereInput = {
    role: 'CLIENT',
    appointments: { some: { provider: { clinicId } } },
  };
  if (q.q) {
    where.OR = [
      { fullName: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
      { nationalId: { contains: q.q } },
      { email: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { _count: { select: { appointments: { where: { provider: { clinicId } } } } } },
    }),
    prisma.user.count({ where }),
  ]);
  const late = await prisma.appointment.groupBy({
    by: ['clientId'],
    where: { clientId: { in: users.map((u) => u.id) }, provider: { clinicId }, isLateCancellation: true },
    _count: { _all: true },
  });
  const lateBy = new Map(late.map((l) => [l.clientId, l._count._all]));
  return paginate(
    users.map(({ _count, ...u }) => ({
      ...serializeUser(u),
      appointmentsCount: _count.appointments,
      lateCancellationCount: lateBy.get(u.id) ?? 0,
    })),
    total,
    q.page,
    q.pageSize,
  );
}

/** עריכת לקוח - רק לקוח שנוסף על ידי הקליניקה ועדיין לא נרשם בעצמו */
export async function updateClient(clinicId: number, clientId: number, input: z.infer<typeof updateClientSchema>) {
  const client = await prisma.user.findFirst({
    where: { id: clientId, role: 'CLIENT', appointments: { some: { provider: { clinicId } } } },
  });
  if (!client) throw notFound('הלקוח לא נמצא');
  if (client.passwordHash) {
    throw forbidden('לקוח רשום מנהל את הפרטים שלו בעצמו', 'CLIENT_SELF_MANAGED');
  }
  const updated = await prisma.user.update({ where: { id: clientId }, data: input });
  return serializeUser(updated);
}
