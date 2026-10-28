import { prisma } from '../db/prisma.js';
import { addMinutes, dayBoundsUtc, toLocalTimeStr, todayStr } from '../utils/time.js';
import { loadDaySnapshot } from './queue.service.js';
import { emailTemplates, sendEmail } from './email.service.js';

/** אחרי כמה דקות מהזמן המשוער כבר לא שולחים תזכורת (היא כבר לא רלוונטית) */
const LATE_GRACE_MINUTES = 15;

/**
 * בודק למי הגיע הזמן לצאת מהבית ושולח תזכורת במייל.
 * הזמן המשוער מחושב לפי קצב התור בפועל (אם היום נפתח), אחרת לפי השעה המקורית.
 * כל תור מקבל תזכורת אחת לכל היותר.
 */
export async function processReminders(now = new Date()) {
  const { start, end } = dayBoundsUtc(todayStr(now));
  const providers = await prisma.appointment.findMany({
    where: {
      reminderEnabled: true,
      reminderSentAt: null,
      status: { in: ['BOOKED', 'ARRIVED'] },
      startTime: { gte: start, lt: end },
      client: { email: { not: null }, isActive: true },
    },
    select: { providerId: true },
    distinct: ['providerId'],
  });

  let checked = 0;
  let sent = 0;
  for (const { providerId } of providers) {
    const snap = await loadDaySnapshot(providerId, now);
    for (const a of snap.appointments) {
      if (!a.reminderEnabled || a.reminderSentAt || !a.client.email) continue;
      if (a.status !== 'BOOKED' && a.status !== 'ARRIVED') continue;
      const est = snap.estimates.get(a.id);
      if (!est) continue;
      checked++;
      const travel = a.travelMinutes ?? a.client.defaultTravelMinutes;
      const leaveAt = addMinutes(est.estimatedTime, -travel);
      if (now < leaveAt || now > addMinutes(est.estimatedTime, LATE_GRACE_MINUTES)) continue;

      // סימון לפני השליחה - מונע שליחה כפולה אם שתי בדיקות רצות במקביל
      const claimed = await prisma.appointment.updateMany({
        where: { id: a.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;

      const ok = await sendEmail({
        to: a.client.email,
        ...emailTemplates.reminder({
          fullName: a.client.fullName,
          clinicName: snap.ctx.clinic.name,
          providerName: snap.ctx.fullName,
          estimatedTime: toLocalTimeStr(est.estimatedTime),
          leaveAt: toLocalTimeStr(leaveAt),
          queueNumber: a.queueNumber,
          peopleAhead: snap.queueDay ? est.peopleAhead : null,
        }),
      });
      if (ok) sent++;
      else await prisma.appointment.update({ where: { id: a.id }, data: { reminderSentAt: null } });
    }
  }
  return { checked, sent, ranAt: now };
}
