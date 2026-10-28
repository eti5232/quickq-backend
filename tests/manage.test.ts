import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { sentEmails } from '../src/services/email.service.js';
import { api, bearer, createFixtures, futureSlot, insertAppointment, login, resetDb } from './helpers.js';

let f: Awaited<ReturnType<typeof createFixtures>>;
let tm: string;

beforeEach(async () => {
  await resetDb();
  f = await createFixtures();
  tm = await login('manager-a@test.dev');
});

describe('clinic settings', () => {
  it('reads and updates own clinic settings with validation', async () => {
    expect((await api().get('/api/manage/clinic').set(bearer(tm))).body.id).toBe(f.clinicA.id);
    const res = await api().patch('/api/manage/clinic').set(bearer(tm)).send({ changeDeadlineHours: 24, maxFutureAppointmentsPerProvider: 3 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ changeDeadlineHours: 24, maxFutureAppointmentsPerProvider: 3 });
    expect((await api().patch('/api/manage/clinic').set(bearer(tm)).send({ changeDeadlineHours: 999 })).status).toBe(400);
    expect((await api().patch('/api/manage/clinic').set(bearer(tm)).send({ isActive: false })).status).toBe(400);
  });
});

describe('providers CRUD', () => {
  it('creates, lists and edits providers', async () => {
    const created = await api().post('/api/manage/providers').set(bearer(tm)).send({ fullName: 'ד"ר חדשה', specialty: 'ילדים', slotMinutes: 20 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ fullName: 'ד"ר חדשה', slotMinutes: 20, clinicId: f.clinicA.id, isActive: true });
    const list = await api().get('/api/manage/providers').set(bearer(tm));
    expect(list.body.items).toHaveLength(3);
    const edited = await api().patch(`/api/manage/providers/${created.body.id}`).set(bearer(tm)).send({ slotMinutes: 30 });
    expect(edited.body.slotMinutes).toBe(30);
    expect((await api().post('/api/manage/providers').set(bearer(tm)).send({ fullName: 'x', slotMinutes: 3 })).status).toBe(400);
  });

  it('requires explicit confirmation to deactivate a provider with future appointments, then cancels and emails', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3).iso) });
    const blocked = await api().patch(`/api/manage/providers/${f.providerA1.id}`).set(bearer(tm)).send({ isActive: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toEqual({ futureAppointments: 1 });
    sentEmails.length = 0;
    const ok = await api().patch(`/api/manage/providers/${f.providerA1.id}`).set(bearer(tm)).send({ isActive: false, cancelFutureAppointments: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ isActive: false, cancelledAppointments: 1 });
    expect(sentEmails).toHaveLength(1);
  });
});

describe('working hours', () => {
  it('replaces the weekly schedule and warns about appointments left outside the new hours', async () => {
    const s = futureSlot(3, '18:00');
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(s.iso) });
    const res = await api()
      .put(`/api/manage/providers/${f.providerA1.id}/working-hours`)
      .set(bearer(tm))
      .send({ hours: [{ dayOfWeek: s.dayOfWeek, startTime: '08:00', endTime: '12:00' }, { dayOfWeek: s.dayOfWeek, startTime: '14:00', endTime: '16:00' }] });
    expect(res.status).toBe(200);
    expect(res.body.hours).toHaveLength(2);
    expect(res.body.warning.appointmentIds).toHaveLength(1);
    // התור לא בוטל
    expect(await prisma.appointment.count({ where: { status: 'BOOKED' } })).toBe(1);
    // משבצות חדשות - רק בשעות החדשות
    const slots = await api().get(`/api/providers/${f.providerA1.id}/slots`).query({ date: s.date });
    const times = slots.body.slots.map((x: { time: string }) => x.time);
    expect(times).toContain('14:00');
    expect(times).not.toContain('13:00');
  });

  it('rejects overlapping or reversed ranges', async () => {
    const url = `/api/manage/providers/${f.providerA1.id}/working-hours`;
    expect((await api().put(url).set(bearer(tm)).send({ hours: [{ dayOfWeek: 1, startTime: '10:00', endTime: '09:00' }] })).status).toBe(400);
    expect((await api().put(url).set(bearer(tm)).send({ hours: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }, { dayOfWeek: 1, startTime: '11:00', endTime: '13:00' }] })).status).toBe(400);
    expect((await api().put(url).set(bearer(tm)).send({ hours: [{ dayOfWeek: 7, startTime: '09:00', endTime: '12:00' }] })).status).toBe(400);
  });
});

