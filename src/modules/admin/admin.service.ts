import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { badRequest, conflict, notFound } from '../../utils/app-error.js';
import { serializeClinic, serializeUser } from '../../utils/serializers.js';
import { generateTemporaryPassword, hashPassword } from '../../utils/password.js';
import { paginate } from '../../utils/validation.js';
import { cancelByClinic, countFutureActive } from '../../services/cancellation.service.js';
import { emailTemplates, sendEmail } from '../../services/email.service.js';
import type {
  clinicsQuery,
  createClinicSchema,
  joinRequestsQuery,
  updateClinicSchema,
  updateUserSchema,
  usersQuery,
} from './admin.schemas.js';

// ---------- פניות הצטרפות ----------

export async function listJoinRequests(q: z.infer<typeof joinRequestsQuery>) {
  const where: Prisma.JoinRequestWhereInput = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    prisma.joinRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.joinRequest.count({ where }),
  ]);
  return paginate(items, total, q.page, q.pageSize);
}

interface NewClinicData {
  name: string;
  category: Prisma.ClinicCreateInput['category'];
  city: string;
  address: string;
  phone: string;
  description?: string | null;
}

/** יוצר קליניקה + מנהל עם סיסמה זמנית, ושולח מייל ברוכים הבאים */
async function createClinicWithManager(
  clinic: NewClinicData,
  manager: { fullName: string; email: string; phone: string },
  joinRequestId?: number,
) {
  const existing = await prisma.user.findUnique({ where: { email: manager.email } });
  if (existing) {
    throw conflict('EMAIL_TAKEN', 'כתובת המייל של המנהל כבר רשומה במערכת. אפשר לשלוח מייל אחר באישור', {
      email: manager.email,
    });
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.clinic.create({ data: { ...clinic, description: clinic.description ?? null } });
    const user = await tx.user.create({
      data: {
        role: 'CLINIC_MANAGER',
        clinicId: created.id,
        fullName: manager.fullName,
        email: manager.email,
        phone: manager.phone,
        passwordHash,
        mustChangePassword: true,
      },
    });
    if (joinRequestId) {
      await tx.joinRequest.update({
        where: { id: joinRequestId },
        data: { status: 'APPROVED', clinicId: created.id, reviewedAt: new Date() },
      });
    }
    return { clinic: created, user };
  });

  await sendEmail({
    to: manager.email,
    ...emailTemplates.welcomeStaff({
      fullName: manager.fullName,
      clinicName: result.clinic.name,
      email: manager.email,
      temporaryPassword,
    }),
  });

  return {
    clinic: serializeClinic(result.clinic),
    manager: serializeUser(result.user),
    /** מוצג פעם אחת בלבד - נשלח גם במייל למנהל */
    temporaryPassword,
  };
}

export async function approveJoinRequest(id: number, emailOverride?: string) {
  const request = await prisma.joinRequest.findUnique({ where: { id } });
  if (!request) throw notFound('הפנייה לא נמצאה');
  if (request.status !== 'PENDING') throw conflict('ALREADY_REVIEWED', 'הפנייה כבר טופלה');
  const result = await createClinicWithManager(
    {
      name: request.clinicName,
      category: request.category,
      city: request.city,
      address: request.city,
      phone: request.phone,
      description: request.message,
    },
    { fullName: request.contactName, email: emailOverride ?? request.email, phone: request.phone },
    request.id,
  );
  return { joinRequestId: id, ...result };
}

export async function rejectJoinRequest(id: number, reason?: string) {
  const request = await prisma.joinRequest.findUnique({ where: { id } });
  if (!request) throw notFound('הפנייה לא נמצאה');
  if (request.status !== 'PENDING') throw conflict('ALREADY_REVIEWED', 'הפנייה כבר טופלה');
  const updated = await prisma.joinRequest.update({
    where: { id },
    data: { status: 'REJECTED', rejectReason: reason ?? null, reviewedAt: new Date() },
  });
  await sendEmail({
    to: request.email,
    ...emailTemplates.joinRequestRejected({ contactName: request.contactName, clinicName: request.clinicName, reason }),
  });
  return updated;
}

// ---------- קליניקות ----------

