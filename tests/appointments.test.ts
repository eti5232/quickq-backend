import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { sentEmails } from '../src/services/email.service.js';
import { api, bearer, createFixtures, futureSlot, insertAppointment, login, resetDb } from './helpers.js';

let f: Awaited<ReturnType<typeof createFixtures>>;
let t1: string; // client1
let t2: string; // client2
let tmA: string; // manager A
let tmB: string; // manager B

beforeEach(async () => {
  await resetDb();
  f = await createFixtures();
  t1 = await login('client1@test.dev');
  t2 = await login('client2@test.dev');
  tmA = await login('manager-a@test.dev');
  tmB = await login('manager-b@test.dev');
});

const book = (token: string, providerId: number, iso: string, extra: object = {}) =>
  api().post('/api/appointments').set(bearer(token)).send({ providerId, startTime: iso, ...extra });

describe('availability and slots', () => {
  it('lists free slots and removes a booked slot (publicly, without a token)', async () => {
    const s = futureSlot(3, '10:00');
    const before = await api().get(`/api/providers/${f.providerA1.id}/slots`).query({ date: s.date });
    expect(before.status).toBe(200);
    expect(before.body.slots.map((x: { time: string }) => x.time)).toContain('10:00');
    expect(before.body.slots).toHaveLength(72); // 12 שעות * 6 משבצות

    expect((await book(t1, f.providerA1.id, s.iso)).status).toBe(201);
    const after = await api().get(`/api/providers/${f.providerA1.id}/slots`).query({ date: s.date });
    expect(after.body.slots.map((x: { time: string }) => x.time)).not.toContain('10:00');
  });

  it('marks days in the month calendar: available, full, not working, absent, past', async () => {
    const day = futureSlot(4).date;
    await prisma.workingHours.deleteMany({ where: { providerId: f.providerA2.id } });
    await prisma.workingHours.create({ data: { providerId: f.providerA2.id, dayOfWeek: futureSlot(4).dayOfWeek, startTime: '09:00', endTime: '09:15' } });
    await insertAppointment({ providerId: f.providerA2.id, clientId: f.client2.id, startTime: new Date(futureSlot(4, '09:00').iso), minutes: 15 });
    await prisma.providerAbsence.create({ data: { providerId: f.providerA1.id, date: new Date(`${futureSlot(5).date}T00:00:00Z`) } });

    const month = day.slice(0, 7);
    const full = await api().get(`/api/providers/${f.providerA2.id}/availability`).query({ month });
    const status = (date: string) => full.body.days.find((d: { date: string }) => d.date === date)?.status;
    expect(status(day)).toBe('FULL');
    const other = await api().get(`/api/providers/${f.providerA1.id}/availability`).query({ month: futureSlot(5).date.slice(0, 7) });
    expect(other.body.days.find((d: { date: string }) => d.date === futureSlot(5).date).status).toBe('ABSENT');
    expect(other.body.days.find((d: { date: string }) => d.date === futureSlot(6).date).status).toBe('AVAILABLE');
  });

  it('validates query parameters', async () => {
    expect((await api().get(`/api/providers/${f.providerA1.id}/slots`).query({ date: 'nope' })).status).toBe(400);
    expect((await api().get(`/api/providers/${f.providerA1.id}/availability`).query({ month: '2026-13' })).status).toBe(400);
    expect((await api().get('/api/providers/99999/slots').query({ date: futureSlot(2).date })).status).toBe(404);
  });
});