describe('absences', () => {
  it('adding an absence cancels that day and emails clients; duplicates are rejected', async () => {
    const s = futureSlot(4, '10:00');
    const appt = await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(s.iso) });
    const other = await insertAppointment({ providerId: f.providerA1.id, clientId: f.client2.id, startTime: new Date(futureSlot(5, '10:00').iso) });
    sentEmails.length = 0;
    const res = await api().post(`/api/manage/providers/${f.providerA1.id}/absences`).set(bearer(tm)).send({ date: s.date, reason: 'מחלה' });
    expect(res.status).toBe(201);
    expect(res.body.cancelledAppointments).toBe(1);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('CANCELLED_BY_CLINIC');
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('BOOKED');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.text).toContain('מחלה');
    expect((await api().post(`/api/manage/providers/${f.providerA1.id}/absences`).set(bearer(tm)).send({ date: s.date })).status).toBe(409);

    const list = await api().get(`/api/manage/providers/${f.providerA1.id}/absences`).set(bearer(tm));
    expect(list.body.items).toHaveLength(1);
    expect((await api().delete(`/api/manage/absences/${res.body.absence.id}`).set(bearer(tm))).status).toBe(204);
  });

  it('rejects past dates and supports a clinic-wide absence', async () => {
    expect((await api().post(`/api/manage/providers/${f.providerA1.id}/absences`).set(bearer(tm)).send({ date: '2020-01-01' })).status).toBe(400);
    const d = futureSlot(6).date;
    const res = await api().post('/api/manage/absences').set(bearer(tm)).send({ date: d, reason: 'חג' });
    expect(res.status).toBe(201);
    expect(res.body.absences).toHaveLength(2); // שני הרופאים של קליניקה א
    expect(await prisma.providerAbsence.count({ where: { providerId: f.providerB1.id } })).toBe(0);
  });
});

describe('manager bookings and calendar', () => {
  it('books for a brand-new phone client (no password), and reuses an existing client by id number', async () => {
    const r1 = await api()
      .post('/api/manage/appointments')
      .set(bearer(tm))
      .send({ providerId: f.providerA1.id, startTime: futureSlot(3, '10:00').iso, client: { fullName: 'משה טלפוני', phone: '0537777777', nationalId: '000000042' } });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ source: 'CLINIC', clientCreated: true });
    expect(r1.body.client.isRegistered).toBe(false);

    const r2 = await api()
      .post('/api/manage/appointments')
      .set(bearer(tm))
      .send({ providerId: f.providerA1.id, startTime: futureSlot(4, '10:00').iso, client: { fullName: 'שם אחר', phone: '0537777777', nationalId: '000000042' } });
    expect(r2.status).toBe(201);
    expect(r2.body.clientCreated).toBe(false);
    expect(r2.body.client.id).toBe(r1.body.client.id);

    // לקוח שנוסף טלפונית - המנהל יכול לערוך אותו
    const edit = await api().patch(`/api/manage/clients/${r1.body.client.id}`).set(bearer(tm)).send({ phone: '0537777778' });
    expect(edit.status).toBe(200);
    expect(edit.body.phone).toBe('0537777778');
  });

  it('requires exactly one of clientId / client', async () => {
    const base = { providerId: f.providerA1.id, startTime: futureSlot(3).iso };
    expect((await api().post('/api/manage/appointments').set(bearer(tm)).send(base)).status).toBe(400);
    expect(
      (await api().post('/api/manage/appointments').set(bearer(tm)).send({ ...base, clientId: f.client1.id, client: { fullName: 'x y', phone: '0501111111', nationalId: '000000042' } })).status,
    ).toBe(400);
  });

  it('is not limited by the client future-appointment limit, but still prevents double booking', async () => {
    for (const d of [3, 4, 5]) {
      const r = await api().post('/api/manage/appointments').set(bearer(tm)).send({ providerId: f.providerA1.id, startTime: futureSlot(d).iso, clientId: f.client1.id });
      expect(r.status).toBe(201);
    }
    const dup = await api().post('/api/manage/appointments').set(bearer(tm)).send({ providerId: f.providerA1.id, startTime: futureSlot(3).iso, clientId: f.client2.id });
    expect(dup.status).toBe(409);
  });

  it('filters the calendar by provider, date, status and client search, and reschedules', async () => {
    const a = await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3, '10:00').iso) });
    await insertAppointment({ providerId: f.providerA2.id, clientId: f.client2.id, startTime: new Date(futureSlot(3, '11:00').iso), minutes: 15 });
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client2.id, startTime: new Date(futureSlot(4, '10:00').iso), status: 'CANCELLED_BY_CLIENT' });
    const get = (query: Record<string, string | number>) => api().get('/api/manage/appointments').set(bearer(tm)).query(query);
    expect((await get({})).body.total).toBe(3);
    expect((await get({ providerId: f.providerA1.id })).body.total).toBe(2);
    expect((await get({ date: futureSlot(3).date })).body.total).toBe(2);
    expect((await get({ status: 'CANCELLED_BY_CLIENT' })).body.total).toBe(1);
    expect((await get({ q: 'לקוחה' })).body.total).toBe(1);
    expect((await get({ q: '0522222222' })).body.total).toBe(2);

    const moved = await api().patch(`/api/manage/appointments/${a.id}`).set(bearer(tm)).send({ startTime: futureSlot(3, '12:00').iso, notes: 'הוזז' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ time: '12:00', notes: 'הוזז' });
  });
});

