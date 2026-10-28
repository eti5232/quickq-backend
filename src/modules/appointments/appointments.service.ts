import type { AppointmentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AuthUser } from '../../middleware/authenticate.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/app-error.js';
import { appointmentInclude, serializeAppointment, type AppointmentWithRelations } from '../../utils/serializers.js';
import { addMinutes, dayBoundsUtc, toLocalDateStr, toLocalTimeStr, todayStr } from '../../utils/time.js';
import { paginate } from '../../utils/validation.js';
import {
  ACTIVE_STATUSES,
  assertClientFree,
  createAppointmentTx,
  loadProviderContext,
  lockProvider,
  nextQueueNumberIfOpened,
  validateSlot,
} from '../../services/scheduling.service.js';
import { emailTemplates, sendEmail } from '../../services/email.service.js';
import type { BookAppointmentInput, MyAppointmentsQuery, UpdateAppointmentInput } from './appointments.schemas.js';

const STATUS_GROUPS: Record<'upcoming' | 'past' | 'cancelled', AppointmentStatus[]> = {
  upcoming: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'],
  past: ['COMPLETED', 'NO_SHOW'],
  cancelled: ['CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLINIC'],
};

async function loadAppointment(id: number) {
  return prisma.appointment.findUnique({ where: { id }, include: appointmentInclude });
}

/** בדיקת גישה: הלקוח בעל התור, מנהל הקליניקה של התור, או מנהל על. אחרת 404 */
function canAccess(user: AuthUser, a: AppointmentWithRelations) {
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.role === 'CLIENT') return a.clientId === user.id;
  return user.role === 'CLINIC_MANAGER' && a.provider.clinicId === user.clinicId;
}

export async function getAppointmentForUser(user: AuthUser, id: number) {
  const a = await loadAppointment(id);
  if (!a || !canAccess(user, a)) throw notFound('התור לא נמצא');
  return a;
}

export async function listMine(clientId: number, q: MyAppointmentsQuery) {
  const where: Prisma.AppointmentWhereInput = { clientId };
  if (q.status !== 'all') where.status = { in: STATUS_GROUPS[q.status] };
  if (q.from || q.to) {
    where.startTime = {
      ...(q.from ? { gte: dayBoundsUtc(q.from).start } : {}),
      ...(q.to ? { lt: dayBoundsUtc(q.to).end } : {}),
    };
  }
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { startTime: q.status === 'upcoming' ? 'asc' : 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);
  return paginate(
    items.map((a) => serializeAppointment(a, { includeClient: false })),
    total,
    q.page,
    q.pageSize,
  );
}

/** קביעת תור על ידי הלקוח */
export async function book(clientId: number, input: BookAppointmentInput) {
  const created = await prisma.$transaction((tx) =>
    createAppointmentTx(
      tx,
      {
        providerId: input.providerId,
        clientId,
        startTime: input.startTime,
        source: 'ONLINE',
        notes: input.notes ?? null,
        reminderEnabled: input.reminderEnabled,
        travelMinutes: input.travelMinutes ?? null,
      },
      { requireWorkingSlot: true, enforceHorizon: true, enforceClientLimit: true },
    ),
  );
  const full = await loadAppointment(created.id);
  return serializeAppointment(full as AppointmentWithRelations, { includeClient: false });
}

/** עדכון תור על ידי הלקוח: שינוי שעה (אצל אותו איש מקצוע), תזכורת, זמן הגעה, הערה */
export async function updateByClient(clientId: number, id: number, input: UpdateAppointmentInput, now = new Date()) {
  const existing = await loadAppointment(id);
  if (!existing || existing.clientId !== clientId) throw notFound('התור לא נמצא');
  if (!ACTIVE_STATUSES.includes(existing.status)) {
    throw conflict('APPOINTMENT_NOT_ACTIVE', 'לא ניתן לעדכן תור שהסתיים או בוטל');
  }

  const data: Prisma.AppointmentUncheckedUpdateInput = {};
  if (input.reminderEnabled !== undefined) data.reminderEnabled = input.reminderEnabled;
  if (input.travelMinutes !== undefined) data.travelMinutes = input.travelMinutes;
  if (input.notes !== undefined) data.notes = input.notes;

  const wantsReschedule = input.startTime && input.startTime.getTime() !== existing.startTime.getTime();
  if (input.reminderEnabled !== undefined || input.travelMinutes !== undefined || wantsReschedule) {
    // שינוי שמשפיע על התזכורת - מאפשרים לשלוח אותה שוב
    data.reminderSentAt = null;
  }

  await prisma.$transaction(async (tx) => {
    if (wantsReschedule && input.startTime) {
      const deadline = addMinutes(existing.startTime, -existing.provider.clinic.changeDeadlineHours * 60);
      if (existing.status !== 'BOOKED' || now >= deadline) {
        throw conflict(
          'CHANGE_DEADLINE_PASSED',
          `אפשר לשנות תור עד ${existing.provider.clinic.changeDeadlineHours} שעות לפני מועדו`,
        );
      }
      await lockProvider(tx, existing.providerId);
      const ctx = await loadProviderContext(existing.providerId, tx);
      const endTime = await validateSlot(tx, ctx, input.startTime, {
        requireWorkingSlot: true,
        enforceHorizon: true,
        excludeAppointmentId: id,
        now,
      });
      await assertClientFree(tx, clientId, input.startTime, endTime, id);
      data.startTime = input.startTime;
      data.endTime = endTime;
      data.queueNumber = await nextQueueNumberIfOpened(tx, existing.providerId, input.startTime);
    }
    await tx.appointment.update({ where: { id }, data });
  });

  const updated = await loadAppointment(id);
  return serializeAppointment(updated as AppointmentWithRelations, { includeClient: false });
}

/**
 * ביטול תור - על ידי הלקוח בעל התור או מנהל הקליניקה.
 * ביטול של לקוח אחרי המועד שהקליניקה קבעה מסומן "ביטול מאוחר".
 */
export async function cancel(user: AuthUser, id: number, reason: string | undefined, now = new Date()) {
  const a = await getAppointmentForUser(user, id);
  if (user.role === 'SUPER_ADMIN') throw forbidden('מנהל העל אינו מבטל תורים ישירות');
  if (!ACTIVE_STATUSES.includes(a.status)) {
    throw conflict('APPOINTMENT_NOT_ACTIVE', 'לא ניתן לבטל תור שהסתיים, בטיפול או כבר בוטל');
  }
  if (toLocalDateStr(a.startTime) < todayStr(now)) {
    throw badRequest('PAST_APPOINTMENT', 'לא ניתן לבטל תור מיום שעבר');
  }

  const byClient = user.role === 'CLIENT';
  const deadline = addMinutes(a.startTime, -a.provider.clinic.changeDeadlineHours * 60);
  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: byClient ? 'CANCELLED_BY_CLIENT' : 'CANCELLED_BY_CLINIC',
      cancelledAt: now,
      isLateCancellation: byClient && now >= deadline,
    },
    include: appointmentInclude,
  });

  if (!byClient && a.client.email) {
    await sendEmail({
      to: a.client.email,
      ...emailTemplates.cancelledByClinic({
        fullName: a.client.fullName,
        clinicName: a.provider.clinic.name,
        providerName: a.provider.fullName,
        date: toLocalDateStr(a.startTime),
        time: toLocalTimeStr(a.startTime),
        reason: reason ?? null,
      }),
    });
  }
  return serializeAppointment(updated, { includeClient: user.role !== 'CLIENT' });
}
