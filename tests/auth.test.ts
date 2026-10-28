import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { sentEmails } from '../src/services/email.service.js';
import { api, bearer, createFixtures, login, PASSWORD, resetDb } from './helpers.js';

let f: Awaited<ReturnType<typeof createFixtures>>;
beforeEach(async () => {
  await resetDb();
  f = await createFixtures();
});

describe('POST /api/auth/login', () => {
  it('returns a JWT and the user (without password data) on valid credentials', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ id: f.client1.id, role: 'CLIENT', email: 'client1@test.dev' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('rejects a wrong password and an unknown email with the same 401', async () => {
    const wrong = await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: 'WrongPass1' });
    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@test.dev', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('validates the request body', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('blocks inactive users and users of inactive clinics', async () => {
    await prisma.user.update({ where: { id: f.client1.id }, data: { isActive: false } });
    expect((await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: PASSWORD })).status).toBe(403);
    await prisma.clinic.update({ where: { id: f.clinicA.id }, data: { isActive: false } });
    expect((await api().post('/api/auth/login').send({ email: 'manager-a@test.dev', password: PASSWORD })).status).toBe(403);
  });
});

describe('token handling', () => {
  it('returns 401 without a token', async () => {
    const res = await api().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed token', async () => {
    const res = await api().get('/api/auth/me').set(bearer('not.a.jwt'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a token signed with another secret', async () => {
    const forged = jwt.sign({ role: 'SUPER_ADMIN' }, 'some-other-secret-some-other-secret!!', { subject: String(f.client1.id) });
    expect((await api().get('/api/auth/me').set(bearer(forged))).status).toBe(401);
  });

  it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
    const expired = jwt.sign({ role: 'CLIENT' }, process.env.JWT_SECRET as string, { subject: String(f.client1.id), expiresIn: -10 });
    const res = await api().get('/api/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('takes the role from the database, not from the token claim', async () => {
    const lying = jwt.sign({ role: 'SUPER_ADMIN' }, process.env.JWT_SECRET as string, { subject: String(f.client1.id), expiresIn: '1h' });
    const res = await api().get('/api/admin/users').set(bearer(lying));
    expect(res.status).toBe(403);
  });

  it('rejects a still-valid token immediately after the user is deactivated', async () => {
    const token = await login('client1@test.dev');
    expect((await api().get('/api/auth/me').set(bearer(token))).status).toBe(200);
    await prisma.user.update({ where: { id: f.client1.id }, data: { isActive: false } });
    const res = await api().get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the logged-in user', async () => {
    const token = await login('manager-a@test.dev');
    const res = await api().get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'CLINIC_MANAGER', clinicId: f.clinicA.id, clinic: { name: 'קליניקה א' } });
    expect(res.body.passwordHash).toBeUndefined();
  });
});

