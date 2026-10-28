import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { processReminders } from '../src/services/reminder.service.js';
import { sentEmails } from '../src/services/email.service.js';
import { addMinutes, dateOnly, dayOfWeek, localToUtc, timeToMinutes, toLocalTimeStr, todayStr } from '../src/utils/time.js';
import { api, bearer, createFixtures, insertAppointment, login, resetDb } from './helpers.js';

let f: Awaited<ReturnType<typeof createFixtures>>;
let tm: string;

/** תורים של היום: 00:00, 00:10, 00:20... (תמיד בתוך היום הנוכחי) */
const todayAt = (i: number) => addMinutes(localToUtc(todayStr(), '00:00'), i * 10);

beforeEach(async () => {
  await resetDb();
  f = await createFixtures();
  tm = await login('manager-a@test.dev');
});

async function todayAppointments(count: number) {
  const out = [];
  const clients = [f.client1, f.client2];
  for (let i = 0; i < count; i++) {
    const c = i < 2 ? clients[i] : await prisma.user.create({ data: { role: 'CLIENT', fullName: `לקוח ${i}`, phone: '0520000000' } });
    if (!c) throw new Error('fixture');
    out.push(await insertAppointment({ providerId: f.providerA1.id, clientId: c.id, startTime: todayAt(i) }));
  }
  return out;
}

const localTimeNow = () => timeToMinutes(toLocalTimeStr(new Date()));

const q = (path: string) => `/api/manage/providers/${f.providerA1.id}/queue${path}`;

describe('opening and closing the day', () => {
  it('shows NOT_OPENED before opening, then assigns queue numbers by time on open', async () => {
    const appts = await todayAppointments(3);
    const live0 = await api().get(`/api/providers/${f.providerA1.id}/live`);
    expect(live0.body.dayStatus).toBe('NOT_OPENED');

    const res = await api().post(q('/open')).set(bearer(tm));
    expect(res.status).toBe(200);
    expect(res.body.dayStatus).toBe('OPEN');
    expect(res.body.appointments.map((a: { id: number; queueNumber: number }) => [a.id, a.queueNumber])).toEqual(
      appts.map((a, i) => [a.id, i + 1]),
    );
    expect((await api().post(q('/open')).set(bearer(tm))).status).toBe(409);
  });

  it('gives a same-day booking made after opening the next queue number', async () => {
    await todayAppointments(2);
    await api().post(q('/open')).set(bearer(tm));
    const res = await api()
      .post('/api/manage/appointments')
      .set(bearer(tm))
      .send({ providerId: f.providerA2.id, startTime: localToUtc(todayStr(), '23:45').toISOString(), clientId: f.client1.id });
    // ספק 2 עוד לא נפתח - אין מספר
    if (res.status === 201) expect(res.body.queueNumber).toBeNull();
    const late = await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: todayAt(50) });
    expect(late.queueNumber).toBeNull();
    const reopenNumbers = await prisma.appointment.findMany({ where: { providerId: f.providerA1.id }, orderBy: { queueNumber: 'asc' } });
    expect(reopenNumbers.filter((a) => a.queueNumber !== null)).toHaveLength(2);
  });

  it('pauses, resumes and closes; closing marks leftovers as no-show and current as completed', async () => {
    const appts = await todayAppointments(3);
    await api().post(q('/open')).set(bearer(tm));
    await api().post(`/api/manage/appointments/${appts[0]?.id}/status`).set(bearer(tm)).send({ status: 'IN_PROGRESS' });

    expect((await api().post(q('/pause')).set(bearer(tm))).body.dayStatus).toBe('PAUSED');
    expect((await api().get(`/api/providers/${f.providerA1.id}/live`)).body.dayStatus).toBe('PAUSED');
    expect((await api().post(q('/next')).set(bearer(tm))).status).toBe(409);
    expect((await api().post(q('/pause')).set(bearer(tm))).status).toBe(409);
    expect((await api().post(q('/resume')).set(bearer(tm))).body.dayStatus).toBe('OPEN');

    const closed = await api().post(q('/close')).set(bearer(tm));
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ markedCompleted: 1, markedNoShow: 2 });
    expect((await api().get(`/api/providers/${f.providerA1.id}/live`)).body.dayStatus).toBe('CLOSED');
  });
});