describe('booking (create)', () => {
  it('books a slot for the token owner and returns the full appointment', async () => {
    const s = futureSlot(3, '10:20');
    const res = await book(t1, f.providerA1.id, s.iso, { reminderEnabled: true, travelMinutes: 25, notes: 'כאב' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'BOOKED', time: '10:20', date: s.date, reminderEnabled: true, travelMinutes: 25, source: 'ONLINE' });
    expect(res.body.provider.id).toBe(f.providerA1.id);
    expect(res.body.client).toBeUndefined();
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.clientId).toBe(f.client1.id);
  });

  it('ignores a clientId sent in the body (identity comes from the token)', async () => {
    const res = await book(t1, f.providerA1.id, futureSlot(3).iso, { clientId: f.client2.id });
    expect(res.status).toBe(201);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.id } })).clientId).toBe(f.client1.id);
  });

  it('requires a client token', async () => {
    expect((await api().post('/api/appointments').send({ providerId: f.providerA1.id, startTime: futureSlot(3).iso })).status).toBe(401);
    expect((await book(tmA, f.providerA1.id, futureSlot(3).iso)).status).toBe(403);
  });

  it('validates the body', async () => {
    expect((await api().post('/api/appointments').set(bearer(t1)).send({})).status).toBe(400);
    expect((await api().post('/api/appointments').set(bearer(t1)).send({ providerId: f.providerA1.id, startTime: 'tomorrow' })).status).toBe(400);
    expect((await book(t1, f.providerA1.id, futureSlot(3).iso, { notes: 'x'.repeat(501) })).status).toBe(400);
    expect((await book(t1, f.providerA1.id, futureSlot(3).iso, { travelMinutes: -5 })).status).toBe(400);
  });

  it('rejects past times, off-grid times, and times outside working hours', async () => {
    const past = await book(t1, f.providerA1.id, new Date(Date.now() - 3600_000).toISOString());
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('PAST_TIME');
    const offGrid = await book(t1, f.providerA1.id, futureSlot(3, '10:03').iso);
    expect(offGrid.body.error.code).toBe('INVALID_SLOT');
    const night = await book(t1, f.providerA1.id, futureSlot(3, '23:00').iso);
    expect(night.body.error.code).toBe('INVALID_SLOT');
  });

  it('rejects a slot beyond the clinic booking horizon', async () => {
    await prisma.clinic.update({ where: { id: f.clinicA.id }, data: { bookingHorizonDays: 10 } });
    const res = await book(t1, f.providerA1.id, futureSlot(20).iso);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BEYOND_HORIZON');
  });

  it('rejects a taken slot with 409 SLOT_TAKEN', async () => {
    const s = futureSlot(3, '11:00');
    expect((await book(t1, f.providerA1.id, s.iso)).status).toBe(201);
    const res = await book(t2, f.providerA1.id, s.iso);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
  });

  it('never double-books under concurrent requests', async () => {
    const s = futureSlot(3, '12:00');
    const results = await Promise.all([
      book(t1, f.providerA1.id, s.iso),
      book(t2, f.providerA1.id, s.iso),
      book(t1, f.providerA1.id, s.iso),
      book(t2, f.providerA1.id, s.iso),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
    expect(await prisma.appointment.count({ where: { providerId: f.providerA1.id, startTime: new Date(s.iso) } })).toBe(1);
  });

  it('blocks overlapping slots when the slot length changed (overlap, not just equal start)', async () => {
    // תור קיים 10:10-10:20. משבצות של 15 דקות: 10:00-10:15 ו-10:15-10:30 חופפות
    await insertAppointment({ providerId: f.providerA2.id, clientId: f.client2.id, startTime: new Date(futureSlot(3, '10:10').iso), minutes: 10 });
    const r1 = await book(t1, f.providerA2.id, futureSlot(3, '10:00').iso);
    const r2 = await book(t1, f.providerA2.id, futureSlot(3, '10:15').iso);
    expect(r1.status).toBe(409);
    expect(r2.status).toBe(409);
    const r3 = await book(t1, f.providerA2.id, futureSlot(3, '10:30').iso);
    expect(r3.status).toBe(201);
    const slots = await api().get(`/api/providers/${f.providerA2.id}/slots`).query({ date: futureSlot(3).date });
    const times = slots.body.slots.map((x: { time: string }) => x.time);
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('10:15');
  });

  it('enforces the per-provider future appointment limit (clinic setting)', async () => {
    expect((await book(t1, f.providerA1.id, futureSlot(3, '09:00').iso)).status).toBe(201);
    expect((await book(t1, f.providerA1.id, futureSlot(4, '09:00').iso)).status).toBe(201);
    const third = await book(t1, f.providerA1.id, futureSlot(5, '09:00').iso);
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('MAX_FUTURE_APPOINTMENTS');
    // אצל איש מקצוע אחר - מותר
    expect((await book(t1, f.providerA2.id, futureSlot(5, '09:00').iso)).status).toBe(201);
  });

  it('prevents overlapping appointments for the same client, even in different clinics', async () => {
    expect((await book(t1, f.providerA1.id, futureSlot(3, '10:00').iso)).status).toBe(201);
    const res = await book(t1, f.providerB1.id, futureSlot(3, '10:00').iso);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLIENT_OVERLAP');
  });

  it('rejects absent days and inactive providers/clinics', async () => {
    const s = futureSlot(3, '10:00');
    await prisma.providerAbsence.create({ data: { providerId: f.providerA1.id, date: new Date(`${s.date}T00:00:00Z`) } });
    expect((await book(t1, f.providerA1.id, s.iso)).body.error.code).toBe('PROVIDER_ABSENT');
    await prisma.provider.update({ where: { id: f.providerA2.id }, data: { isActive: false } });
    expect((await book(t1, f.providerA2.id, s.iso)).status).toBe(409);
    await prisma.clinic.update({ where: { id: f.clinicB.id }, data: { isActive: false } });
    expect((await book(t1, f.providerB1.id, s.iso)).status).toBe(409);
  });
});

