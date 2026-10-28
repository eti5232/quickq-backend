import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { api, bearer, createFixtures, futureSlot, insertAppointment, login, resetDb } from './helpers.js';

let f: Awaited<ReturnType<typeof createFixtures>>;
let tokens: { admin: string; managerA: string; managerB: string; client: string };

beforeEach(async () => {
  await resetDb();
  f = await createFixtures();
  tokens = {
    admin: await login('admin@test.dev'),
    managerA: await login('manager-a@test.dev'),
    managerB: await login('manager-b@test.dev'),
    client: await login('client1@test.dev'),
  };
});

/** כל נתיבי הניהול והאדמין: בלי Token = 401, עם תפקיד לא מתאים = 403 */
const managerRoutes: [string, string][] = [
  ['get', '/api/manage/clinic'],
  ['patch', '/api/manage/clinic'],
  ['get', '/api/manage/providers'],
  ['post', '/api/manage/providers'],
  ['patch', '/api/manage/providers/1'],
  ['get', '/api/manage/providers/1/working-hours'],
  ['put', '/api/manage/providers/1/working-hours'],
  ['get', '/api/manage/providers/1/absences'],
  ['post', '/api/manage/providers/1/absences'],
  ['post', '/api/manage/absences'],
  ['delete', '/api/manage/absences/1'],
  ['get', '/api/manage/providers/1/queue'],
  ['post', '/api/manage/providers/1/queue/open'],
  ['post', '/api/manage/providers/1/queue/pause'],
  ['post', '/api/manage/providers/1/queue/resume'],
  ['post', '/api/manage/providers/1/queue/close'],
  ['post', '/api/manage/providers/1/queue/next'],
  ['get', '/api/manage/appointments'],
  ['post', '/api/manage/appointments'],
  ['patch', '/api/manage/appointments/1'],
  ['post', '/api/manage/appointments/1/cancel'],
  ['post', '/api/manage/appointments/1/status'],
  ['post', '/api/manage/appointments/import'],
  ['get', '/api/manage/appointments/import/template'],
  ['get', '/api/manage/clients'],
  ['patch', '/api/manage/clients/1'],
  ['get', '/api/manage/staff'],
  ['post', '/api/manage/staff'],
  ['patch', '/api/manage/staff/1'],
];
const adminRoutes: [string, string][] = [
  ['get', '/api/admin/join-requests'],
  ['post', '/api/admin/join-requests/1/approve'],
  ['post', '/api/admin/join-requests/1/reject'],
  ['get', '/api/admin/clinics'],
  ['post', '/api/admin/clinics'],
  ['patch', '/api/admin/clinics/1'],
  ['get', '/api/admin/users'],
  ['patch', '/api/admin/users/1'],
  ['post', '/api/admin/users/1/reset-password'],
];
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (method: string, url: string) => api()[method as Method](url);

describe('role protection', () => {
  it.each(managerRoutes)('manager route %s %s: 401 without token', async (method, url) => {
    expect((await call(method, url)).status).toBe(401);
  });
  it.each(adminRoutes)('admin route %s %s: 401 without token', async (method, url) => {
    expect((await call(method, url)).status).toBe(401);
  });
  it.each(managerRoutes)('manager route %s %s: 403 for client and super admin', async (method, url) => {
    expect((await call(method, url).set(bearer(tokens.client))).status).toBe(403);
    expect((await call(method, url).set(bearer(tokens.admin))).status).toBe(403);
  });
  it.each(adminRoutes)('admin route %s %s: 403 for client and clinic manager', async (method, url) => {
    expect((await call(method, url).set(bearer(tokens.client))).status).toBe(403);
    expect((await call(method, url).set(bearer(tokens.managerA))).status).toBe(403);
  });
  it('client-only routes reject managers and admin', async () => {
    expect((await api().get('/api/appointments/my').set(bearer(tokens.managerA))).status).toBe(403);
    expect((await api().get('/api/appointments/my').set(bearer(tokens.admin))).status).toBe(403);
    expect((await api().get('/api/appointments/my')).status).toBe(401);
  });
});

