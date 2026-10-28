import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { sentEmails } from '../src/services/email.service.js';
import { addDays, dayOfWeek, localToUtc, todayStr } from '../src/utils/time.js';

export const app = createApp();
export const api = () => request(app);

export const PASSWORD = 'Passw0rd!';

export async function resetDb() {
  sentEmails.length = 0;
  await prisma.$transaction([
    prisma.passwordResetCode.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.queueDay.deleteMany(),
    prisma.providerAbsence.deleteMany(),
    prisma.workingHours.deleteMany(),
    prisma.joinRequest.deleteMany(),
    prisma.user.deleteMany(),
    prisma.provider.deleteMany(),
    prisma.clinic.deleteMany(),
  ]);
}

const hash = bcrypt.hashSync(PASSWORD, 4);

/** תעודות זהות תקינות (עם ספרת ביקורת) */
export const IDS = ['123456782', '000000018', '000000026', '000000034', '000000042'];

/**
 * נתוני בסיס: מנהל על, שתי קליניקות (A עם שני רופאים, B עם רופא אחד),
 * מנהל לכל קליניקה, ושני לקוחות. שעות פעילות: כל יום 08:00-20:00, תור של 10 דקות.
 */
export async function createFixtures() {
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const hours = allDays.map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '20:00' }));
  const clinicA = await prisma.clinic.create({
    data: { name: 'קליניקה א', category: 'DENTAL', city: 'תל אביב', address: 'רחוב 1', phone: '035550001', changeDeadlineHours: 2, maxFutureAppointmentsPerProvider: 2 },
  });
  const clinicB = await prisma.clinic.create({
    data: { name: 'קליניקה ב', category: 'GENERAL_MEDICINE', city: 'חיפה', address: 'רחוב 2', phone: '045550002' },
  });
  const providerA1 = await prisma.provider.create({ data: { clinicId: clinicA.id, fullName: 'ד"ר א1', slotMinutes: 10, workingHours: { create: hours } } });
  const providerA2 = await prisma.provider.create({ data: { clinicId: clinicA.id, fullName: 'ד"ר א2', slotMinutes: 15, workingHours: { create: hours } } });
  const providerB1 = await prisma.provider.create({ data: { clinicId: clinicB.id, fullName: 'ד"ר ב1', slotMinutes: 10, workingHours: { create: hours } } });

  const mk = (data: Parameters<typeof prisma.user.create>[0]['data']) => prisma.user.create({ data });
  const admin = await mk({ role: 'SUPER_ADMIN', fullName: 'מנהל על', email: 'admin@test.dev', phone: '0500000000', passwordHash: hash });
  const managerA = await mk({ role: 'CLINIC_MANAGER', clinicId: clinicA.id, fullName: 'מנהל א', email: 'manager-a@test.dev', phone: '0500000001', passwordHash: hash });
  const managerB = await mk({ role: 'CLINIC_MANAGER', clinicId: clinicB.id, fullName: 'מנהל ב', email: 'manager-b@test.dev', phone: '0500000002', passwordHash: hash });
  const client1 = await mk({ role: 'CLIENT', fullName: 'לקוחה אחת', email: 'client1@test.dev', phone: '0521111111', nationalId: IDS[0], passwordHash: hash });
  const client2 = await mk({ role: 'CLIENT', fullName: 'לקוח שניים', email: 'client2@test.dev', phone: '0522222222', nationalId: IDS[1], passwordHash: hash });
  return { clinicA, clinicB, providerA1, providerA2, providerB1, admin, managerA, managerB, client1, client2 };
}

export async function login(email: string, password = PASSWORD) {
  const res = await api().post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** משבצת עתידית (n-th מתחילת היום) בעוד `daysAhead` ימים, בשעון ישראל */
export function futureSlot(daysAhead: number, time = '10:00') {
  const date = addDays(todayStr(), daysAhead);
  return { date, time, iso: localToUtc(date, time).toISOString(), dayOfWeek: dayOfWeek(date) };
}

/** יוצר תור ישירות במסד הנתונים */
export async function insertAppointment(data: {
  providerId: number;
  clientId: number;
  startTime: Date;
  minutes?: number;
  status?: 'BOOKED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED_BY_CLIENT' | 'CANCELLED_BY_CLINIC';
  queueNumber?: number | null;
  reminderEnabled?: boolean;
}) {
  return prisma.appointment.create({
    data: {
      providerId: data.providerId,
      clientId: data.clientId,
      startTime: data.startTime,
      endTime: new Date(data.startTime.getTime() + (data.minutes ?? 10) * 60_000),
      status: data.status ?? 'BOOKED',
      queueNumber: data.queueNumber ?? null,
      reminderEnabled: data.reminderEnabled ?? false,
    },
  });
}