describe('listing and privacy', () => {
  it('lists only my own appointments, with filtering by status group and date range', async () => {
    const a = (await book(t1, f.providerA1.id, futureSlot(3, '09:00').iso)).body;
    await book(t2, f.providerA1.id, futureSlot(3, '09:10').iso);
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(Date.now() - 86400_000 * 3), status: 'COMPLETED' });
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(8, '09:00').iso), status: 'CANCELLED_BY_CLIENT' });

    const upcoming = await api().get('/api/appointments/my').set(bearer(t1));
    expect(upcoming.body.items.map((x: { id: number }) => x.id)).toEqual([a.id]);
    const past = await api().get('/api/appointments/my').set(bearer(t1)).query({ status: 'past' });
    expect(past.body.items).toHaveLength(1);
    const cancelled = await api().get('/api/appointments/my').set(bearer(t1)).query({ status: 'cancelled' });
    expect(cancelled.body.items).toHaveLength(1);
    const all = await api().get('/api/appointments/my').set(bearer(t1)).query({ status: 'all' });
    expect(all.body.total).toBe(3);
    const ranged = await api().get('/api/appointments/my').set(bearer(t1)).query({ status: 'all', from: futureSlot(3).date, to: futureSlot(3).date });
    expect(ranged.body.items.map((x: { id: number }) => x.id)).toEqual([a.id]);
    expect((await api().get('/api/appointments/my').set(bearer(t1)).query({ status: 'weird' })).status).toBe(400);
  });

  it('hides other clients appointments (404) for get, update and cancel', async () => {
    const mine = (await book(t1, f.providerA1.id, futureSlot(3).iso)).body;
    expect((await api().get(`/api/appointments/${mine.id}`).set(bearer(t2))).status).toBe(404);
    expect((await api().patch(`/api/appointments/${mine.id}`).set(bearer(t2)).send({ notes: 'hack' })).status).toBe(404);
    expect((await api().post(`/api/appointments/${mine.id}/cancel`).set(bearer(t2)).send({})).status).toBe(404);
    expect((await api().get(`/api/appointments/${mine.id}`).set(bearer(t1))).status).toBe(200);
  });

  it('lets only the clinic manager of that clinic (and super admin) view an appointment, with client details', async () => {
    const mine = (await book(t1, f.providerA1.id, futureSlot(3).iso)).body;
    const asA = await api().get(`/api/appointments/${mine.id}`).set(bearer(tmA));
    expect(asA.status).toBe(200);
    expect(asA.body.client).toMatchObject({ fullName: 'לקוחה אחת', nationalId: '123456782' });
    expect((await api().get(`/api/appointments/${mine.id}`).set(bearer(tmB))).status).toBe(404);
    const admin = await login('admin@test.dev');
    expect((await api().get(`/api/appointments/${mine.id}`).set(bearer(admin))).status).toBe(200);
  });
});