describe('staff', () => {
  it('adds a staff member with a temporary password and can deactivate them (not self)', async () => {
    sentEmails.length = 0;
    const res = await api().post('/api/manage/staff').set(bearer(tm)).send({ fullName: 'מזכירה חדשה', email: 'sec@test.dev', phone: '0501231234' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'CLINIC_MANAGER', clinicId: f.clinicA.id, mustChangePassword: true });
    expect(sentEmails[0]?.text).toContain(res.body.temporaryPassword);

    const login1 = await api().post('/api/auth/login').send({ email: 'sec@test.dev', password: res.body.temporaryPassword });
    expect(login1.body.user.mustChangePassword).toBe(true);

    expect((await api().post('/api/manage/staff').set(bearer(tm)).send({ fullName: 'כפול', email: 'sec@test.dev', phone: '0501231234' })).status).toBe(409);
    expect((await api().patch(`/api/manage/staff/${res.body.user.id}`).set(bearer(tm)).send({ isActive: false })).body.isActive).toBe(false);
    expect((await api().patch(`/api/manage/staff/${f.managerA.id}`).set(bearer(tm)).send({ isActive: false })).status).toBe(400);
    expect((await api().patch(`/api/manage/staff/${f.managerB.id}`).set(bearer(tm)).send({ isActive: false })).status).toBe(404);
    expect((await api().get('/api/manage/staff').set(bearer(tm))).body.items).toHaveLength(2);
  });
});

describe('CSV import', () => {
  const upload = (csv: string | Buffer) =>
    api().post('/api/manage/appointments/import').set(bearer(tm)).attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8'), 'import.csv');
  const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');

  it('imports valid rows, reports invalid ones, creates and reuses clients', async () => {
    const d1 = ddmmyyyy(futureSlot(3).date);
    const d2 = ddmmyyyy(futureSlot(4).date);
    const csv = [
      'תאריך,שעה,רופא,שם לקוח,טלפון,תעודת זהות,מייל',
      `${d1},09:00,"ד""ר א1",משה כהן,0501234567,000000042,`,
      `${d1},09:00,"ד""ר א1",מישהו אחר,0501234568,000000034,`, // התנגשות
      `${d2},07:13,"ד""ר א2",לקוחה אחת,0521111111,123456782,client1@test.dev`, // מחוץ לשעות - מותר בייבוא
      `${d2},10:00,ד"ר לא קיים,דן,0501234569,000000026,`,
      `31/02/2027,10:00,"ד""ר א1",דן,0501234569,000000026,`,
      `${d2},10:00,"ד""ר א1",דן,0501234569,123456789,`,
      `${d2},10:00,"ד""ר א1",דן,12,000000026,`,
    ].join('\r\n');
    const res = await upload(csv);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 7, imported: 2, failed: 5, createdClients: 1 });
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 5, 6, 7, 8]);
    const imported = await prisma.appointment.findMany({ where: { source: 'IMPORT' }, include: { client: true } });
    expect(imported).toHaveLength(2);
    expect(imported.find((a) => a.client.nationalId === '123456782')?.clientId).toBe(f.client1.id);
  });

  it('accepts English headers, semicolons and Windows-1255 encoding', async () => {
    const iconv = (await import('iconv-lite')).default;
    const d = ddmmyyyy(futureSlot(3).date);
    const csv = ['date;time;provider;clientName;phone;nationalId', `${d};11:00;ד"ר א1;רחל;0501112222;000000042`].join('\n');
    const res = await upload(iconv.encode(csv, 'win1255'));
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    const client = await prisma.user.findUniqueOrThrow({ where: { nationalId: '000000042' } });
    expect(client.fullName).toBe('רחל');
  });

  it('rejects files without required columns, empty files and missing file', async () => {
    const missing = await upload('תאריך,שעה\n01/01/2030,10:00');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('MISSING_COLUMNS');
    expect((await upload('')).status).toBe(400);
    expect((await api().post('/api/manage/appointments/import').set(bearer(tm))).status).toBe(400);
  });

  it('provides a downloadable template that itself imports cleanly', async () => {
    const tpl = await api().get('/api/manage/appointments/import/template').set(bearer(tm));
    expect(tpl.status).toBe(200);
    expect(tpl.headers['content-type']).toContain('text/csv');
    const res = await upload(tpl.text);
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(0);
    expect(res.body.imported).toBe(3);
  });
});
