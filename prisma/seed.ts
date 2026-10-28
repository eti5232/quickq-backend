/**
 * QuickQ - נתוני הדגמה (Seed)
 *
 * מצב פיתוח (NODE_ENV != production):
 *   מוחק את כל הנתונים ויוצר נתוני הדגמה מלאים עם סיסמאות קבועות וידועות (רק לפיתוח!).
 *
 * מצב Production:
 *   לא מוחק כלום. יוצר מנהל על רק אם הוגדרו SEED_ADMIN_EMAIL ו-SEED_ADMIN_PASSWORD.
 *   נתוני הדגמה נוצרים רק אם SEED_DEMO_DATA=true ו-SEED_DEMO_PASSWORD מוגדר, ורק אם אין עדיין קליניקות.
 *
 * כל הנתונים מומצאים.
 */
import { PrismaClient, type AppointmentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { withCheckDigit } from '../src/utils/national-id.js';
import {
  addDays,
  addMinutes,
  dateOnly,
  dayOfWeek,
  localToUtc,
  minutesToTime,
  timeToMinutes,
  toLocalDateStr,
  todayStr,
} from '../src/utils/time.js';

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === 'production';

const DEV_PASSWORDS = {
  admin: 'Admin123!',
  manager: 'Manager123!',
  client: 'Client123!',
};

const hash = (p: string) => bcrypt.hash(p, 10);

function validPassword(p: string | undefined): p is string {
  return !!p && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

/** מחיקת כל הנתונים ואיפוס המונים - כך שהמזהים (id) קבועים אחרי כל Seed */
async function wipe() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PasswordResetCode", "Appointment", "QueueDay", "ProviderAbsence", "WorkingHours", "JoinRequest", "User", "Provider", "Clinic" RESTART IDENTITY CASCADE',
  );
}

type Hours = { days: number[]; ranges: [string, string][] };

function hoursRows(h: Hours) {
  return h.days.flatMap((dayOfWeek) => h.ranges.map(([startTime, endTime]) => ({ dayOfWeek, startTime, endTime })));
}

/** המשבצת ה-n ביום העבודה הבא (החל מ-offsetDays) של איש מקצוע */
function nthSlot(hours: Hours, slotMinutes: number, fromOffsetDays: number, n: number) {
  for (let i = fromOffsetDays; i < fromOffsetDays + 14; i++) {
    const date = addDays(todayStr(), i);
    if (!hours.days.includes(dayOfWeek(date))) continue;
    const first = hours.ranges[0];
    if (!first) continue;
    const start = timeToMinutes(first[0]) + n * slotMinutes;
    if (start + slotMinutes > timeToMinutes(first[1])) continue;
    return localToUtc(date, minutesToTime(start));
  }
  throw new Error('No slot found for seed');
}