describe('clinic isolation (a manager can never touch another clinic)', () => {
  it('returns 404 for providers, queue, hours, absences of another clinic', async () => {
    const other = f.providerB1.id; // שייך לקליניקה ב
    const h = bearer(tokens.managerA);
    expect((await api().patch(`/api/manage/providers/${other}`).set(h).send({ fullName: 'פריצה' })).status).toBe(404);
    expect((await api().get(`/api/manage/providers/${other}/working-hours`).set(h)).status).toBe(404);
    expect((await api().put(`/api/manage/providers/${other}/working-hours`).set(h).send({ hours: [] })).status).toBe(404);
    expect((await api().get(`/api/manage/providers/${other}/absences`).set(h)).status).toBe(404);
    expect((await api().post(`/api/manage/providers/${other}/absences`).set(h).send({ date: futureSlot(5).date })).status).toBe(404);
    expect((await api().get(`/api/manage/providers/${other}/queue`).set(h)).status).toBe(404);
    expect((await api().post(`/api/manage/providers/${other}/queue/open`).set(h)).status).toBe(404);
    expect((await api().post(`/api/manage/providers/${other}/queue/next`).set(h)).status).toBe(404);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: other } })).fullName).toBe('ד"ר ב1');
  });

  it('hides appointments, clients and absences of other clinics', async () => {
    const appt = await insertAppointment({ providerId: f.providerB1.id, clientId: f.client2.id, startTime: new Date(futureSlot(3).iso) });
    const absence = await prisma.providerAbsence.create({ data: { providerId: f.providerB1.id, date: new Date(`${futureSlot(9).date}T00:00:00Z`) } });
    const h = bearer(tokens.managerA);

    const list = await api().get('/api/manage/appointments').set(h);
    expect(list.body.items).toHaveLength(0);
    expect((await api().patch(`/api/manage/appointments/${appt.id}`).set(h).send({ notes: 'x' })).status).toBe(404);
    expect((await api().post(`/api/manage/appointments/${appt.id}/status`).set(h).send({ status: 'ARRIVED' })).status).toBe(404);
    expect((await api().delete(`/api/manage/absences/${absence.id}`).set(h)).status).toBe(404);
    expect(await prisma.providerAbsence.count()).toBe(1);

    const clients = await api().get('/api/manage/clients').set(h);
    expect(clients.body.items).toHaveLength(0);
    expect((await api().patch(`/api/manage/clients/${f.client2.id}`).set(h).send({ phone: '0500000009' })).status).toBe(404);

    const own = await api().get('/api/manage/appointments').set(bearer(tokens.managerB));
    expect(own.body.items).toHaveLength(1);
  });

  it('refuses to book a manager appointment onto another clinic provider', async () => {
    const res = await api()
      .post('/api/manage/appointments')
      .set(bearer(tokens.managerA))
      .send({ providerId: f.providerB1.id, startTime: futureSlot(3).iso, clientId: f.client1.id });
    expect(res.status).toBe(404);
  });

  it('does not let a manager edit a registered client (they manage themselves)', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3).iso) });
    const res = await api().patch(`/api/manage/clients/${f.client1.id}`).set(bearer(tokens.managerA)).send({ phone: '0509999999' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CLIENT_SELF_MANAGED');
  });
});

describe('data exposure', () => {
  it('never leaks password hashes anywhere', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3).iso) });
    const bodies = [
      (await api().get('/api/admin/users').set(bearer(tokens.admin))).body,
      (await api().get('/api/manage/clients').set(bearer(tokens.managerA))).body,
      (await api().get('/api/manage/staff').set(bearer(tokens.managerA))).body,
      (await api().get('/api/manage/appointments').set(bearer(tokens.managerA))).body,
      (await api().get('/api/auth/me').set(bearer(tokens.client))).body,
    ];
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(/passwordHash/);
    expect(text).not.toMatch(/\$2[aby]\$/);
  });

  it('keeps the public live screen free of names and personal data', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(), status: 'IN_PROGRESS', queueNumber: 1 });
    const res = await api().get(`/api/providers/${f.providerA1.id}/live`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('לקוחה אחת');
    expect(text).not.toContain('123456782');
    expect(text).not.toContain('0521111111');
    expect(res.body.myAppointment).toBeNull();
  });

  it('only exposes the national id to the owner, their clinic manager and the super admin', async () => {
    await insertAppointment({ providerId: f.providerA1.id, clientId: f.client1.id, startTime: new Date(futureSlot(3).iso) });
    const mine = await api().get('/api/appointments/my').set(bearer(tokens.client));
    expect(JSON.stringify(mine.body)).not.toContain('123456782'); // מידע על הלקוח לא נכלל בתשובה ללקוח
    const clinicsPublic = await api().get('/api/clinics');
    expect(JSON.stringify(clinicsPublic.body)).not.toContain('123456782');
  });
});

describe('error format and misc', () => {
  it('returns a consistent JSON 404 for unknown routes and invalid ids', async () => {
    const res = await api().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect((await api().get('/api/clinics/abc')).status).toBe(400);
  });

  it('returns 400 INVALID_JSON for a broken body', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('exposes /api/health with database status', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('sets CORS headers for allowed origins', async () => {
    const res = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