describe('update (reschedule) and cancel', () => {
  it('reschedules to a free slot with the same provider, freeing the old slot', async () => {
    const a = (await book(t1, f.providerA1.id, futureSlot(3, '10:00').iso)).body;
    const res = await api().patch(`/api/appointments/${a.id}`).set(bearer(t1)).send({ startTime: futureSlot(3, '10:30').iso });
    expect(res.status).toBe(200);
    expect(res.body.time).toBe('10:30');
    expect((await book(t2, f.providerA1.id, futureSlot(3, '10:00').iso)).status).toBe(201);
  });

  it('rejects rescheduling into a taken slot, and to the same slot as another client', async () => {
    const a = (await book(t1, f.providerA1.id, futureSlot(3, '10:00').iso)).body;
    await book(t2, f.providerA1.id, futureSlot(3, '10:10').iso);
    const res = await api().patch(`/api/appointments/${a.id}`).set(bearer(t1)).send({ startTime: futureSlot(3, '10:10').iso });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
  });

  it('can move onto its own overlapping time (excludes itself from the check)', async () => {
    const a = (await book(t1, f.providerA2.id, futureSlot(3, '10:00').iso)).body;
    const res = await api().patch(`/api/appointments/${a.id}`).set(bearer(t1)).send({ startTime: futureSlot(3, '10:15').iso });
    expect(res.status).toBe(200);
  });

  it('refuses to reschedule after the change deadline, but still allows reminder/notes changes', async () => {
    await prisma.clinic.update({ where: { id: f.clinicA.id }, data: { changeDeadlineHours: 48 } });
    const a = (await book(t1, f.providerA1.id, futureSlot(1, '10:00').iso)).body;
    const res = await api().patch(`/api/appointments/${a.id}`).set(bearer(t1)).send({ startTime: futureSlot(3, '10:00').iso });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHANGE_DEADLINE_PASSED');
    const ok = await api().patch(`/api/appointments/${a.id}`).set(bearer(t1)).send({ reminderEnabled: true, travelMinutes: 50, notes: 'עדכון' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ reminderEnabled: true, travelMinutes: 50, notes: 'עדכון' });
  });

  it('cancels before the deadline without a late flag, and frees the slot', async () => {
    const s = futureSlot(5, '10:00');
    const a = (await book(t1, f.providerA1.id, s.iso)).body;
    const res = await api().post(`/api/appointments/${a.id}/cancel`).set(bearer(t1)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED_BY_CLIENT', isLateCancellation: false });
    expect((await book(t2, f.providerA1.id, s.iso)).status).toBe(201);
    // ביטול כפול
    expect((await api().post(`/api/appointments/${a.id}/cancel`).set(bearer(t1)).send({})).status).toBe(409);
  });

  it('marks a cancellation after the deadline as late (but still allows it)', async () => {
    await prisma.clinic.update({ where: { id: f.clinicA.id }, data: { changeDeadlineHours: 72 } });
    const a = (await book(t1, f.providerA1.id, futureSlot(1, '10:00').iso)).body;
    expect(a.cancellationWouldBeLate).toBe(true);
    const res = await api().post(`/api/appointments/${a.id}/cancel`).set(bearer(t1)).send({});
    expect(res.status).toBe(200);
    expect(res.body.isLateCancellation).toBe(true);
    // המנהל רואה את ספירת הביטולים המאוחרים
    const clients = await api().get('/api/manage/clients').set(bearer(tmA));
    expect(clients.body.items.find((c: { id: number }) => c.id === f.client1.id).lateCancellationCount).toBe(1);
  });

  it('lets the clinic manager cancel (not flagged late) and emails the client', async () => {
    const a = (await book(t1, f.providerA1.id, futureSlot(3).iso)).body;
    expect((await api().post(`/api/manage/appointments/${a.id}/cancel`).set(bearer(tmB)).send({})).status).toBe(404);
    sentEmails.length = 0;
    const res = await api().post(`/api/manage/appointments/${a.id}/cancel`).set(bearer(tmA)).send({ reason: 'הרופא חולה' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED_BY_CLINIC', isLateCancellation: false });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ to: 'client1@test.dev' });
    expect(sentEmails[0]?.text).toContain('הרופא חולה');
  });

  it('refuses to edit or cancel finished appointments', async () => {
    const done = await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3).iso), status: 'COMPLETED' });
    expect((await api().patch(`/api/appointments/${done.id}`).set(bearer(t1)).send({ notes: 'x' })).status).toBe(409);
    expect((await api().post(`/api/appointments/${done.id}/cancel`).set(bearer(t1)).send({})).status).toBe(409);
  });
});