async function createDemoData(passwords: { manager: string; client: string }) {
  const managerHash = await hash(passwords.manager);
  const clientHash = await hash(passwords.client);
  const allDays = [0, 1, 2, 3, 4, 5, 6];

  // ---------------- קליניקות ----------------
  const smile = await prisma.clinic.create({
    data: {
      name: 'מרפאת שיניים "חיוך"',
      category: 'DENTAL',
      city: 'תל אביב',
      address: 'דיזנגוף 100',
      phone: '035551234',
      description: 'מרפאת שיניים משפחתית עם שלושה רופאים. טיפולים, ניקוי אבנית והלבנה.',
      changeDeadlineHours: 2,
      maxFutureAppointmentsPerProvider: 2,
      bookingHorizonDays: 180,
    },
  });
  const health = await prisma.clinic.create({
    data: {
      name: 'מרפאת "בריאות לכל"',
      category: 'GENERAL_MEDICINE',
      city: 'ירושלים',
      address: 'יפו 50',
      phone: '025559876',
      description: 'רפואת משפחה ומבוגרים.',
      changeDeadlineHours: 24,
      maxFutureAppointmentsPerProvider: 1,
      bookingHorizonDays: 60,
    },
  });
  const physio = await prisma.clinic.create({
    data: {
      name: 'פיזיו פלוס',
      category: 'PHYSIOTHERAPY',
      city: 'חיפה',
      address: 'הנביאים 12',
      phone: '045554321',
      description: 'פיזיותרפיה ושיקום אחרי פציעות ספורט.',
    },
  });
  await prisma.clinic.create({
    data: {
      name: 'מרכז הרמוניה - ייעוץ',
      category: 'CONSULTING',
      city: 'תל אביב',
      address: 'אבן גבירול 30',
      phone: '035550000',
      description: 'קליניקה מושבתת - לדוגמה בלבד.',
      isActive: false,
    },
  });

  // ---------------- אנשי מקצוע ----------------
  const levyHours: Hours = { days: allDays, ranges: [['07:00', '23:00']] };
  const mizrahiHours: Hours = { days: [0, 1, 2, 3, 4], ranges: [['09:00', '13:00'], ['16:00', '19:00']] };
  const peretzHours: Hours = { days: [1, 3], ranges: [['10:00', '18:00']] };
  const cohenHours: Hours = { days: [0, 1, 2, 3, 4], ranges: [['08:00', '14:00']] };
  const rosenHours: Hours = { days: [0, 1, 2, 3, 4, 5], ranges: [['08:00', '13:00']] };

  const levy = await prisma.provider.create({
    data: { clinicId: smile.id, fullName: 'ד"ר רונית לוי', specialty: 'רופאת שיניים', slotMinutes: 10, workingHours: { create: hoursRows(levyHours) } },
  });
  const mizrahi = await prisma.provider.create({
    data: { clinicId: smile.id, fullName: 'ד"ר יוסי מזרחי', specialty: 'אורתודונט', slotMinutes: 15, workingHours: { create: hoursRows(mizrahiHours) } },
  });
  const peretz = await prisma.provider.create({
    data: { clinicId: smile.id, fullName: 'ד"ר נועה פרץ', specialty: 'שיננית', slotMinutes: 20, workingHours: { create: hoursRows(peretzHours) } },
  });
  const cohen = await prisma.provider.create({
    data: { clinicId: health.id, fullName: 'ד"ר אבי כהן', specialty: 'רופא משפחה', slotMinutes: 10, workingHours: { create: hoursRows(cohenHours) } },
  });
  const rosen = await prisma.provider.create({
    data: { clinicId: physio.id, fullName: 'דנה רוזן', specialty: 'פיזיותרפיסטית', slotMinutes: 30, workingHours: { create: hoursRows(rosenHours) } },
  });

  // ---------------- צוות ----------------
  const staff = [
    { email: 'manager@quickq.dev', fullName: 'מיכל אברהם', phone: '0501000001', clinicId: smile.id },
    { email: 'secretary@quickq.dev', fullName: 'רותם שלום', phone: '0501000002', clinicId: smile.id },
    { email: 'manager2@quickq.dev', fullName: 'עומר גבאי', phone: '0501000003', clinicId: health.id },
    { email: 'manager3@quickq.dev', fullName: 'ליאת בן דוד', phone: '0501000004', clinicId: physio.id },
  ];
  for (const s of staff) {
    await prisma.user.create({ data: { ...s, role: 'CLINIC_MANAGER', passwordHash: managerHash } });
  }

  // ---------------- לקוחות ----------------
  const clientRows = [
    { email: 'client@quickq.dev', fullName: 'נועה כהן', phone: '0521111111', nationalId: withCheckDigit('31234567'), defaultTravelMinutes: 30 },
    { email: 'client2@quickq.dev', fullName: 'דניאל לוי', phone: '0522222222', nationalId: withCheckDigit('31234568'), defaultTravelMinutes: 15 },
    { email: 'client3@quickq.dev', fullName: 'שירה מזרחי', phone: '0523333333', nationalId: withCheckDigit('31234569'), defaultTravelMinutes: 20 },
    { email: 'client4@quickq.dev', fullName: 'איתי פרידמן', phone: '0524444444', nationalId: withCheckDigit('31234570'), defaultTravelMinutes: 40 },
    { email: 'client5@quickq.dev', fullName: 'מאיה אלון', phone: '0525555555', nationalId: withCheckDigit('31234571'), defaultTravelMinutes: 10 },
    { email: 'client6@quickq.dev', fullName: 'יונתן ברק', phone: '0526666666', nationalId: withCheckDigit('31234572'), defaultTravelMinutes: 25 },
  ];
  const clients = [];
  for (const c of clientRows) {
    clients.push(await prisma.user.create({ data: { ...c, role: 'CLIENT', passwordHash: clientHash } }));
  }
  // לקוחות שנוספו טלפונית (בלי סיסמה) - אפשר להדגים "חיבור אוטומטי" בהרשמה עם אותה ת"ז וטלפון
  const phoneClients = [];
  for (const c of [
    { fullName: 'משה ישראלי', phone: '0537777777', nationalId: withCheckDigit('41234567') },
    { fullName: 'רחל אדלר', phone: '0538888888', nationalId: withCheckDigit('41234568') },
    { fullName: 'אברהם סויסה', phone: '0539999999', nationalId: withCheckDigit('41234569') },
    { fullName: 'תמר גולן', phone: '0531234567', nationalId: withCheckDigit('41234570') },
  ]) {
    phoneClients.push(await prisma.user.create({ data: { ...c, role: 'CLIENT' } }));
  }
  const [noa, daniel, shira, itay, maya, yonatan] = clients as [typeof clients[0], typeof clients[0], typeof clients[0], typeof clients[0], typeof clients[0], typeof clients[0]];

  // ---------------- תור חי של היום אצל ד"ר לוי ----------------
  const now = new Date();
  const today = todayStr(now);
  const nowMin = Math.floor((now.getTime() - localToUtc(today, '00:00').getTime()) / 60_000);
  const todayPeople = [daniel, shira, itay, maya, ...phoneClients, yonatan, noa];
  // השעות המתוכננות של היום: מתחילות כ-50 דקות לפני עכשיו (ונשארות בתוך היום הנוכחי)
  const base = Math.min(Math.max(0, Math.floor(nowMin / 10) * 10 - 50), 24 * 60 - todayPeople.length * 10);
  const statuses: AppointmentStatus[] = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'IN_PROGRESS', 'ARRIVED', 'ARRIVED', 'BOOKED', 'BOOKED', 'BOOKED'];
  // משכי טיפול אמיתיים (דקות) - קצת יותר מ-10 כדי להדגים עיכוב
  const durations = [13, 15, 12, 14];
  // הזמנים בפועל מחושבים אחורה מעכשיו - כך שתמיד הם בעבר, בכל שעה שמריצים את ה-Seed
  const inProgressStart = addMinutes(now, -3);
  let cursor = addMinutes(inProgressStart, -durations.reduce((s, d) => s + d, 0));
  let queueNumber = 1;
  for (let i = 0; i < todayPeople.length; i++) {
    const startMin = base + i * 10;
    const startTime = localToUtc(today, minutesToTime(startMin));
    const status = statuses[i] ?? 'BOOKED';
    const person = todayPeople[i];
    if (!person) continue;
    const data: Parameters<typeof prisma.appointment.create>[0]['data'] = {
      providerId: levy.id,
      clientId: person.id,
      startTime,
      endTime: addMinutes(startTime, 10),
      status,
      queueNumber: queueNumber++,
      source: person.passwordHash ? 'ONLINE' : 'CLINIC',
      reminderEnabled: person.id === noa.id,
    };
    if (status === 'COMPLETED') {
      const d = durations[i] ?? 12;
      data.arrivedAt = addMinutes(cursor, -5);
      data.startedAt = cursor;
      data.completedAt = addMinutes(cursor, d);
      cursor = addMinutes(cursor, d);
    } else if (status === 'IN_PROGRESS') {
      data.arrivedAt = addMinutes(inProgressStart, -10);
      data.startedAt = inProgressStart;
    } else if (status === 'ARRIVED') {
      data.arrivedAt = addMinutes(now, -5);
    }
    await prisma.appointment.create({ data });
  }
  await prisma.queueDay.create({
    data: { providerId: levy.id, date: dateOnly(today), status: 'OPEN', openedAt: addMinutes(inProgressStart, -60) },
  });

  // ---------------- תורים עתידיים ----------------
  const future = [
    { provider: mizrahi, hours: mizrahiHours, client: noa, day: 1, n: 2, notes: 'בדיקת גשר', reminder: true },
    { provider: mizrahi, hours: mizrahiHours, client: daniel, day: 1, n: 3 },
    { provider: peretz, hours: peretzHours, client: shira, day: 1, n: 0, notes: 'ניקוי אבנית' },
    { provider: peretz, hours: peretzHours, client: phoneClients[0], day: 1, n: 1, source: 'CLINIC' as const },
    { provider: cohen, hours: cohenHours, client: noa, day: 2, n: 4 },
    { provider: cohen, hours: cohenHours, client: maya, day: 2, n: 5 },
    { provider: rosen, hours: rosenHours, client: itay, day: 3, n: 1, notes: 'שיקום ברך' },
    { provider: rosen, hours: rosenHours, client: phoneClients[1], day: 3, n: 2, source: 'IMPORT' as const },
    { provider: levy, hours: levyHours, client: yonatan, day: 5, n: 10 },
  ];
  for (const f of future) {
    if (!f.client) continue;
    const startTime = nthSlot(f.hours, f.provider.slotMinutes, f.day, f.n);
    await prisma.appointment.create({
      data: {
        providerId: f.provider.id,
        clientId: f.client.id,
        startTime,
        endTime: addMinutes(startTime, f.provider.slotMinutes),
        source: f.source ?? 'ONLINE',
        notes: f.notes ?? null,
        reminderEnabled: f.reminder ?? false,
      },
    });
  }

  // ---------------- היסטוריה: עבר + ביטולים ----------------
  const history: { provider: typeof cohen; client: typeof noa; daysAgo: number; status: AppointmentStatus; late?: boolean }[] = [
    { provider: cohen, client: noa, daysAgo: 7, status: 'COMPLETED' },
    { provider: mizrahi, client: noa, daysAgo: 14, status: 'COMPLETED' },
    { provider: levy, client: daniel, daysAgo: 3, status: 'NO_SHOW' },
    { provider: levy, client: noa, daysAgo: 2, status: 'CANCELLED_BY_CLIENT', late: true },
    { provider: rosen, client: shira, daysAgo: 4, status: 'CANCELLED_BY_CLINIC' },
    { provider: levy, client: daniel, daysAgo: 10, status: 'CANCELLED_BY_CLIENT', late: true },
  ];
  for (const h of history) {
    const date = addDays(today, -h.daysAgo);
    const startTime = localToUtc(date, '10:00');
    const done = h.status === 'COMPLETED';
    await prisma.appointment.create({
      data: {
        providerId: h.provider.id,
        clientId: h.client.id,
        startTime,
        endTime: addMinutes(startTime, h.provider.slotMinutes),
        status: h.status,
        isLateCancellation: h.late ?? false,
        cancelledAt: h.status.startsWith('CANCELLED') ? addMinutes(startTime, -60) : null,
        arrivedAt: done ? startTime : null,
        startedAt: done ? startTime : null,
        completedAt: done ? addMinutes(startTime, h.provider.slotMinutes) : null,
      },
    });
  }

  // ---------------- היעדרות ----------------
  for (let i = 7; i < 21; i++) {
    const date = addDays(today, i);
    if (peretzHours.days.includes(dayOfWeek(date))) {
      await prisma.providerAbsence.create({ data: { providerId: peretz.id, date: dateOnly(date), reason: 'כנס מקצועי' } });
      break;
    }
  }

  // ---------------- פניות הצטרפות ----------------
  await prisma.joinRequest.createMany({
    data: [
      { clinicName: 'קליניקת "עור בריא"', category: 'OTHER', city: 'רמת גן', contactName: 'אורית שמש', email: 'orit@example.com', phone: '0541231234', message: 'מרפאת עור עם שני רופאים, נשמח להצטרף' },
      { clinicName: 'שיניים לבנות', category: 'DENTAL', city: 'באר שבע', contactName: 'גיל אוחיון', email: 'gil@example.com', phone: '0547654321' },
      { clinicName: 'ייעוץ מהיר', category: 'CONSULTING', city: 'נתניה', contactName: 'רון דהן', email: 'ron@example.com', phone: '0549998887', status: 'REJECTED', rejectReason: 'פרטים חסרים', reviewedAt: now },
    ],
  });

  return { levy, noa, phoneClient: phoneClients[0] };
}