describe('POST /api/auth/register', () => {
  const valid = { fullName: 'ישראל ישראלי', email: 'New@Test.dev', phone: '050-123-4567', nationalId: '000000026', password: 'Secret123' };

  it('registers a client, normalizes data and returns a working token', async () => {
    const res = await api().post('/api/auth/register').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'CLIENT', email: 'new@test.dev', phone: '0501234567' });
    const me = await api().get('/api/auth/me').set(bearer(res.body.token));
    expect(me.status).toBe(200);
  });

  it('never lets a client choose their role', async () => {
    const res = await api().post('/api/auth/register').send({ ...valid, role: 'SUPER_ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CLIENT');
  });

  it('validates id number, weak password and phone', async () => {
    expect((await api().post('/api/auth/register').send({ ...valid, nationalId: '123456789' })).status).toBe(400);
    expect((await api().post('/api/auth/register').send({ ...valid, password: 'short' })).status).toBe(400);
    expect((await api().post('/api/auth/register').send({ ...valid, password: 'nodigitshere' })).status).toBe(400);
    expect((await api().post('/api/auth/register').send({ ...valid, phone: '123' })).status).toBe(400);
  });

  it('rejects duplicate email and duplicate registered id with 409', async () => {
    expect((await api().post('/api/auth/register').send({ ...valid, email: 'client1@test.dev' })).status).toBe(409);
    expect((await api().post('/api/auth/register').send({ ...valid, nationalId: '123456782' })).status).toBe(409);
  });

  it('claims a phone-booked client (same id + phone) and attaches the existing appointments', async () => {
    const phoneClient = await prisma.user.create({ data: { role: 'CLIENT', fullName: 'משה', phone: '0537777777', nationalId: '000000034' } });
    const start = new Date(Date.now() + 86_400_000 * 5);
    const appt = await prisma.appointment.create({
      data: { providerId: f.providerA1.id, clientId: phoneClient.id, startTime: start, endTime: new Date(start.getTime() + 600_000), source: 'CLINIC' },
    });
    const bad = await api().post('/api/auth/register').send({ ...valid, nationalId: '000000034', phone: '0501111111' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('CLAIM_PHONE_MISMATCH');

    const ok = await api().post('/api/auth/register').send({ ...valid, nationalId: '000000034', phone: '0537777777' });
    expect(ok.status).toBe(201);
    expect(ok.body.claimedExistingClient).toBe(true);
    expect(ok.body.user.id).toBe(phoneClient.id);
    const mine = await api().get('/api/appointments/my').set(bearer(ok.body.token));
    expect(mine.body.items.map((a: { id: number }) => a.id)).toContain(appt.id);
  });
});

describe('PATCH /api/auth/me and change-password', () => {
  it('updates travel time and validates the range', async () => {
    const token = await login('client1@test.dev');
    const ok = await api().patch('/api/auth/me').set(bearer(token)).send({ defaultTravelMinutes: 45 });
    expect(ok.status).toBe(200);
    expect(ok.body.defaultTravelMinutes).toBe(45);
    expect((await api().patch('/api/auth/me').set(bearer(token)).send({ defaultTravelMinutes: 9999 })).status).toBe(400);
    expect((await api().patch('/api/auth/me').set(bearer(token)).send({})).status).toBe(400);
  });

  it('changes the password only with the correct current password', async () => {
    const token = await login('client1@test.dev');
    expect((await api().post('/api/auth/change-password').set(bearer(token)).send({ currentPassword: 'Wrong1234', newPassword: 'Brand1234' })).status).toBe(400);
    expect((await api().post('/api/auth/change-password').set(bearer(token)).send({ currentPassword: PASSWORD, newPassword: 'Brand1234' })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: 'Brand1234' })).status).toBe(200);
  });

  it('forces a user with a temporary password to change it before anything else', async () => {
    await prisma.user.update({ where: { id: f.managerA.id }, data: { mustChangePassword: true } });
    const token = await login('manager-a@test.dev');
    expect((await api().get('/api/manage/clinic').set(bearer(token))).status).toBe(403);
    expect((await api().get('/api/auth/me').set(bearer(token))).status).toBe(200);
    expect((await api().post('/api/auth/change-password').set(bearer(token)).send({ currentPassword: PASSWORD, newPassword: 'Brand1234' })).status).toBe(200);
    const fresh = await login('manager-a@test.dev', 'Brand1234');
    expect((await api().get('/api/manage/clinic').set(bearer(fresh))).status).toBe(200);
  });
});

describe('forgot / reset password', () => {
  const lastCode = () => {
    const mail = [...sentEmails].reverse().find((m) => m.subject.includes('קוד'));
    return mail?.text.match(/\d{6}/)?.[0] as string;
  };

  it('answers the same for known and unknown emails, and resets with the emailed code', async () => {
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost@test.dev' });
    const known = await api().post('/api/auth/forgot-password').send({ email: 'client1@test.dev' });
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(sentEmails).toHaveLength(1);

    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    const wrongCode = code === '000000' ? '111111' : '000000';
    expect((await api().post('/api/auth/reset-password').send({ email: 'client1@test.dev', code: wrongCode, newPassword: 'Another123' })).status).toBe(400);
    const ok = await api().post('/api/auth/reset-password').send({ email: 'client1@test.dev', code, newPassword: 'Another123' });
    expect(ok.status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: 'client1@test.dev', password: 'Another123' })).status).toBe(200);
    // קוד חד-פעמי
    expect((await api().post('/api/auth/reset-password').send({ email: 'client1@test.dev', code, newPassword: 'Third1234' })).status).toBe(400);
  });

  it('locks a code after too many wrong attempts', async () => {
    await api().post('/api/auth/forgot-password').send({ email: 'client1@test.dev' });
    const code = lastCode();
    const wrongCode = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) {
      await api().post('/api/auth/reset-password').send({ email: 'client1@test.dev', code: wrongCode, newPassword: 'Another123' });
    }
    const res = await api().post('/api/auth/reset-password').send({ email: 'client1@test.dev', code, newPassword: 'Another123' });
    expect(res.status).toBe(400);
  });
});