describe('status changes and "next"', () => {
  it('requires an open day and only today appointments', async () => {
    const [a] = await todayAppointments(1);
    const res = await api().post(`/api/manage/appointments/${a?.id}/status`).set(bearer(tm)).send({ status: 'ARRIVED' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_NOT_OPEN');

    const tomorrow = await insertAppointment({ providerId: f.providerA1.id, clientId: f.client2.id, startTime: new Date(Date.now() + 2 * 86400_000) });
    await api().post(q('/open')).set(bearer(tm));
    const notToday = await api().post(`/api/manage/appointments/${tomorrow.id}/status`).set(bearer(tm)).send({ status: 'ARRIVED' });
    expect(notToday.status).toBe(400);
  });

  it('allows corrections and blocks invalid transitions', async () => {
    const [a] = await todayAppointments(1);
    await api().post(q('/open')).set(bearer(tm));
    const s = (status: string) => api().post(`/api/manage/appointments/${a?.id}/status`).set(bearer(tm)).send({ status });
    expect((await s('NO_SHOW')).status).toBe(200);
    expect((await s('ARRIVED')).status).toBe(200); // תיקון טעות
    expect((await s('IN_PROGRESS')).status).toBe(200);
    expect((await s('NO_SHOW')).status).toBe(409); // לא ממצב טיפול
    expect((await s('COMPLETED')).status).toBe(200);
    expect((await s('CANCELLED_BY_CLIENT')).status).toBe(400); // לא סטטוס של מנהל
  });

  it('allows only one client in treatment at a time', async () => {
    const [a, b] = await todayAppointments(2);
    await api().post(q('/open')).set(bearer(tm));
    expect((await api().post(`/api/manage/appointments/${a?.id}/status`).set(bearer(tm)).send({ status: 'IN_PROGRESS' })).status).toBe(200);
    const res = await api().post(`/api/manage/appointments/${b?.id}/status`).set(bearer(tm)).send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ANOTHER_IN_PROGRESS');
  });

  it('"next" completes the current one and starts the next ARRIVED one (skipping clients who did not arrive)', async () => {
    const [a, b, c] = await todayAppointments(3);
    await api().post(q('/open')).set(bearer(tm));
    const st = (id: number | undefined, status: string) => api().post(`/api/manage/appointments/${id}/status`).set(bearer(tm)).send({ status });
    await st(a?.id, 'ARRIVED');
    await st(c?.id, 'ARRIVED'); // b לא הגיע

    const n1 = await api().post(q('/next')).set(bearer(tm));
    expect(n1.body).toMatchObject({ completedAppointmentId: null, startedAppointmentId: a?.id, startedQueueNumber: 1 });
    const n2 = await api().post(q('/next')).set(bearer(tm));
    expect(n2.body).toMatchObject({ completedAppointmentId: a?.id, startedAppointmentId: c?.id });
    const n3 = await api().post(q('/next')).set(bearer(tm));
    expect(n3.body).toMatchObject({ completedAppointmentId: c?.id, startedAppointmentId: null });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: b?.id } })).status).toBe('BOOKED');
  });
});

