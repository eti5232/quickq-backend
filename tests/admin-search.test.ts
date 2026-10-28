import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { sentEmails } from '../src/services/email.service.js';
import { api, bearer, createFixtures, futureSlot, insertAppointment, login, resetDb } from './helpers.js';

let f: Awaited<ReturnType<typeof createFixtures>>;
let ta: string;

beforeEach(async () => {
  await resetDb();
  f = await createFixtures();
  ta = await login('admin@test.dev');
});

describe('public clinic search', () => {
  it('searches by clinic name and by provider name', async () => {
    expect((await api().get('/api/clinics').query({ q: 'קליניקה א' })).body.items.map((c: { id: number }) => c.id)).toEqual([f.clinicA.id]);
    expect((await api().get('/api/clinics').query({ q: 'ב1' })).body.items.map((c: { id: number }) => c.id)).toEqual([f.clinicB.id]);
  });

  it('filters by category and city, and hides inactive clinics', async () => {
    expect((await api().get('/api/clinics').query({ category: 'DENTAL' })).body.total).toBe(1);
    expect((await api().get('/api/clinics').query({ city: 'חיפה' })).body.items[0].id).toBe(f.clinicB.id);
    await prisma.clinic.update({ where: { id: f.clinicB.id }, data: { isActive: false } });
    expect((await api().get('/api/clinics')).body.total).toBe(1);
    expect((await api().get(`/api/clinics/${f.clinicB.id}`)).status).toBe(404);
    expect((await api().get('/api/clinics/cities')).body.cities).toEqual(['תל אביב']);
  });

  it('sorts by nearest available appointment and filters by availability this week', async () => {
    // קליניקה ב: תפוסה לגמרי ב-8 הימים הקרובים (שעות רק ביום אחד רחוק)
    await prisma.workingHours.deleteMany({ where: { providerId: f.providerB1.id } });
    const far = futureSlot(9);
    await prisma.workingHours.create({ data: { providerId: f.providerB1.id, dayOfWeek: far.dayOfWeek, startTime: '10:00', endTime: '12:00' } });
    // אותו יום בשבוע מופיע גם השבוע (בעוד יומיים) - שם הרופא נעדר
    await prisma.providerAbsence.create({ data: { providerId: f.providerB1.id, date: new Date(`${futureSlot(2).date}T00:00:00Z`) } });

    const sorted = await api().get('/api/clinics').query({ sort: 'nextAvailable' });
    expect(sorted.body.items.map((c: { id: number }) => c.id)).toEqual([f.clinicA.id, f.clinicB.id]);
    expect(sorted.body.items[0].nextAvailableSlot.startTime).toEqual(expect.any(String));

    const week = await api().get('/api/clinics').query({ hasAvailabilityThisWeek: true });
    expect(week.body.items.map((c: { id: number }) => c.id)).toEqual([f.clinicA.id]);
    const notWeek = await api().get('/api/clinics').query({ hasAvailabilityThisWeek: false });
    expect(notWeek.body.items.map((c: { id: number }) => c.id)).toEqual([f.clinicB.id]);
  });

  it('paginates and validates query values', async () => {
    const page = await api().get('/api/clinics').query({ pageSize: 1, page: 2 });
    expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    expect(page.body.items).toHaveLength(1);
    expect((await api().get('/api/clinics').query({ category: 'PIZZA' })).status).toBe(400);
    expect((await api().get('/api/clinics').query({ sort: 'price' })).status).toBe(400);
    expect((await api().get('/api/clinics').query({ openNow: 'maybe' })).status).toBe(400);
  });

  it('shows clinic details with active providers only', async () => {
    await prisma.provider.update({ where: { id: f.providerA2.id }, data: { isActive: false } });
    const res = await api().get(`/api/clinics/${f.clinicA.id}`);
    expect(res.body.providers.map((p: { id: number }) => p.id)).toEqual([f.providerA1.id]);
  });
});

describe('join requests flow', () => {
  const request = { clinicName: 'מרפאה חדשה', category: 'OTHER', city: 'נתניה', contactName: 'רון דהן', email: 'ron@test.dev', phone: '0549998887', message: 'שלום' };

  it('public form -> admin approves -> clinic + manager are created and can log in', async () => {
    const sent = await api().post('/api/join-requests').send(request);
    expect(sent.status).toBe(201);
    expect((await api().post('/api/join-requests').send({ ...request, category: 'BAD' })).status).toBe(400);

    const pending = await api().get('/api/admin/join-requests').set(bearer(ta)).query({ status: 'PENDING' });
    expect(pending.body.items).toHaveLength(1);

    sentEmails.length = 0;
    const approved = await api().post(`/api/admin/join-requests/${sent.body.id}/approve`).set(bearer(ta)).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.clinic).toMatchObject({ name: 'מרפאה חדשה', city: 'נתניה', isActive: true });
    expect(approved.body.manager).toMatchObject({ email: 'ron@test.dev', role: 'CLINIC_MANAGER', mustChangePassword: true });
    expect(sentEmails[0]?.text).toContain(approved.body.temporaryPassword);

    const login1 = await api().post('/api/auth/login').send({ email: 'ron@test.dev', password: approved.body.temporaryPassword });
    expect(login1.status).toBe(200);
    expect((await api().post(`/api/admin/join-requests/${sent.body.id}/approve`).set(bearer(ta)).send({})).status).toBe(409);
    expect((await prisma.joinRequest.findUniqueOrThrow({ where: { id: sent.body.id } })).status).toBe('APPROVED');
  });

  it('rejects approval when the email is taken, and allows an override email', async () => {
    const sent = await api().post('/api/join-requests').send({ ...request, email: 'client1@test.dev' });
    const res = await api().post(`/api/admin/join-requests/${sent.body.id}/approve`).set(bearer(ta)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.clinic.count()).toBe(2); // לא נוצרה קליניקה חלקית
    const ok = await api().post(`/api/admin/join-requests/${sent.body.id}/approve`).set(bearer(ta)).send({ email: 'other@test.dev' });
    expect(ok.status).toBe(201);
  });

  it('rejects a request and emails the contact', async () => {
    const sent = await api().post('/api/join-requests').send(request);
    sentEmails.length = 0;
    const res = await api().post(`/api/admin/join-requests/${sent.body.id}/reject`).set(bearer(ta)).send({ reason: 'חסרים פרטים' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectReason: 'חסרים פרטים' });
    expect(sentEmails[0]?.to).toBe('ron@test.dev');
  });
});

