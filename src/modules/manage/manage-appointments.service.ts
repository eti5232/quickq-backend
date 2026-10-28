import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma, type Tx } from '../../db/prisma.js';
import { conflict, notFound } from '../../utils/app-error.js';
import { appointmentInclude, serializeAppointment, type AppointmentWithRelations } from '../../utils/serializers.js';
import { dayBoundsUtc } from '../../utils/time.js';
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
import type { ListAppointmentsQuery, ManageBookInput, manageUpdateAppointmentSchema } from './manage.schemas.js';
import { getOwnProvider } from './manage.service.js';

export async function listAppointments(clinicId: number, q: ListAppointmentsQuery) {
  const where: Prisma.AppointmentWhereInput = { provider: { clinicId } };
  if (q.providerId) where.providerId = q.providerId;
  if (q.status) where.status = q.status;
  if (q.date) {
    const { start, end } = dayBoundsUtc(q.date);
    where.startTime = { gte: start, lt: end };
  } else if (q.from || q.to) {
    where.startTime = {
      ...(q.from ? { gte: dayBoundsUtc(q.from).start } : {}),
      ...(q.to ? { lt: dayBoundsUtc(q.to).end } : {}),
    };
  }
  if (q.q) {
    where.client = {
      OR: [
        { fullName: { contains: q.q, mode: 'insensitive' } },
        { phone: { contains: q.q } },
        { nationalId: { contains: q.q } },
      ],
    };
  }
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { startTime: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);
  return paginate(
    items.map((a) => serializeAppointment(a, { includeClient: true })),
    total,
    q.page,
    q.pageSize,
  );
}

export interface NewClientDetails {
  fullName: string;
  phone: string;
  nationalId: string;
  email?: string | undefined;
}

/** מחפש לקוח לפי ת"ז, ואם אין - יוצר לקוח חדש בלי סיסמה */
export async function findOrCreateClient(tx: Tx, details: NewClientDetails) {
  const existing = await tx.user.findUnique({ where: { nationalId: details.nationalId } });
  if (existing) {
    if (existing.role !== 'CLIENT') throw conflict('NATIONAL_ID_NOT_CLIENT', 'תעודת הזהות שייכת למשתמש שאינו לקוח');
    if (!existing.isActive) throw conflict('CLIENT_INACTIVE', 'הלקוח מושבת במערכת');
    return { client: existing, created: false };
  }
  if (details.email) {
    const byEmail = await tx.user.findUnique({ where: { email: details.email } });
    if (byEmail) throw conflict('EMAIL_TAKEN', 'כתובת המייל כבר רשומה אצל משתמש אחר');
  }
  const client = await tx.user.create({
    data: {
      role: 'CLIENT',
      fullName: details.fullName,
      phone: details.phone,
      nationalId: details.nationalId,
      email: details.email ?? null,
    },
  });
  return { client, created: true };
}

/** קביעת תור עבור לקוח (טלפונית) */
export async function bookForClient(clinicId: number, input: ManageBookInput) {
  await getOwnProvider(clinicId, input.providerId);
  const result = await prisma.$transaction(async (tx) => {
    let clientId: number;
    let clientCreated = false;
    if (input.clientId) {
      const client = await tx.user.findFirst({ where: { id: input.clientId, role: 'CLIENT', isActive: true } });
      if (!client) throw notFound('הלקוח לא נמצא');
      clientId = client.id;
    } else {
      const { client, created } = await findOrCreateClient(tx, input.client as NewClientDetails);
      clientId = client.id;
      clientCreated = created;
    }
    const appt = await createAppointmentTx(
      tx,
      {
        providerId: input.providerId,
        clientId,
        startTime: input.startTime,
        source: 'CLINIC',
        notes: input.notes ?? null,
        reminderEnabled: input.reminderEnabled,
        travelMinutes: input.travelMinutes ?? null,
      },
      { requireWorkingSlot: true, enforceHorizon: false, enforceClientLimit: false },
    );
    return { id: appt.id, clientCreated };
  });
  const full = await prisma.appointment.findUniqueOrThrow({ where: { id: result.id }, include: appointmentInclude });
  return { ...serializeAppointment(full, { includeClient: true }), clientCreated: result.clientCreated };
}

async function getOwnAppointment(clinicId: number, id: number): Promise<AppointmentWithRelations> {
  const a = await prisma.appointment.findUnique({ where: { id }, include: appointmentInclude });
  if (!a || a.provider.clinicId !== clinicId) throw notFound('התור לא נמצא');
  return a;
}

/** עדכון תור על ידי המנהל: שינוי שעה (אצל אותו איש מקצוע) והערה */
export async function updateAppointment(
  clinicId: number,
  id: number,
  input: z.infer<typeof manageUpdateAppointmentSchema>,
) {
  const existing = await getOwnAppointment(clinicId, id);
  if (!ACTIVE_STATUSES.includes(existing.status)) {
    throw conflict('APPOINTMENT_NOT_ACTIVE', 'לא ניתן לעדכן תור שהסתיים או בוטל');
  }
  const data: Prisma.AppointmentUncheckedUpdateInput = {};
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.$transaction(async (tx) => {
    if (input.startTime && input.startTime.getTime() !== existing.startTime.getTime()) {
      if (existing.status !== 'BOOKED') throw conflict('APPOINTMENT_NOT_ACTIVE', 'אפשר להזיז רק תור שעוד לא התחיל');
      await lockProvider(tx, existing.providerId);
      const ctx = await loadProviderContext(existing.providerId, tx);
      const endTime = await validateSlot(tx, ctx, input.startTime, {
        requireWorkingSlot: true,
        enforceHorizon: false,
        excludeAppointmentId: id,
      });
      await assertClientFree(tx, existing.clientId, input.startTime, endTime, id);
      data.startTime = input.startTime;
      data.endTime = endTime;
      data.reminderSentAt = null;
      data.queueNumber = await nextQueueNumberIfOpened(tx, existing.providerId, input.startTime);
    }
    await tx.appointment.update({ where: { id }, data });
  });
  const updated = await getOwnAppointment(clinicId, id);
  return serializeAppointment(updated, { includeClient: true });
}
