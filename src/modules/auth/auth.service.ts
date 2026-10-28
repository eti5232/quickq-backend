import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { signAccessToken } from '../../auth/jwt.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../utils/app-error.js';
import { DUMMY_HASH, generateResetCode, hashPassword, verifyPassword } from '../../utils/password.js';
import { serializeUser } from '../../utils/serializers.js';
import { emailTemplates, sendEmail } from '../../services/email.service.js';
import { config } from '../../config/env.js';
import type { RegisterInput, UpdateMeInput } from './auth.schemas.js';

function authResponse(user: Parameters<typeof serializeUser>[0]) {
  return {
    token: signAccessToken(user.id, user.role),
    expiresIn: config.jwt.expiresIn,
    user: serializeUser(user),
  };
}

const samePhone = (a: string, b: string) => a.replace(/\D/g, '').slice(-9) === b.replace(/\D/g, '').slice(-9);

/**
 * הרשמת לקוח.
 * אם קיים לקוח עם אותה ת"ז שנוסף על ידי קליניקה (בלי סיסמה) וגם הטלפון תואם -
 * החשבון "נתבע" וכל התורים הקיימים שלו מתחברים אליו.
 */
export async function register(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const byId = await tx.user.findUnique({ where: { nationalId: input.nationalId } });
    const byEmail = await tx.user.findUnique({ where: { email: input.email } });

    if (byId) {
      if (byId.role !== 'CLIENT' || byId.passwordHash) {
        throw conflict('NATIONAL_ID_TAKEN', 'קיים כבר חשבון רשום עם תעודת זהות זו');
      }
      if (!samePhone(byId.phone, input.phone)) {
        throw conflict(
          'CLAIM_PHONE_MISMATCH',
          'קיים לקוח עם תעודת זהות זו, אך מספר הטלפון אינו תואם. יש לפנות לקליניקה לעדכון הטלפון',
        );
      }
      if (byEmail && byEmail.id !== byId.id) throw conflict('EMAIL_TAKEN', 'כתובת המייל כבר רשומה במערכת');
      const claimed = await tx.user.update({
        where: { id: byId.id },
        data: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          defaultTravelMinutes: input.defaultTravelMinutes ?? byId.defaultTravelMinutes,
          isActive: true,
        },
      });
      return { ...authResponse(claimed), claimedExistingClient: true };
    }

    if (byEmail) throw conflict('EMAIL_TAKEN', 'כתובת המייל כבר רשומה במערכת');

    const user = await tx.user.create({
      data: {
        role: 'CLIENT',
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        nationalId: input.nationalId,
        passwordHash,
        defaultTravelMinutes: input.defaultTravelMinutes ?? 30,
      },
    });
    return { ...authResponse(user), claimedExistingClient: false };
  });
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { clinic: true } });
  // משווים תמיד מול Hash כלשהו - כדי שזמן התגובה לא יחשוף אם המייל קיים
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) {
    throw unauthorized('מייל או סיסמה שגויים', 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) throw forbidden('המשתמש הושבת. יש לפנות למנהל המערכת', 'USER_INACTIVE');
  if (user.role === 'CLINIC_MANAGER' && (!user.clinic || !user.clinic.isActive)) {
    throw forbidden('הקליניקה שלך מושבתת', 'CLINIC_INACTIVE');
  }
  const { clinic: _c, ...record } = user;
  return authResponse(record);
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { clinic: true } });
  if (!user) throw notFound('המשתמש לא נמצא');
  const { clinic, ...record } = user;
  return {
    ...serializeUser(record),
    clinic: clinic ? { id: clinic.id, name: clinic.name, isActive: clinic.isActive } : null,
  };
}

export async function updateMe(userId: number, input: UpdateMeInput) {
  await prisma.user.update({ where: { id: userId }, data: input });
  return getMe(userId);
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw notFound('המשתמש לא נמצא');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest('WRONG_PASSWORD', 'הסיסמה הנוכחית שגויה');
  }
  if (currentPassword === newPassword) throw badRequest('SAME_PASSWORD', 'הסיסמה החדשה חייבת להיות שונה מהנוכחית');
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  return { message: 'הסיסמה הוחלפה בהצלחה', ...authResponse(updated) };
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const RESET_TTL_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;

/** תמיד מחזיר את אותה תשובה - כדי לא לחשוף אילו מיילים רשומים */
export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.passwordHash && user.isActive) {
    const code = generateResetCode();
    await prisma.$transaction([
      prisma.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.passwordResetCode.create({
        data: {
          userId: user.id,
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
        },
      }),
    ]);
    await sendEmail({ to: email, ...emailTemplates.passwordReset({ fullName: user.fullName, code }) });
  }
  return { message: 'אם המייל רשום במערכת, נשלח אליו קוד לשחזור הסיסמה' };
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  const invalid = () => badRequest('INVALID_RESET_CODE', 'הקוד שגוי או שפג תוקפו');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !user.isActive) throw invalid();
  const record = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!record || record.attempts >= RESET_MAX_ATTEMPTS) throw invalid();

  const a = Buffer.from(record.codeHash, 'hex');
  const b = Buffer.from(sha256(code), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await prisma.passwordResetCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw invalid();
  }

  await prisma.$transaction([
    prisma.passwordResetCode.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    }),
  ]);
  return { message: 'הסיסמה עודכנה. אפשר להתחבר עם הסיסמה החדשה' };
}