async function main() {
  if (isProduction) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (email && validPassword(password)) {
      const exists = await prisma.user.findUnique({ where: { email } });
      if (!exists) {
        await prisma.user.create({
          data: { role: 'SUPER_ADMIN', fullName: 'מנהל המערכת', email, phone: '0500000000', passwordHash: await hash(password) },
        });
        console.log(`✅ Super admin created: ${email}`);
      } else {
        console.log(`ℹ️  Super admin already exists: ${email}`);
      }
    } else {
      console.log('ℹ️  SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set (or weak password) - no admin created.');
    }
    const demoPassword = process.env.SEED_DEMO_PASSWORD;
    if (process.env.SEED_DEMO_DATA === 'true') {
      if (!validPassword(demoPassword)) {
        console.log('⚠️  SEED_DEMO_DATA=true but SEED_DEMO_PASSWORD missing/weak - skipping demo data.');
      } else if ((await prisma.clinic.count()) > 0) {
        console.log('ℹ️  Clinics already exist - skipping demo data.');
      } else {
        await createDemoData({ manager: demoPassword, client: demoPassword });
        console.log('✅ Demo data created (all demo users share SEED_DEMO_PASSWORD).');
      }
    }
    return;
  }

  console.log('🧹 Wiping database (development seed)...');
  await wipe();
  await prisma.user.create({
    data: {
      role: 'SUPER_ADMIN',
      fullName: 'מנהלת המערכת',
      email: 'admin@quickq.dev',
      phone: '0500000000',
      passwordHash: await hash(DEV_PASSWORDS.admin),
    },
  });
  const { levy, phoneClient } = await createDemoData({ manager: DEV_PASSWORDS.manager, client: DEV_PASSWORDS.client });

  console.log('\n✅ Seed completed. Demo accounts (development only!):');
  console.table([
    { role: 'SUPER_ADMIN', email: 'admin@quickq.dev', password: DEV_PASSWORDS.admin },
    { role: 'CLINIC_MANAGER', email: 'manager@quickq.dev', password: DEV_PASSWORDS.manager },
    { role: 'CLINIC_MANAGER', email: 'secretary@quickq.dev', password: DEV_PASSWORDS.manager },
    { role: 'CLIENT', email: 'client@quickq.dev', password: DEV_PASSWORDS.client },
    { role: 'CLIENT', email: 'client2@quickq.dev', password: DEV_PASSWORDS.client },
  ]);
  console.log(`Live queue demo: GET /api/providers/${levy.id}/live (today: ${toLocalDateStr(new Date())})`);
  if (phoneClient) {
    console.log(`Phone-only client for claim demo: nationalId=${phoneClient.nationalId}, phone=${phoneClient.phone}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