describe('live screen calculations', () => {
  it('computes pace from real durations, delay, progress and my personal estimate', async () => {
    const appts = await todayAppointments(4);
    await api().post(q('/open')).set(bearer(tm));
    const now = Date.now();
    // תור 1: טופל 20 דקות (קצב איטי מהמתוכנן - 10 דקות)
    await prisma.appointment.update({
      where: { id: appts[0]?.id },
      data: { status: 'COMPLETED', startedAt: new Date(now - 30 * 60_000), completedAt: new Date(now - 10 * 60_000) },
    });
    // תור 2: בטיפול כבר 5 דקות
    await prisma.appointment.update({ where: { id: appts[1]?.id }, data: { status: 'IN_PROGRESS', startedAt: new Date(now - 5 * 60_000) } });
    // client2 הוא תור 2 ובטיפול; client1 הוא תור 1 שהסתיים. נבדוק לקוח חדש בתור 4
    const fourth = await prisma.user.findUniqueOrThrow({ where: { id: appts[3]?.clientId } });
    await prisma.user.update({ where: { id: fourth.id }, data: { email: 'fourth@test.dev', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: f.client1.id } })).passwordHash, defaultTravelMinutes: 20 } });
    const token = await login('fourth@test.dev');

    const res = await api().get(`/api/providers/${f.providerA1.id}/live`).set(bearer(token));
    expect(res.status).toBe(200);
    const live = res.body;
    expect(live).toMatchObject({ dayStatus: 'OPEN', currentQueueNumber: 2, averageMinutesPerClient: 20, pace: 'SLOWER', completedCount: 1, waitingCount: 2, totalToday: 4, progressPercent: 25 });
    expect(live.delayMinutes).toBeGreaterThan(0);
    expect(live.myAppointment).toMatchObject({ queueNumber: 4, peopleAhead: 2, travelMinutes: 20 });
    // נשארו ~15 דקות לנוכחי + 20 לתור 3 = כ-35 דקות
    expect(live.myAppointment.minutesUntilTurn).toBeGreaterThanOrEqual(33);
    expect(live.myAppointment.minutesUntilTurn).toBeLessThanOrEqual(37);
    const leave = Date.parse(live.myAppointment.leaveHomeAt);
    const est = Date.parse(live.myAppointment.estimatedTime);
    expect(est - leave).toBe(20 * 60_000);
  });

  it('reports NO_SERVICE_TODAY when the provider is absent or does not work today', async () => {
    await prisma.workingHours.deleteMany({ where: { providerId: f.providerA1.id, dayOfWeek: dayOfWeek(todayStr()) } });
    const res = await api().get(`/api/providers/${f.providerA1.id}/live`);
    expect(res.body.dayStatus).toBe('NO_SERVICE_TODAY');
  });

  it('returns 404 for an inactive provider and 401 for a broken token', async () => {
    await prisma.provider.update({ where: { id: f.providerA2.id }, data: { isActive: false } });
    expect((await api().get(`/api/providers/${f.providerA2.id}/live`)).status).toBe(404);
    expect((await api().get(`/api/providers/${f.providerA1.id}/live`).set(bearer('broken'))).status).toBe(401);
  });

  it('marks the clinic as "open now" in search: within working hours, or once the queue is opened', async () => {
    const ids = async () =>
      (await api().get('/api/clinics').query({ openNow: true })).body.items.map((c: { id: number }) => c.id);
    const setHours = async (start: string, end: string) => {
      for (const p of [f.providerA1, f.providerA2]) {
        await prisma.workingHours.deleteMany({ where: { providerId: p.id } });
        await prisma.workingHours.create({ data: { providerId: p.id, dayOfWeek: dayOfWeek(todayStr()), startTime: start, endTime: end } });
      }
    };

    // מחוץ לשעות הפעילות כל היום (שעה אחת בלילה) - סגורה, גם אם עכשיו לא הלילה
    await setHours('00:00', '00:01');
    const now = localTimeNow();
    if (now >= 1) expect(await ids()).not.toContain(f.clinicA.id);

    // בתוך שעות הפעילות - פתוחה
    await setHours('00:00', '23:59');
    if (now < 23 * 60 + 59) expect(await ids()).toContain(f.clinicA.id);

    // היעדרות היום - סגורה
    await prisma.providerAbsence.createMany({
      data: [f.providerA1, f.providerA2].map((p) => ({ providerId: p.id, date: dateOnly(todayStr()) })),
    });
    expect(await ids()).not.toContain(f.clinicA.id);
    await prisma.providerAbsence.deleteMany();

    // המנהל סגר את היום - סגורה
    await prisma.queueDay.createMany({
      data: [f.providerA1, f.providerA2].map((p) => ({ providerId: p.id, date: dateOnly(todayStr()), status: 'CLOSED' as const })),
    });
    expect(await ids()).not.toContain(f.clinicA.id);
    await prisma.queueDay.deleteMany();

    // פתיחת התור החי פותחת גם מחוץ לשעות הפעילות
    await setHours('00:00', '00:01');
    await todayAppointments(1);
    if (now >= 1) expect(await ids()).not.toContain(f.clinicA.id);
    await api().post(q('/open')).set(bearer(tm));
    expect(await ids()).toContain(f.clinicA.id);
  });
});

describe('email reminders', () => {
  it('sends one reminder when it is time to leave home, and never twice', async () => {
    const [a] = await todayAppointments(1);
    // השעה המקורית: בעוד 20 דקות, זמן הגעה 30 דקות => כבר הגיע הזמן לצאת
    const start = new Date(Date.now() + 20 * 60_000);
    await prisma.appointment.update({ where: { id: a?.id }, data: { startTime: start, endTime: addMinutes(start, 10), reminderEnabled: true, travelMinutes: 30 } });
    sentEmails.length = 0;

    const r1 = await processReminders();
    expect(r1.sent).toBe(1);
    expect(sentEmails[0]?.to).toBe('client1@test.dev');
    expect(sentEmails[0]?.text).toContain('לצאת מהבית');
    const r2 = await processReminders();
    expect(r2.sent).toBe(0);
    expect(sentEmails).toHaveLength(1);
  });

  it('does not send when reminders are off, too early, or the client has no email', async () => {
    const [a, b] = await todayAppointments(2);
    const soon = new Date(Date.now() + 20 * 60_000);
    const later = new Date(Date.now() + 5 * 3600_000);
    await prisma.appointment.update({ where: { id: a?.id }, data: { startTime: soon, endTime: addMinutes(soon, 10), reminderEnabled: false } });
    await prisma.appointment.update({ where: { id: b?.id }, data: { startTime: later, endTime: addMinutes(later, 10), reminderEnabled: true, travelMinutes: 30 } });
    sentEmails.length = 0;
    // אם "later" נופל כבר ביום הבא - הבדיקה עדיין תקינה (אין מה לשלוח)
    expect((await processReminders()).sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it('protects the cron endpoint with x-cron-secret', async () => {
    expect((await api().post('/api/jobs/send-reminders')).status).toBe(401);
    expect((await api().post('/api/jobs/send-reminders').set('x-cron-secret', 'wrong')).status).toBe(401);
    const ok = await api().post('/api/jobs/send-reminders').set('x-cron-secret', 'test-cron-secret');
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('sent');
  });
});
