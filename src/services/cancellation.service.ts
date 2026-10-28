import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { appointmentInclude } from '../utils/serializers.js';
import { toLocalDateStr, toLocalTimeStr } from '../utils/time.js';
import { ACTIVE_STATUSES } from './scheduling.service.js';
import { emailTemplates, sendEmail } from './email.service.js';

/**
 * ביטול מרוכז של תורים על ידי הקליניקה (היעדרות, השבתת איש מקצוע/קליניקה/לקוח).
 * כל לקוח עם מייל מקבל הודעה.
 */
export async function countFutureActive(where: Prisma.AppointmentWhereInput, now = new Date()) {
  return prisma.appointment.count({ where: { ...where, status: { in: ACTIVE_STATUSES }, startTime: { gt: now } } });
}

export async function cancelByClinic(where: Prisma.AppointmentWhereInput, reason: string | null, now = new Date()) {
  const appointments = await prisma.appointment.findMany({
    where: { ...where, status: { in: ACTIVE_STATUSES } },
    include: appointmentInclude,
  });
  if (appointments.length === 0) return 0;

  await prisma.appointment.updateMany({
    where: { id: { in: appointments.map((a) => a.id) } },
    data: { status: 'CANCELLED_BY_CLINIC', cancelledAt: now },
  });

  for (const a of appointments) {
    if (!a.client.email) continue;
    await sendEmail({
      to: a.client.email,
      ...emailTemplates.cancelledByClinic({
        fullName: a.client.fullName,
        clinicName: a.provider.clinic.name,
        providerName: a.provider.fullName,
        date: toLocalDateStr(a.startTime),
        time: toLocalTimeStr(a.startTime),
        reason,
      }),
    });
  }
  return appointments.length;
}