export async function listClinics(q: z.infer<typeof clinicsQuery>) {
  const where: Prisma.ClinicWhereInput = {};
  if (q.category) where.category = q.category;
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { city: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.clinic.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { _count: { select: { providers: true, staff: true } } },
    }),
    prisma.clinic.count({ where }),
  ]);
  return paginate(
    items.map(({ _count, ...c }) => ({ ...serializeClinic(c), providersCount: _count.providers, staffCount: _count.staff })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function createClinic(input: z.infer<typeof createClinicSchema>) {
  const { manager, ...clinic } = input;
  return createClinicWithManager(clinic, manager);
}

export async function updateClinic(id: number, input: z.infer<typeof updateClinicSchema>) {
  const clinic = await prisma.clinic.findUnique({ where: { id } });
  if (!clinic) throw notFound('הקליניקה לא נמצאה');
  const { cancelFutureAppointments, ...data } = input;
  let cancelledAppointments = 0;
  if (data.isActive === false && clinic.isActive) {
    const where = { provider: { clinicId: id } };
    const future = await countFutureActive(where);
    if (future > 0 && !cancelFutureAppointments) {
      throw conflict(
        'HAS_FUTURE_APPOINTMENTS',
        `לקליניקה יש ${future} תורים עתידיים. כדי להשבית ולבטל אותם שלחי cancelFutureAppointments: true`,
        { futureAppointments: future },
      );
    }
    cancelledAppointments = await cancelByClinic({ ...where, startTime: { gt: new Date() } }, 'הקליניקה אינה פעילה');
  }
  const updated = await prisma.clinic.update({ where: { id }, data });
  return { ...serializeClinic(updated), cancelledAppointments };
}

// ---------- משתמשים ----------

export async function listUsers(q: z.infer<typeof usersQuery>) {
  const where: Prisma.UserWhereInput = {};
  if (q.role) where.role = q.role;
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (q.q) {
    where.OR = [
      { fullName: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
      { nationalId: { contains: q.q } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return paginate(items.map(serializeUser), total, q.page, q.pageSize);
}

/** מנהל העל מתקן פרטים / משבית. לא משנה תפקיד ולא רואה סיסמאות */
export async function updateUser(actorId: number, id: number, input: z.infer<typeof updateUserSchema>) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('המשתמש לא נמצא');
  const { cancelFutureAppointments, ...data } = input;
  if (id === actorId && data.isActive === false) throw badRequest('CANNOT_DEACTIVATE_SELF', 'לא ניתן להשבית את עצמך');
  if (data.nationalId && user.role !== 'CLIENT') {
    throw badRequest('NATIONAL_ID_CLIENTS_ONLY', 'תעודת זהות נשמרת רק ללקוחות');
  }
  let cancelledAppointments = 0;
  if (data.isActive === false && user.isActive && user.role === 'CLIENT') {
    const future = await countFutureActive({ clientId: id });
    if (future > 0 && !cancelFutureAppointments) {
      throw conflict(
        'HAS_FUTURE_APPOINTMENTS',
        `ללקוח יש ${future} תורים עתידיים. כדי להשבית ולבטל אותם שלחי cancelFutureAppointments: true`,
        { futureAppointments: future },
      );
    }
    cancelledAppointments = await cancelByClinic({ clientId: id, startTime: { gt: new Date() } }, 'החשבון הושבת');
  }
  const updated = await prisma.user.update({ where: { id }, data });
  return { ...serializeUser(updated), cancelledAppointments };
}

export async function resetUserPassword(actorId: number, id: number) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('המשתמש לא נמצא');
  if (id === actorId) throw badRequest('CANNOT_RESET_SELF', 'להחלפת הסיסמה שלך השתמשי ב"שינוי סיסמה"');
  if (!user.email) throw badRequest('NO_EMAIL', 'למשתמש אין כתובת מייל ולכן אינו יכול להתחבר');
  const temporaryPassword = generateTemporaryPassword();
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });
  await sendEmail({ to: user.email, ...emailTemplates.passwordResetByAdmin({ fullName: user.fullName, temporaryPassword }) });
  return { message: 'הסיסמה אופסה ונשלחה במייל למשתמש', temporaryPassword };
}