describe('admin clinics and users', () => {
  it('creates a clinic manually with a manager', async () => {
    const res = await api()
      .post('/api/admin/clinics')
      .set(bearer(ta))
      .send({ name: 'מרפאת הגליל', category: 'GENERAL_MEDICINE', city: 'צפת', address: 'ירושלים 5', phone: '046661234', manager: { fullName: 'אלון ברגר', email: 'alon@test.dev', phone: '0507778899' } });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    const list = await api().get('/api/admin/clinics').set(bearer(ta)).query({ q: 'הגליל' });
    expect(list.body.items[0]).toMatchObject({ name: 'מרפאת הגליל', staffCount: 1, providersCount: 0 });
  });

  it('deactivating a clinic needs confirmation, cancels future appointments and blocks its managers', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3).iso) });
    const tm = await login('manager-a@test.dev');
    expect((await api().patch(`/api/admin/clinics/${f.clinicA.id}`).set(bearer(ta)).send({ isActive: false })).status).toBe(409);
    const ok = await api().patch(`/api/admin/clinics/${f.clinicA.id}`).set(bearer(ta)).send({ isActive: false, cancelFutureAppointments: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ isActive: false, cancelledAppointments: 1 });
    expect((await api().get('/api/manage/clinic').set(bearer(tm))).status).toBe(403);
    const inactive = await api().get('/api/admin/clinics').set(bearer(ta)).query({ isActive: false });
    expect(inactive.body.items.map((c: { id: number }) => c.id)).toEqual([f.clinicA.id]);
    // הפעלה מחדש
    expect((await api().patch(`/api/admin/clinics/${f.clinicA.id}`).set(bearer(ta)).send({ isActive: true })).body.isActive).toBe(true);
  });

  it('lists and searches users, fixes details, cannot change roles or deactivate self', async () => {
    const clients = await api().get('/api/admin/users').set(bearer(ta)).query({ role: 'CLIENT' });
    expect(clients.body.total).toBe(2);
    expect((await api().get('/api/admin/users').set(bearer(ta)).query({ q: '123456782' })).body.items[0].id).toBe(f.client1.id);

    const fixed = await api().patch(`/api/admin/users/${f.client1.id}`).set(bearer(ta)).send({ email: 'fixed@test.dev', role: 'SUPER_ADMIN' });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ email: 'fixed@test.dev', role: 'CLIENT' });
    expect((await api().patch(`/api/admin/users/${f.admin.id}`).set(bearer(ta)).send({ isActive: false })).status).toBe(400);
    expect((await api().patch(`/api/admin/users/${f.managerA.id}`).set(bearer(ta)).send({ nationalId: '000000042' })).status).toBe(400);
    expect((await api().patch(`/api/admin/users/${f.client2.id}`).set(bearer(ta)).send({ email: 'fixed@test.dev' })).status).toBe(409);
  });

  it('deactivating a client with future appointments requires confirmation', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client2.id, startTime: new Date(futureSlot(3).iso) });
    expect((await api().patch(`/api/admin/users/${f.client2.id}`).set(bearer(ta)).send({ isActive: false })).status).toBe(409);
    const ok = await api().patch(`/api/admin/users/${f.client2.id}`).set(bearer(ta)).send({ isActive: false, cancelFutureAppointments: true });
    expect(ok.body).toMatchObject({ isActive: false, cancelledAppointments: 1 });
    expect((await api().post('/api/auth/login').send({ email: 'client2@test.dev', password: 'Passw0rd!' })).status).toBe(403);
  });

  it('resets a user password to a temporary one', async () => {
    const res = await api().post(`/api/admin/users/${f.client1.id}/reset-password`).set(bearer(ta));
    expect(res.status).toBe(200);
    const l = await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: res.body.temporaryPassword });
    expect(l.body.user.mustChangePassword).toBe(true);
    expect((await api().post(`/api/admin/users/${f.admin.id}/reset-password`).set(bearer(ta))).status).toBe(400);
  });
});
