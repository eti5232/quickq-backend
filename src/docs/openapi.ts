/**
 * QuickQ - מסמך OpenAPI 3 (מוצג ב-Swagger UI בכתובת /api-docs)
 * הכתובת היחסית "/" ב-servers מבטיחה שהמסמך יעבוד גם בענן (Render) וגם במחשב המקומי.
 */

type Json = Record<string, unknown>;
type Role = 'SUPER_ADMIN' | 'CLINIC_MANAGER' | 'CLIENT';
type Access = 'public' | 'optional' | Role[];

interface Param {
  name: string;
  in: 'path' | 'query' | 'header';
  description: string;
  required?: boolean;
  schema: Json;
  example?: unknown;
}

interface OpDef {
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  params?: Param[];
  body?: { schema: Json; example?: unknown };
  multipart?: boolean;
  success: { status: number; description: string; schema?: Json; example?: unknown; contentType?: string };
  errors?: number[];
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const idPath = (description = 'מזהה'): Param => ({ name: 'id', in: 'path', required: true, description, schema: { type: 'integer', minimum: 1 }, example: 1 });
const pageParams: Param[] = [
  { name: 'page', in: 'query', description: 'מספר עמוד (מתחיל ב-1)', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', description: 'כמות בעמוד (עד 100)', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const paged = (item: string) => ({
  allOf: [ref('Paginated'), { type: 'object', properties: { items: { type: 'array', items: ref(item) } } }],
});

const ERROR_RESPONSES: Record<number, string> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  429: 'TooManyRequests',
  503: 'ServiceUnavailable',
};

const roleNames: Record<Role, string> = {
  SUPER_ADMIN: 'מנהל על',
  CLINIC_MANAGER: 'מנהל קליניקה',
  CLIENT: 'לקוח',
};

function op(def: OpDef): Json {
  const accessText =
    def.access === 'public'
      ? '🔓 **ציבורי** - ללא התחברות'
      : def.access === 'optional'
        ? '🔓 **ציבורי** - Token לא חובה (אם נשלח Token של לקוח - מתווסף מידע אישי)'
        : `🔒 **דורש Token** · הרשאה: ${def.access.map((r) => `${roleNames[r]} (${r})`).join(', ')}`;

  const errors = new Set(def.errors ?? []);
  if (Array.isArray(def.access)) {
    errors.add(401);
    errors.add(403);
  }
  const responses: Json = {};
  const success: Json = { description: def.success.description };
  if (def.success.schema || def.success.example !== undefined) {
    success.content = {
      [def.success.contentType ?? 'application/json']: {
        ...(def.success.schema ? { schema: def.success.schema } : {}),
        ...(def.success.example !== undefined ? { example: def.success.example } : {}),
      },
    };
  }
  responses[String(def.success.status)] = success;
  for (const code of [...errors].sort()) {
    const name = ERROR_RESPONSES[code];
    if (name) responses[String(code)] = { $ref: `#/components/responses/${name}` };
  }

  const operation: Json = {
    tags: [def.tag],
    summary: def.summary,
    description: [accessText, def.description].filter(Boolean).join('\n\n'),
    responses,
  };
  if (Array.isArray(def.access)) operation.security = [{ bearerAuth: [] }];
  else if (def.access === 'optional') operation.security = [{}, { bearerAuth: [] }];
  else operation.security = [];
  if (def.params?.length) {
    operation.parameters = def.params.map((p) => ({ ...p, required: p.in === 'path' ? true : (p.required ?? false) }));
  }
  if (def.body) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': { schema: def.body.schema, ...(def.body.example !== undefined ? { example: def.body.example } : {}) },
      },
    };
  }
  if (def.multipart) {
    operation.requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary', description: 'קובץ CSV (עד 2MB, עד 5000 שורות)' } },
          },
        },
      },
    };
  }
  return operation;
}

// ---------------------------------------------------------------------------
// דוגמאות
// ---------------------------------------------------------------------------

const exUser = {
  id: 3,
  role: 'CLIENT',
  fullName: 'נועה כהן',
  email: 'client@quickq.dev',
  phone: '0521111111',
  nationalId: '123456782',
  defaultTravelMinutes: 30,
  mustChangePassword: false,
  isActive: true,
  isRegistered: true,
  clinicId: null,
  createdAt: '2026-10-01T08:00:00.000Z',
};

const exClinic = {
  id: 1,
  name: 'מרפאת שיניים "חיוך"',
  category: 'DENTAL',
  city: 'תל אביב',
  address: 'דיזנגוף 100',
  phone: '035551234',
  description: 'מרפאת שיניים משפחתית',
  isActive: true,
  settings: { changeDeadlineHours: 2, maxFutureAppointmentsPerProvider: 2, bookingHorizonDays: 180 },
  createdAt: '2026-10-01T08:00:00.000Z',
};

const exAppointment = {
  id: 87,
  status: 'BOOKED',
  startTime: '2026-11-03T14:10:00.000Z',
  endTime: '2026-11-03T14:20:00.000Z',
  date: '2026-11-03',
  time: '16:10',
  queueNumber: null,
  source: 'ONLINE',
  notes: 'כאב בשן שמאלית',
  reminderEnabled: true,
  travelMinutes: 30,
  effectiveTravelMinutes: 30,
  reminderSentAt: null,
  isLateCancellation: false,
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  changeDeadline: '2026-11-03T12:10:00.000Z',
  canReschedule: true,
  canCancel: true,
  cancellationWouldBeLate: false,
  provider: { id: 1, fullName: 'ד"ר רונית לוי', specialty: 'רופאת שיניים', slotMinutes: 10 },
  clinic: { id: 1, name: 'מרפאת שיניים "חיוך"', city: 'תל אביב', address: 'דיזנגוף 100', phone: '035551234' },
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

const exLive = {
  provider: { id: 1, fullName: 'ד"ר רונית לוי', specialty: 'רופאת שיניים', slotMinutes: 10 },
  clinic: { id: 1, name: 'מרפאת שיניים "חיוך"', address: 'דיזנגוף 100', city: 'תל אביב' },
  date: '2026-11-03',
  dayStatus: 'OPEN',
  plannedOpenTime: '16:00',
  currentQueueNumber: 12,
  delayMinutes: 35,
  averageMinutesPerClient: 14,
  pace: 'SLOWER',
  completedCount: 11,
  noShowCount: 0,
  waitingCount: 9,
  totalToday: 21,
  progressPercent: 52,
  updatedAt: '2026-11-03T14:42:10.000Z',
  myAppointment: {
    appointmentId: 87,
    status: 'BOOKED',
    queueNumber: 18,
    peopleAhead: 5,
    scheduledTime: '2026-11-03T15:05:00.000Z',
    estimatedTime: '2026-11-03T15:40:00.000Z',
    minutesUntilTurn: 58,
    travelMinutes: 30,
    leaveHomeAt: '2026-11-03T15:10:00.000Z',
    reminderEnabled: true,
  },
};

const exProvider = { id: 1, clinicId: 1, fullName: 'ד"ר רונית לוי', specialty: 'רופאת שיניים', slotMinutes: 10, isActive: true };

// ---------------------------------------------------------------------------
// סכמות
// ---------------------------------------------------------------------------

const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra });
const int = (description: string, extra: Json = {}) => ({ type: 'integer', description, ...extra });
const bool = (description: string) => ({ type: 'boolean', description });
const dt = (description: string, nullable = false) => ({ type: 'string', format: 'date-time', description, ...(nullable ? { nullable: true } : {}) });
const categoryEnum = { type: 'string', enum: ['DENTAL', 'GENERAL_MEDICINE', 'PHYSIOTHERAPY', 'CONSULTING', 'OTHER'], description: 'תחום: רפואת שיניים / רפואה כללית / פיזיותרפיה / ייעוץ / אחר' };
const appointmentStatusEnum = {
  type: 'string',
  enum: ['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_CLINIC'],
  description: 'נקבע / הגיע / בטיפול / הסתיים / לא הגיע / בוטל ע"י הלקוח / בוטל ע"י הקליניקה',
};

const schemas: Json = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: str('קוד שגיאה קבוע באנגלית (לשימוש בקוד)', { example: 'VALIDATION_ERROR' }),
          message: str('הודעה בעברית להצגה למשתמש', { example: 'הנתונים שנשלחו אינם תקינים' }),
          details: { description: 'פרטים נוספים (למשל רשימת שדות שגויים)', nullable: true },
        },
      },
    },
  },
  Paginated: {
    type: 'object',
    properties: {
      items: { type: 'array', items: {} },
      page: int('העמוד הנוכחי'),
      pageSize: int('כמות בעמוד'),
      total: int('סך הכל רשומות'),
      totalPages: int('סך הכל עמודים'),
    },
  },
  User: {
    type: 'object',
    properties: {
      id: int('מזהה'),
      role: { type: 'string', enum: ['SUPER_ADMIN', 'CLINIC_MANAGER', 'CLIENT'] },
      fullName: str('שם מלא'),
      email: str('מייל', { nullable: true }),
      phone: str('טלפון'),
      nationalId: str('תעודת זהות (לקוחות בלבד)', { nullable: true }),
      defaultTravelMinutes: int('זמן הגעה לקליניקה בדקות (ברירת מחדל)'),
      mustChangePassword: bool('חייב להחליף סיסמה זמנית'),
      isActive: bool('פעיל'),
      isRegistered: bool('האם יש למשתמש סיסמה (false = לקוח שנוסף טלפונית)'),
      clinicId: int('הקליניקה (למנהל קליניקה)', { nullable: true }),
      createdAt: dt('נוצר'),
    },
    example: exUser,
  },
  AuthResponse: {
    type: 'object',
    properties: {
      token: str('JWT Access Token - יש לשלוח בכותרת Authorization: Bearer <token>'),
      expiresIn: str('תוקף ה-Token', { example: '8h' }),
      user: ref('User'),
    },
    example: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', expiresIn: '8h', user: exUser },
  },
  Message: { type: 'object', properties: { message: str('הודעה') }, example: { message: 'הפעולה בוצעה בהצלחה' } },
  ClinicSettings: {
    type: 'object',
    properties: {
      changeDeadlineHours: int('עד כמה שעות לפני התור מותר לשנות/לבטל בלי "ביטול מאוחר"'),
      maxFutureAppointmentsPerProvider: int('מקסימום תורים עתידיים ללקוח אצל אותו איש מקצוע'),
      bookingHorizonDays: int('כמה ימים קדימה אפשר לקבוע'),
    },
  },
  Clinic: {
    type: 'object',
    properties: {
      id: int('מזהה'),
      name: str('שם'),
      category: categoryEnum,
      city: str('עיר'),
      address: str('כתובת'),
      phone: str('טלפון'),
      description: str('תיאור', { nullable: true }),
      isActive: bool('פעילה'),
      settings: ref('ClinicSettings'),
      createdAt: dt('נוצרה'),
    },
    example: exClinic,
  },
  ClinicListItem: {
    allOf: [
      ref('Clinic'),
      {
        type: 'object',
        properties: {
          providersCount: int('מספר אנשי מקצוע פעילים'),
          isOpenNow: bool('פתוחה עכשיו: התור החי פתוח, או שאחד מאנשי המקצוע בשעות הפעילות שלו (ולא נעדר או נסגר להיום)'),
          nextAvailableSlot: {
            type: 'object',
            nullable: true,
            description: 'התור הפנוי הקרוב ביותר (30 יום קדימה)',
            properties: { startTime: dt('זמן'), providerId: int('איש מקצוע'), providerName: str('שם איש המקצוע') },
          },
        },
      },
    ],
  },
  ClinicDetails: {
    allOf: [
      ref('Clinic'),
      {
        type: 'object',
        properties: {
          providers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: int('מזהה'),
                fullName: str('שם'),
                specialty: str('התמחות', { nullable: true }),
                slotMinutes: int('משך תור'),
                todayQueueStatus: { type: 'string', enum: ['NOT_OPENED', 'OPEN', 'PAUSED', 'CLOSED'] },
              },
            },
          },
        },
      },
    ],
  },
  Provider: {
    type: 'object',
    properties: {
      id: int('מזהה'),
      clinicId: int('קליניקה'),
      fullName: str('שם'),
      specialty: str('התמחות', { nullable: true }),
      slotMinutes: int('משך תור משוער בדקות'),
      isActive: bool('פעיל'),
    },
    example: exProvider,
  },
  WorkingHoursRange: {
    type: 'object',
    required: ['dayOfWeek', 'startTime', 'endTime'],
    properties: {
      dayOfWeek: int('0=ראשון ... 6=שבת', { minimum: 0, maximum: 6 }),
      startTime: str('שעת התחלה HH:MM', { example: '16:00' }),
      endTime: str('שעת סיום HH:MM', { example: '20:00' }),
    },
  },
  ProviderWithHours: {
    allOf: [ref('Provider'), { type: 'object', properties: { workingHours: { type: 'array', items: ref('WorkingHoursRange') } } }],
  },
  Absence: {
    type: 'object',
    properties: { id: int('מזהה'), providerId: int('איש מקצוע'), date: str('תאריך YYYY-MM-DD'), reason: str('סיבה', { nullable: true }), createdAt: dt('נוצר') },
    example: { id: 4, providerId: 1, date: '2026-11-10', reason: 'כנס מקצועי', createdAt: '2026-10-20T09:00:00.000Z' },
  },
  DaySlots: {
    type: 'object',
    properties: {
      providerId: int('איש מקצוע'),
      date: str('תאריך'),
      slotMinutes: int('משך תור'),
      isAbsent: bool('איש המקצוע נעדר ביום זה'),
      slots: { type: 'array', items: { type: 'object', properties: { time: str('שעה מקומית HH:MM'), startTime: dt('זמן מלא (לשליחה בקביעת תור)') } } },
    },
    example: {
      providerId: 1,
      date: '2026-11-03',
      slotMinutes: 10,
      isAbsent: false,
      slots: [
        { time: '16:00', startTime: '2026-11-03T14:00:00.000Z' },
        { time: '16:20', startTime: '2026-11-03T14:20:00.000Z' },
      ],
    },
  },
  MonthAvailability: {
    type: 'object',
    properties: {
      providerId: int('איש מקצוע'),
      month: str('חודש YYYY-MM'),
      slotMinutes: int('משך תור'),
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: str('תאריך'),
            status: { type: 'string', enum: ['AVAILABLE', 'FULL', 'NOT_WORKING', 'ABSENT', 'PAST', 'BEYOND_HORIZON'], description: 'פנוי / מלא / לא עובד / היעדרות / עבר / מעבר לטווח' },
            freeSlots: int('מספר משבצות פנויות'),
          },
        },
      },
    },
    example: {
      providerId: 1,
      month: '2026-11',
      slotMinutes: 10,
      days: [
        { date: '2026-11-01', status: 'AVAILABLE', freeSlots: 17 },
        { date: '2026-11-02', status: 'FULL', freeSlots: 0 },
        { date: '2026-11-07', status: 'NOT_WORKING', freeSlots: 0 },
      ],
    },
  },
  LiveStatus: {
    type: 'object',
    properties: {
      provider: { type: 'object' },
      clinic: { type: 'object' },
      date: str('התאריך של היום'),
      dayStatus: { type: 'string', enum: ['NO_SERVICE_TODAY', 'NOT_OPENED', 'OPEN', 'PAUSED', 'CLOSED'], description: 'אין קבלה היום / עוד לא נפתח / פתוח / בהפסקה / נסגר' },
      plannedOpenTime: str('שעת פתיחה מתוכננת', { nullable: true }),
      currentQueueNumber: int('המספר שבטיפול עכשיו', { nullable: true }),
      delayMinutes: int('עיכוב נוכחי בדקות'),
      averageMinutesPerClient: int('קצב ממוצע אמיתי היום (דקות ללקוח)'),
      pace: { type: 'string', enum: ['FASTER', 'ON_TIME', 'SLOWER'], description: 'מהר מהצפוי / בזמן / לאט מהצפוי' },
      completedCount: int('טופלו היום'),
      noShowCount: int('לא הגיעו'),
      waitingCount: int('ממתינים'),
      totalToday: int('סך התורים היום'),
      progressPercent: int('אחוז התקדמות היום'),
      updatedAt: dt('זמן החישוב'),
      myAppointment: {
        type: 'object',
        nullable: true,
        description: 'רק ללקוח מחובר שיש לו תור היום אצל איש מקצוע זה',
        properties: {
          appointmentId: int('מזהה התור'),
          status: appointmentStatusEnum,
          queueNumber: int('המספר שלי', { nullable: true }),
          peopleAhead: int('כמה לפניי'),
          scheduledTime: dt('השעה המקורית'),
          estimatedTime: dt('השעה המשוערת'),
          minutesUntilTurn: int('דקות עד התור'),
          travelMinutes: int('זמן הגעה'),
          leaveHomeAt: dt('מתי לצאת מהבית'),
          reminderEnabled: bool('תזכורת במייל פעילה'),
        },
      },
    },
    example: exLive,
  },
  Appointment: {
    type: 'object',
    properties: {
      id: int('מזהה'),
      status: appointmentStatusEnum,
      startTime: dt('תחילת התור (UTC)'),
      endTime: dt('סוף התור (UTC)'),
      date: str('תאריך מקומי'),
      time: str('שעה מקומית'),
      queueNumber: int('מספר בתור היומי (נקבע בפתיחת היום)', { nullable: true }),
      source: { type: 'string', enum: ['ONLINE', 'CLINIC', 'IMPORT'], description: 'נקבע באתר / ע"י הקליניקה / ייבוא' },
      notes: str('הערה', { nullable: true }),
      reminderEnabled: bool('תזכורת במייל'),
      travelMinutes: int('זמן הגעה לתור זה (null = לפי הפרופיל)', { nullable: true }),
      effectiveTravelMinutes: int('זמן ההגעה בפועל לחישוב'),
      reminderSentAt: dt('מתי נשלחה תזכורת', true),
      isLateCancellation: bool('ביטול מאוחר'),
      arrivedAt: dt('הגיע', true),
      startedAt: dt('נכנס לטיפול', true),
      completedAt: dt('סיים', true),
      cancelledAt: dt('בוטל', true),
      changeDeadline: dt('עד מתי מותר לשנות בלי "ביטול מאוחר"'),
      canReschedule: bool('אפשר לשנות שעה עכשיו'),
      canCancel: bool('אפשר לבטל'),
      cancellationWouldBeLate: bool('ביטול עכשיו ייחשב מאוחר'),
      provider: { type: 'object' },
      clinic: { type: 'object' },
      client: { type: 'object', description: 'רק למנהל קליניקה / מנהל על', nullable: true },
      createdAt: dt('נוצר'),
      updatedAt: dt('עודכן'),
    },
    example: exAppointment,
  },
  ManagerQueue: {
    type: 'object',
    properties: {
      provider: { type: 'object' },
      date: str('תאריך'),
      dayStatus: { type: 'string', enum: ['NOT_OPENED', 'OPEN', 'PAUSED', 'CLOSED'] },
      openedAt: dt('נפתח', true),
      averageMinutesPerClient: int('קצב ממוצע'),
      currentAppointmentId: int('התור שבטיפול', { nullable: true }),
      appointments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: int('מזהה'),
            queueNumber: int('מספר', { nullable: true }),
            status: appointmentStatusEnum,
            startTime: dt('שעה מקורית'),
            estimatedTime: dt('שעה משוערת', true),
            client: { type: 'object', properties: { id: int('מזהה'), fullName: str('שם'), phone: str('טלפון') } },
          },
        },
      },
    },
    example: {
      provider: { id: 1, fullName: 'ד"ר רונית לוי', slotMinutes: 10 },
      date: '2026-11-03',
      dayStatus: 'OPEN',
      openedAt: '2026-11-03T14:00:00.000Z',
      averageMinutesPerClient: 14,
      currentAppointmentId: 55,
      appointments: [
        { id: 55, queueNumber: 5, status: 'IN_PROGRESS', startTime: '2026-11-03T14:40:00.000Z', estimatedTime: null, client: { id: 9, fullName: 'משה ישראלי', phone: '0537777777' } },
        { id: 56, queueNumber: 6, status: 'ARRIVED', startTime: '2026-11-03T14:50:00.000Z', estimatedTime: '2026-11-03T15:02:00.000Z', client: { id: 10, fullName: 'רחל אדלר', phone: '0538888888' } },
      ],
    },
  },
  JoinRequest: {
    type: 'object',
    properties: {
      id: int('מזהה'),
      clinicName: str('שם הקליניקה'),
      category: categoryEnum,
      city: str('עיר'),
      contactName: str('איש קשר'),
      email: str('מייל'),
      phone: str('טלפון'),
      message: str('הודעה', { nullable: true }),
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      rejectReason: str('סיבת דחייה', { nullable: true }),
      clinicId: int('הקליניקה שנוצרה', { nullable: true }),
      reviewedAt: dt('טופל', true),
      createdAt: dt('נשלח'),
    },
  },
  ClinicWithManager: {
    type: 'object',
    properties: {
      clinic: ref('Clinic'),
      manager: ref('User'),
      temporaryPassword: str('סיסמה זמנית למנהל - מוצגת פעם אחת (נשלחת גם במייל)'),
    },
  },
  ImportResult: {
    type: 'object',
    properties: {
      totalRows: int('שורות בקובץ'),
      imported: int('נקלטו'),
      failed: int('נכשלו'),
      createdClients: int('לקוחות חדשים שנוצרו'),
      errors: { type: 'array', items: { type: 'object', properties: { row: int('מספר שורה בקובץ'), message: str('סיבה') } } },
    },
    example: { totalRows: 145, imported: 142, failed: 3, createdClients: 87, errors: [{ row: 17, message: 'איש מקצוע לא קיים בקליניקה: "ד"ר שגוי"' }] },
  },
};

const errorExample = (code: string, message: string) => ({ 'application/json': { schema: ref('Error'), example: { error: { code, message } } } });

const responsesComponents: Json = {
  BadRequest: {
    description: 'נתונים לא תקינים (400)',
    content: {
      'application/json': {
        schema: ref('Error'),
        example: { error: { code: 'VALIDATION_ERROR', message: 'הנתונים שנשלחו אינם תקינים', details: [{ field: 'email', message: 'כתובת מייל לא תקינה' }] } },
      },
    },
  },
  Unauthorized: { description: 'לא מחובר / Token חסר, לא תקין או שפג תוקפו (401)', content: errorExample('UNAUTHORIZED', 'נדרשת התחברות (Bearer Token)') },
  Forbidden: { description: 'אין הרשאה לפעולה (403)', content: errorExample('FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו') },
  NotFound: { description: 'לא נמצא (או שייך לקליניקה/משתמש אחר) (404)', content: errorExample('NOT_FOUND', 'הרשומה לא נמצאה') },
  Conflict: { description: 'התנגשות - למשל שעה תפוסה או מייל קיים (409)', content: errorExample('SLOT_TAKEN', 'השעה כבר תפוסה') },
  TooManyRequests: { description: 'יותר מדי בקשות (429)', content: errorExample('TOO_MANY_REQUESTS', 'יותר מדי ניסיונות התחברות. נסי שוב בעוד 15 דקות') },
  ServiceUnavailable: { description: 'השירות לא זמין (503)', content: errorExample('JOBS_DISABLED', 'המשימה כבויה: לא הוגדר CRON_SECRET בשרת') },
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const C: Role[] = ['CLINIC_MANAGER'];
const A: Role[] = ['SUPER_ADMIN'];
const providerIdPath = idPath('מזהה איש המקצוע');

const paths: Record<string, Record<string, Json>> = {
  '/api/health': {
    get: op({
      tag: 'System',
      summary: 'בדיקת חיים לשרת ולמסד הנתונים',
      access: 'public',
      success: { status: 200, description: 'השרת פעיל', example: { status: 'ok', database: 'ok', uptimeSeconds: 120, time: '2026-11-03T14:00:00.000Z' } },
      errors: [503],
    }),
  },

  // ---------------- Auth ----------------
  '/api/auth/register': {
    post: op({
      tag: 'Auth',
      summary: 'הרשמת לקוח חדש',
      description:
        'יוצר חשבון לקוח ומחזיר Token. אם קיים לקוח שנוסף טלפונית עם אותה תעודת זהות **ואותו טלפון** - החשבון "נתבע" והתורים הקיימים מתחברים אליו (claimedExistingClient=true).\n\nסיסמה: לפחות 8 תווים, אות באנגלית וספרה.',
      access: 'public',
      body: {
        schema: {
          type: 'object',
          required: ['fullName', 'email', 'phone', 'nationalId', 'password'],
          properties: {
            fullName: str('שם מלא'),
            email: str('מייל'),
            phone: str('טלפון'),
            nationalId: str('תעודת זהות (9 ספרות עם ספרת ביקורת)'),
            password: str('סיסמה'),
            defaultTravelMinutes: int('זמן הגעה לקליניקה בדקות (לא חובה, ברירת מחדל 30)'),
          },
        },
        example: { fullName: 'ישראל ישראלי', email: 'israel@example.com', phone: '0501234567', nationalId: '123456782', password: 'Secret123', defaultTravelMinutes: 25 },
      },
      success: { status: 201, description: 'נרשם בהצלחה', schema: { allOf: [ref('AuthResponse'), { type: 'object', properties: { claimedExistingClient: bool('חשבון קיים נתבע') } }] } },
      errors: [400, 409, 429],
    }),
  },
  '/api/auth/login': {
    post: op({
      tag: 'Auth',
      summary: 'התחברות - מחזיר JWT',
      description: 'אחרי ההתחברות: העתיקי את ה-token, לחצי על **Authorize** למעלה והדביקי אותו.\n\nחשבונות הדגמה (Seed בפיתוח בלבד): admin@quickq.dev / Admin123!, manager@quickq.dev / Manager123!, client@quickq.dev / Client123!',
      access: 'public',
      body: {
        schema: { type: 'object', required: ['email', 'password'], properties: { email: str('מייל'), password: str('סיסמה') } },
        example: { email: 'client@quickq.dev', password: 'Client123!' },
      },
      success: { status: 200, description: 'התחברות הצליחה', schema: ref('AuthResponse') },
      errors: [400, 401, 403, 429],
    }),
  },
  '/api/auth/me': {
    get: op({
      tag: 'Auth',
      summary: 'הפרטים שלי',
      description: 'עובד גם כשהמשתמש עוד חייב להחליף סיסמה זמנית.',
      access: ['SUPER_ADMIN', 'CLINIC_MANAGER', 'CLIENT'],
      success: {
        status: 200,
        description: 'פרטי המשתמש המחובר',
        schema: { allOf: [ref('User'), { type: 'object', properties: { clinic: { type: 'object', nullable: true } } }] },
      },
    }),
    patch: op({
      tag: 'Auth',
      summary: 'עדכון הפרטים שלי (שם, טלפון, זמן הגעה)',
      access: ['SUPER_ADMIN', 'CLINIC_MANAGER', 'CLIENT'],
      body: {
        schema: { type: 'object', properties: { fullName: str('שם מלא'), phone: str('טלפון'), defaultTravelMinutes: int('זמן הגעה בדקות (0-300)') } },
        example: { defaultTravelMinutes: 45 },
      },
      success: { status: 200, description: 'עודכן', schema: ref('User') },
      errors: [400],
    }),
  },
  '/api/auth/change-password': {
    post: op({
      tag: 'Auth',
      summary: 'החלפת סיסמה (כולל החלפת סיסמה זמנית בכניסה ראשונה)',
      access: ['SUPER_ADMIN', 'CLINIC_MANAGER', 'CLIENT'],
      body: {
        schema: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: str('סיסמה נוכחית'), newPassword: str('סיסמה חדשה') } },
        example: { currentPassword: 'TempPass12', newPassword: 'MyNewPass123' },
      },
      success: { status: 200, description: 'הוחלפה. מוחזר גם Token חדש', schema: { allOf: [ref('Message'), ref('AuthResponse')] } },
      errors: [400],
    }),
  },
  '/api/auth/forgot-password': {
    post: op({
      tag: 'Auth',
      summary: 'שכחתי סיסמה - שליחת קוד בן 6 ספרות למייל',
      description: 'תמיד מחזיר אותה תשובה (כדי לא לחשוף אילו מיילים רשומים). הקוד תקף ל-15 דקות.',
      access: 'public',
      body: { schema: { type: 'object', required: ['email'], properties: { email: str('מייל') } }, example: { email: 'client@quickq.dev' } },
      success: { status: 200, description: 'בקשה התקבלה', schema: ref('Message') },
      errors: [400, 429],
    }),
  },
  '/api/auth/reset-password': {
    post: op({
      tag: 'Auth',
      summary: 'איפוס סיסמה עם הקוד מהמייל',
      description: 'עד 5 ניסיונות לכל קוד.',
      access: 'public',
      body: {
        schema: { type: 'object', required: ['email', 'code', 'newPassword'], properties: { email: str('מייל'), code: str('קוד 6 ספרות'), newPassword: str('סיסמה חדשה') } },
        example: { email: 'client@quickq.dev', code: '482915', newPassword: 'MyNewPass123' },
      },
      success: { status: 200, description: 'הסיסמה עודכנה', schema: ref('Message') },
      errors: [400, 429],
    }),
  },

  // ---------------- Clinics (public) ----------------
  '/api/clinics': {
    get: op({
      tag: 'Clinics (public)',
      summary: 'חיפוש קליניקות עם סינון ומיון',
      access: 'public',
      params: [
        { name: 'q', in: 'query', description: 'חיפוש לפי שם קליניקה או שם איש מקצוע', schema: { type: 'string' }, example: 'לוי' },
        { name: 'category', in: 'query', description: 'סינון לפי תחום', schema: categoryEnum },
        { name: 'city', in: 'query', description: 'סינון לפי עיר', schema: { type: 'string' }, example: 'תל אביב' },
        { name: 'openNow', in: 'query', description: 'רק קליניקות פתוחות עכשיו (התור החי פתוח או בתוך שעות הפעילות)', schema: { type: 'boolean' } },
        { name: 'hasAvailabilityThisWeek', in: 'query', description: 'רק קליניקות עם תור פנוי ב-7 הימים הקרובים', schema: { type: 'boolean' } },
        { name: 'sort', in: 'query', description: 'מיון: לפי שם או לפי התור הפנוי הקרוב', schema: { type: 'string', enum: ['name', 'nextAvailable'], default: 'name' } },
        ...pageParams,
      ],
      success: { status: 200, description: 'רשימת קליניקות', schema: paged('ClinicListItem') },
      errors: [400],
    }),
  },
  '/api/clinics/cities': {
    get: op({
      tag: 'Clinics (public)',
      summary: 'רשימת הערים (לתיבת סינון)',
      access: 'public',
      success: { status: 200, description: 'ערים', example: { cities: ['ירושלים', 'חיפה', 'תל אביב'] } },
    }),
  },
  '/api/clinics/{id}': {
    get: op({
      tag: 'Clinics (public)',
      summary: 'פרטי קליניקה ורשימת אנשי המקצוע',
      access: 'public',
      params: [idPath('מזהה הקליניקה')],
      success: { status: 200, description: 'פרטי קליניקה', schema: ref('ClinicDetails') },
      errors: [400, 404],
    }),
  },

  // ---------------- Providers (public) ----------------
  '/api/providers/{id}/availability': {
    get: op({
      tag: 'Booking (public)',
      summary: 'זמינות לכל יום בחודש (ללוח שנה)',
      access: 'public',
      params: [providerIdPath, { name: 'month', in: 'query', required: true, description: 'חודש בפורמט YYYY-MM', schema: { type: 'string' }, example: '2026-11' }],
      success: { status: 200, description: 'זמינות', schema: ref('MonthAvailability') },
      errors: [400, 404],
    }),
  },
  '/api/providers/{id}/slots': {
    get: op({
      tag: 'Booking (public)',
      summary: 'השעות הפנויות ביום מסוים',
      description: 'שלחי את startTime של המשבצת שנבחרה ל-POST /api/appointments.',
      access: 'public',
      params: [providerIdPath, { name: 'date', in: 'query', required: true, description: 'תאריך YYYY-MM-DD', schema: { type: 'string' }, example: '2026-11-03' }],
      success: { status: 200, description: 'שעות פנויות', schema: ref('DaySlots') },
      errors: [400, 404],
    }),
  },
  '/api/providers/{id}/live': {
    get: op({
      tag: 'Live queue (public)',
      summary: 'מצב התור החי היום',
      description: 'ללא שמות - רק מספרים. מומלץ לרענן כל 20-30 שניות. אם נשלח Token של לקוח עם תור היום אצל איש מקצוע זה - מתווסף myAppointment.',
      access: 'optional',
      params: [providerIdPath],
      success: { status: 200, description: 'מצב התור', schema: ref('LiveStatus') },
      errors: [400, 401, 404],
    }),
  },
  '/api/join-requests': {
    post: op({
      tag: 'Join requests',
      summary: 'שליחת פניית הצטרפות של קליניקה',
      access: 'public',
      body: {
        schema: {
          type: 'object',
          required: ['clinicName', 'category', 'city', 'contactName', 'email', 'phone'],
          properties: {
            clinicName: str('שם הקליניקה'),
            category: categoryEnum,
            city: str('עיר'),
            contactName: str('שם איש הקשר'),
            email: str('מייל'),
            phone: str('טלפון'),
            message: str('הודעה (לא חובה)'),
          },
        },
        example: { clinicName: 'קליניקת שקט', category: 'CONSULTING', city: 'רחובות', contactName: 'הדס לוין', email: 'hadas@example.com', phone: '0541112233', message: 'נשמח להצטרף' },
      },
      success: { status: 201, description: 'הפנייה התקבלה', example: { id: 7, status: 'PENDING', createdAt: '2026-11-03T10:00:00.000Z', message: 'הפנייה התקבלה! ניצור איתך קשר בהקדם' } },
      errors: [400, 429],
    }),
  },

  // ---------------- Appointments (client) ----------------
  '/api/appointments/my': {
    get: op({
      tag: 'Appointments (client)',
      summary: 'התורים שלי',
      access: ['CLIENT'],
      params: [
        { name: 'status', in: 'query', description: 'upcoming=עתידיים, past=עבר, cancelled=בוטלו, all=הכל', schema: { type: 'string', enum: ['upcoming', 'past', 'cancelled', 'all'], default: 'upcoming' } },
        { name: 'from', in: 'query', description: 'מתאריך YYYY-MM-DD', schema: { type: 'string' } },
        { name: 'to', in: 'query', description: 'עד תאריך YYYY-MM-DD', schema: { type: 'string' } },
        ...pageParams,
      ],
      success: { status: 200, description: 'רשימת התורים', schema: paged('Appointment') },
      errors: [400],
    }),
  },
  '/api/appointments': {
    post: op({
      tag: 'Appointments (client)',
      summary: 'קביעת תור',
      description:
        'הלקוח נקבע לפי ה-Token (לא נשלח clientId). השעה חייבת להיות משבצת פנויה (מ-/slots).\n\nשגיאות 409 אפשריות: SLOT_TAKEN, CLIENT_OVERLAP, MAX_FUTURE_APPOINTMENTS, PROVIDER_ABSENT, PROVIDER_INACTIVE.',
      access: ['CLIENT'],
      body: {
        schema: {
          type: 'object',
          required: ['providerId', 'startTime'],
          properties: {
            providerId: int('איש מקצוע'),
            startTime: dt('זמן המשבצת (startTime מ-/slots)'),
            reminderEnabled: bool('לשלוח תזכורת במייל כשצריך לצאת'),
            travelMinutes: int('זמן הגעה לתור זה (לא חובה)', { nullable: true }),
            notes: str('הערה (עד 500 תווים)', { nullable: true }),
          },
        },
        example: { providerId: 1, startTime: '2026-11-03T14:10:00.000Z', reminderEnabled: true, travelMinutes: 30, notes: 'כאב בשן שמאלית' },
      },
      success: { status: 201, description: 'התור נקבע', schema: ref('Appointment') },
      errors: [400, 404, 409],
    }),
  },
  '/api/appointments/{id}': {
    get: op({
      tag: 'Appointments (client)',
      summary: 'פרטי תור',
      description: 'לקוח רואה רק תורים שלו; מנהל קליניקה רק תורים של הקליניקה שלו (אחרת 404).',
      access: ['CLIENT', 'CLINIC_MANAGER', 'SUPER_ADMIN'],
      params: [idPath('מזהה התור')],
      success: { status: 200, description: 'התור', schema: ref('Appointment') },
      errors: [400, 404],
    }),
    patch: op({
      tag: 'Appointments (client)',
      summary: 'עדכון תור: שינוי שעה, תזכורת, זמן הגעה, הערה',
      description: 'שינוי שעה - רק אצל אותו איש מקצוע, ורק עד changeDeadlineHours לפני התור (אחרת 409 CHANGE_DEADLINE_PASSED).',
      access: ['CLIENT'],
      params: [idPath('מזהה התור')],
      body: {
        schema: {
          type: 'object',
          properties: {
            startTime: dt('שעה חדשה (משבצת פנויה)'),
            reminderEnabled: bool('תזכורת'),
            travelMinutes: int('זמן הגעה (null = לפי הפרופיל)', { nullable: true }),
            notes: str('הערה', { nullable: true }),
          },
        },
        example: { startTime: '2026-11-03T14:30:00.000Z', reminderEnabled: true, travelMinutes: 45 },
      },
      success: { status: 200, description: 'עודכן', schema: ref('Appointment') },
      errors: [400, 404, 409],
    }),
  },
  '/api/appointments/{id}/cancel': {
    post: op({
      tag: 'Appointments (client)',
      summary: 'ביטול תור',
      description: 'לקוח: ביטול אחרי המועד שהקליניקה קבעה מסומן isLateCancellation=true. מנהל קליניקה: הלקוח מקבל מייל.',
      access: ['CLIENT', 'CLINIC_MANAGER'],
      params: [idPath('מזהה התור')],
      body: { schema: { type: 'object', properties: { reason: str('סיבה (לא חובה)') } }, example: {} },
      success: { status: 200, description: 'בוטל', schema: ref('Appointment') },
      errors: [400, 404, 409],
    }),
  },

  // ---------------- Manage (clinic manager) ----------------
  '/api/manage/clinic': {
    get: op({ tag: 'Manage: clinic', summary: 'פרטי הקליניקה שלי', access: C, success: { status: 200, description: 'הקליניקה', schema: ref('Clinic') } }),
    patch: op({
      tag: 'Manage: clinic',
      summary: 'עדכון פרטים והגדרות הקליניקה',
      access: C,
      body: {
        schema: {
          type: 'object',
          properties: {
            name: str('שם'),
            city: str('עיר'),
            address: str('כתובת'),
            phone: str('טלפון'),
            description: str('תיאור', { nullable: true }),
            changeDeadlineHours: int('0-168'),
            maxFutureAppointmentsPerProvider: int('1-20'),
            bookingHorizonDays: int('1-365'),
          },
        },
        example: { changeDeadlineHours: 24, maxFutureAppointmentsPerProvider: 2, bookingHorizonDays: 180 },
      },
      success: { status: 200, description: 'עודכן', schema: ref('Clinic') },
      errors: [400],
    }),
  },
  '/api/manage/providers': {
    get: op({ tag: 'Manage: providers', summary: 'אנשי המקצוע בקליניקה (כולל שעות)', access: C, success: { status: 200, description: 'רשימה', schema: { type: 'object', properties: { items: { type: 'array', items: ref('ProviderWithHours') } } } } }),
    post: op({
      tag: 'Manage: providers',
      summary: 'הוספת איש מקצוע',
      access: C,
      body: {
        schema: { type: 'object', required: ['fullName'], properties: { fullName: str('שם'), specialty: str('התמחות', { nullable: true }), slotMinutes: int('משך תור 5-120 (ברירת מחדל 10)') } },
        example: { fullName: 'ד"ר שירה אלון', specialty: 'רופאת ילדים', slotMinutes: 15 },
      },
      success: { status: 201, description: 'נוצר', schema: ref('Provider') },
      errors: [400],
    }),
  },
  '/api/manage/providers/{id}': {
    patch: op({
      tag: 'Manage: providers',
      summary: 'עריכה / השבתה של איש מקצוע',
      description: 'השבתה כשיש תורים עתידיים מחזירה 409 HAS_FUTURE_APPOINTMENTS, אלא אם נשלח cancelFutureAppointments=true (אז התורים מבוטלים והלקוחות מקבלים מייל).',
      access: C,
      params: [providerIdPath],
      body: {
        schema: {
          type: 'object',
          properties: { fullName: str('שם'), specialty: str('התמחות', { nullable: true }), slotMinutes: int('משך תור'), isActive: bool('פעיל'), cancelFutureAppointments: bool('לבטל תורים עתידיים בהשבתה') },
        },
        example: { slotMinutes: 15 },
      },
      success: { status: 200, description: 'עודכן', schema: { allOf: [ref('Provider'), { type: 'object', properties: { cancelledAppointments: int('תורים שבוטלו') } }] } },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/providers/{id}/working-hours': {
    get: op({
      tag: 'Manage: schedule',
      summary: 'שעות הפעילות השבועיות',
      access: C,
      params: [providerIdPath],
      success: { status: 200, description: 'שעות', example: { providerId: 1, hours: [{ dayOfWeek: 0, startTime: '16:00', endTime: '20:00' }] } },
      errors: [404],
    }),
    put: op({
      tag: 'Manage: schedule',
      summary: 'החלפה מלאה של שעות הפעילות',
      description: 'אפשר כמה טווחים ביום (בלי חפיפה). תורים קיימים לא מבוטלים - אם נשארו מחוץ לשעות, מוחזרת אזהרה (warning).',
      access: C,
      params: [providerIdPath],
      body: {
        schema: { type: 'object', required: ['hours'], properties: { hours: { type: 'array', items: ref('WorkingHoursRange') } } },
        example: { hours: [{ dayOfWeek: 0, startTime: '16:00', endTime: '20:00' }, { dayOfWeek: 2, startTime: '09:00', endTime: '13:00' }] },
      },
      success: {
        status: 200,
        description: 'נשמר',
        example: { providerId: 1, hours: [{ dayOfWeek: 0, startTime: '16:00', endTime: '18:00' }], warning: { message: 'שימי לב: 2 תורים קיימים נמצאים מחוץ לשעות החדשות. הם לא בוטלו.', appointmentIds: [41, 42] } },
      },
      errors: [400, 404],
    }),
  },
  '/api/manage/providers/{id}/absences': {
    get: op({ tag: 'Manage: schedule', summary: 'היעדרויות עתידיות של איש מקצוע', access: C, params: [providerIdPath], success: { status: 200, description: 'רשימה', schema: { type: 'object', properties: { items: { type: 'array', items: ref('Absence') } } } }, errors: [404] }),
    post: op({
      tag: 'Manage: schedule',
      summary: 'הוספת היעדרות (יום שלם)',
      description: 'כל התורים באותו יום מבוטלים, והלקוחות מקבלים מייל.',
      access: C,
      params: [providerIdPath],
      body: { schema: { type: 'object', required: ['date'], properties: { date: str('תאריך YYYY-MM-DD'), reason: str('סיבה', { nullable: true }) } }, example: { date: '2026-11-10', reason: 'מחלה' } },
      success: { status: 201, description: 'נוספה', example: { absence: { id: 4, providerId: 1, date: '2026-11-10', reason: 'מחלה', createdAt: '2026-11-03T08:00:00.000Z' }, cancelledAppointments: 6 } },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/absences': {
    post: op({
      tag: 'Manage: schedule',
      summary: 'היעדרות לכמה אנשי מקצוע / לכל הקליניקה (חג, שיפוץ)',
      description: 'בלי providerIds - חל על כל אנשי המקצוע הפעילים.',
      access: C,
      body: {
        schema: { type: 'object', required: ['date'], properties: { date: str('תאריך'), reason: str('סיבה', { nullable: true }), providerIds: { type: 'array', items: { type: 'integer' } } } },
        example: { date: '2026-12-25', reason: 'שיפוץ' },
      },
      success: { status: 201, description: 'נוספו', example: { absences: [], skippedExisting: 0, cancelledAppointments: 12 } },
      errors: [400, 404],
    }),
  },
  '/api/manage/absences/{id}': {
    delete: op({ tag: 'Manage: schedule', summary: 'מחיקת היעדרות', description: 'תורים שכבר בוטלו לא חוזרים.', access: C, params: [idPath('מזהה ההיעדרות')], success: { status: 204, description: 'נמחקה' }, errors: [404] }),
  },
  '/api/manage/providers/{id}/queue': {
    get: op({ tag: 'Manage: live queue', summary: 'התור של היום (כולל שמות)', access: C, params: [providerIdPath], success: { status: 200, description: 'התור', schema: ref('ManagerQueue') }, errors: [404] }),
  },
  '/api/manage/providers/{id}/queue/open': {
    post: op({ tag: 'Manage: live queue', summary: 'פתיחת היום - קובע מספרי תור לפי סדר השעות', access: C, params: [providerIdPath], success: { status: 200, description: 'נפתח', schema: ref('ManagerQueue') }, errors: [404, 409] }),
  },
  '/api/manage/providers/{id}/queue/pause': {
    post: op({ tag: 'Manage: live queue', summary: 'הפסקה', access: C, params: [providerIdPath], success: { status: 200, description: 'בהפסקה', schema: ref('ManagerQueue') }, errors: [404, 409] }),
  },
  '/api/manage/providers/{id}/queue/resume': {
    post: op({ tag: 'Manage: live queue', summary: 'המשך אחרי הפסקה', access: C, params: [providerIdPath], success: { status: 200, description: 'פתוח', schema: ref('ManagerQueue') }, errors: [404, 409] }),
  },
  '/api/manage/providers/{id}/queue/close': {
    post: op({
      tag: 'Manage: live queue',
      summary: 'סגירת היום',
      description: 'מי שבטיפול מסומן "סיים"; מי שלא נכנס מסומן "לא הגיע".',
      access: C,
      params: [providerIdPath],
      success: { status: 200, description: 'נסגר', example: { markedCompleted: 1, markedNoShow: 2, queue: {} } },
      errors: [404, 409],
    }),
  },
  '/api/manage/providers/{id}/queue/next': {
    post: op({
      tag: 'Manage: live queue',
      summary: '"הבא בתור" - מסיים את הנוכחי ומכניס את הבא מבין אלה שסומנו "הגיע"',
      access: C,
      params: [providerIdPath],
      success: { status: 200, description: 'בוצע', example: { completedAppointmentId: 55, startedAppointmentId: 56, startedQueueNumber: 6, message: 'מספר 6 נכנס לטיפול', queue: {} } },
      errors: [404, 409],
    }),
  },
  '/api/manage/appointments': {
    get: op({
      tag: 'Manage: appointments',
      summary: 'יומן התורים של הקליניקה',
      access: C,
      params: [
        { name: 'providerId', in: 'query', description: 'סינון לפי איש מקצוע', schema: { type: 'integer' } },
        { name: 'date', in: 'query', description: 'יום מסוים YYYY-MM-DD', schema: { type: 'string' } },
        { name: 'from', in: 'query', description: 'מתאריך', schema: { type: 'string' } },
        { name: 'to', in: 'query', description: 'עד תאריך', schema: { type: 'string' } },
        { name: 'status', in: 'query', description: 'סטטוס', schema: appointmentStatusEnum },
        { name: 'q', in: 'query', description: 'חיפוש לקוח (שם / טלפון / ת"ז)', schema: { type: 'string' } },
        ...pageParams,
      ],
      success: { status: 200, description: 'תורים', schema: paged('Appointment') },
      errors: [400],
    }),
    post: op({
      tag: 'Manage: appointments',
      summary: 'קביעת תור עבור לקוח (טלפונית)',
      description: 'שלחי clientId של לקוח קיים, **או** client עם פרטי לקוח חדש. אם תעודת הזהות כבר קיימת - התור משויך ללקוח הקיים.',
      access: C,
      body: {
        schema: {
          type: 'object',
          required: ['providerId', 'startTime'],
          properties: {
            providerId: int('איש מקצוע'),
            startTime: dt('זמן'),
            clientId: int('לקוח קיים'),
            client: { type: 'object', properties: { fullName: str('שם'), phone: str('טלפון'), nationalId: str('ת"ז'), email: str('מייל (לא חובה)') } },
            notes: str('הערה', { nullable: true }),
            reminderEnabled: bool('תזכורת'),
            travelMinutes: int('זמן הגעה', { nullable: true }),
          },
        },
        example: { providerId: 1, startTime: '2026-11-03T14:20:00.000Z', client: { fullName: 'משה ישראלי', phone: '0537777777', nationalId: '000000018' } },
      },
      success: { status: 201, description: 'נקבע', schema: { allOf: [ref('Appointment'), { type: 'object', properties: { clientCreated: bool('נוצר לקוח חדש') } }] } },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/appointments/{id}': {
    patch: op({
      tag: 'Manage: appointments',
      summary: 'עריכת תור (שעה / הערה)',
      access: C,
      params: [idPath('מזהה התור')],
      body: { schema: { type: 'object', properties: { startTime: dt('שעה חדשה'), notes: str('הערה', { nullable: true }) } }, example: { notes: 'להביא צילום' } },
      success: { status: 200, description: 'עודכן', schema: ref('Appointment') },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/appointments/{id}/cancel': {
    post: op({
      tag: 'Manage: appointments',
      summary: 'ביטול תור על ידי הקליניקה (נשלח מייל ללקוח)',
      access: C,
      params: [idPath('מזהה התור')],
      body: { schema: { type: 'object', properties: { reason: str('סיבה (מופיעה במייל)') } }, example: { reason: 'הרופא חולה' } },
      success: { status: 200, description: 'בוטל', schema: ref('Appointment') },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/appointments/{id}/status': {
    post: op({
      tag: 'Manage: live queue',
      summary: 'עדכון סטטוס בתור של היום',
      description:
        'מעברים מותרים: BOOKED→ARRIVED/IN_PROGRESS/NO_SHOW · ARRIVED→IN_PROGRESS/NO_SHOW/BOOKED · IN_PROGRESS→COMPLETED/ARRIVED · COMPLETED→IN_PROGRESS · NO_SHOW→ARRIVED/BOOKED (תיקון טעויות).\nרק לקוח אחד יכול להיות בטיפול. היום חייב להיות פתוח.',
      access: C,
      params: [idPath('מזהה התור')],
      body: { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] } } }, example: { status: 'ARRIVED' } },
      success: { status: 200, description: 'עודכן', example: { id: 56, status: 'ARRIVED', queueNumber: 6, arrivedAt: '2026-11-03T14:45:00.000Z', startedAt: null, completedAt: null } },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/appointments/import': {
    post: op({
      tag: 'Manage: import',
      summary: 'ייבוא תורים מקובץ CSV',
      description:
        'עמודות (כותרות בעברית או באנגלית): תאריך, שעה, רופא, שם לקוח, טלפון, תעודת זהות, מייל (לא חובה).\nתאריך: 03/11/2026 · שעה: 16:30 · שם הרופא חייב להיות זהה לשם במערכת.\nמומלץ לשמור מאקסל כ-"CSV UTF-8". שורות תקינות נקלטות, שגויות מדווחות.',
      access: C,
      multipart: true,
      success: { status: 200, description: 'סיכום הייבוא', schema: ref('ImportResult') },
      errors: [400],
    }),
  },
  '/api/manage/appointments/import/template': {
    get: op({
      tag: 'Manage: import',
      summary: 'הורדת קובץ CSV לדוגמה',
      access: C,
      success: { status: 200, description: 'קובץ CSV', contentType: 'text/csv', schema: { type: 'string' } },
    }),
  },
  '/api/manage/clients': {
    get: op({
      tag: 'Manage: clients & staff',
      summary: 'לקוחות שיש להם תורים בקליניקה',
      access: C,
      params: [{ name: 'q', in: 'query', description: 'חיפוש: שם / טלפון / ת"ז / מייל', schema: { type: 'string' } }, ...pageParams],
      success: {
        status: 200,
        description: 'לקוחות',
        schema: { allOf: [ref('Paginated'), { type: 'object', properties: { items: { type: 'array', items: { allOf: [ref('User'), { type: 'object', properties: { appointmentsCount: int('תורים בקליניקה'), lateCancellationCount: int('ביטולים מאוחרים') } }] } } } }] },
      },
    }),
  },
  '/api/manage/clients/{id}': {
    patch: op({
      tag: 'Manage: clients & staff',
      summary: 'עריכת לקוח שנוסף טלפונית',
      description: 'לקוח רשום (עם סיסמה) מנהל את הפרטים שלו בעצמו - 403 CLIENT_SELF_MANAGED.',
      access: C,
      params: [idPath('מזהה הלקוח')],
      body: { schema: { type: 'object', properties: { fullName: str('שם'), phone: str('טלפון'), email: str('מייל', { nullable: true }), nationalId: str('ת"ז') } }, example: { phone: '0537777778' } },
      success: { status: 200, description: 'עודכן', schema: ref('User') },
      errors: [400, 404, 409],
    }),
  },
  '/api/manage/staff': {
    get: op({ tag: 'Manage: clients & staff', summary: 'משתמשי הצוות של הקליניקה', access: C, success: { status: 200, description: 'צוות', schema: { type: 'object', properties: { items: { type: 'array', items: ref('User') } } } } }),
    post: op({
      tag: 'Manage: clients & staff',
      summary: 'הוספת משתמש צוות (מזכירה)',
      description: 'נוצרת סיסמה זמנית שנשלחת במייל (ומוחזרת פעם אחת בתשובה).',
      access: C,
      body: { schema: { type: 'object', required: ['fullName', 'email', 'phone'], properties: { fullName: str('שם'), email: str('מייל'), phone: str('טלפון') } }, example: { fullName: 'רותם שלום', email: 'rotem@example.com', phone: '0501000009' } },
      success: { status: 201, description: 'נוצר', schema: { type: 'object', properties: { user: ref('User'), temporaryPassword: str('סיסמה זמנית') } } },
      errors: [400, 409],
    }),
  },
  '/api/manage/staff/{id}': {
    patch: op({
      tag: 'Manage: clients & staff',
      summary: 'השבתה / הפעלה של משתמש צוות',
      access: C,
      params: [idPath('מזהה המשתמש')],
      body: { schema: { type: 'object', required: ['isActive'], properties: { isActive: bool('פעיל') } }, example: { isActive: false } },
      success: { status: 200, description: 'עודכן', schema: ref('User') },
      errors: [400, 404],
    }),
  },

  // ---------------- Admin ----------------
  '/api/admin/join-requests': {
    get: op({
      tag: 'Admin',
      summary: 'פניות הצטרפות',
      access: A,
      params: [{ name: 'status', in: 'query', description: 'סינון לפי סטטוס', schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] } }, ...pageParams],
      success: { status: 200, description: 'פניות', schema: paged('JoinRequest') },
      errors: [400],
    }),
  },
  '/api/admin/join-requests/{id}/approve': {
    post: op({
      tag: 'Admin',
      summary: 'אישור פנייה - יוצר קליניקה ומנהל אוטומטית',
      description: 'למנהל נשלח מייל עם סיסמה זמנית. אם המייל כבר קיים במערכת - 409 EMAIL_TAKEN, ואפשר לשלוח email אחר.',
      access: A,
      params: [idPath('מזהה הפנייה')],
      body: { schema: { type: 'object', properties: { email: str('מייל חלופי למנהל (לא חובה)') } }, example: {} },
      success: { status: 201, description: 'אושרה', schema: { allOf: [ref('ClinicWithManager'), { type: 'object', properties: { joinRequestId: int('הפנייה') } }] } },
      errors: [400, 404, 409],
    }),
  },
  '/api/admin/join-requests/{id}/reject': {
    post: op({
      tag: 'Admin',
      summary: 'דחיית פנייה',
      access: A,
      params: [idPath('מזהה הפנייה')],
      body: { schema: { type: 'object', properties: { reason: str('סיבה (לא חובה)') } }, example: { reason: 'פרטים חסרים' } },
      success: { status: 200, description: 'נדחתה', schema: ref('JoinRequest') },
      errors: [400, 404, 409],
    }),
  },
  '/api/admin/clinics': {
    get: op({
      tag: 'Admin',
      summary: 'כל הקליניקות (כולל מושבתות)',
      access: A,
      params: [
        { name: 'q', in: 'query', description: 'חיפוש לפי שם / עיר', schema: { type: 'string' } },
        { name: 'category', in: 'query', description: 'תחום', schema: categoryEnum },
        { name: 'isActive', in: 'query', description: 'פעילות / מושבתות', schema: { type: 'boolean' } },
        ...pageParams,
      ],
      success: { status: 200, description: 'קליניקות', schema: paged('Clinic') },
      errors: [400],
    }),
    post: op({
      tag: 'Admin',
      summary: 'יצירת קליניקה ידנית + מנהל',
      access: A,
      body: {
        schema: {
          type: 'object',
          required: ['name', 'category', 'city', 'address', 'phone', 'manager'],
          properties: {
            name: str('שם'),
            category: categoryEnum,
            city: str('עיר'),
            address: str('כתובת'),
            phone: str('טלפון'),
            description: str('תיאור', { nullable: true }),
            manager: { type: 'object', required: ['fullName', 'email', 'phone'], properties: { fullName: str('שם'), email: str('מייל'), phone: str('טלפון') } },
          },
        },
        example: { name: 'מרפאת הגליל', category: 'GENERAL_MEDICINE', city: 'צפת', address: 'ירושלים 5', phone: '046661234', manager: { fullName: 'אלון ברגר', email: 'alon@example.com', phone: '0507778899' } },
      },
      success: { status: 201, description: 'נוצרה', schema: ref('ClinicWithManager') },
      errors: [400, 409],
    }),
  },
  '/api/admin/clinics/{id}': {
    patch: op({
      tag: 'Admin',
      summary: 'עריכה / השבתה / הפעלה של קליניקה',
      description: 'השבתה עם תורים עתידיים דורשת cancelFutureAppointments=true (אחרת 409). קליניקה מושבתת נעלמת מהחיפוש והמנהלים שלה לא יכולים להתחבר.',
      access: A,
      params: [idPath('מזהה הקליניקה')],
      body: {
        schema: {
          type: 'object',
          properties: { name: str('שם'), category: categoryEnum, city: str('עיר'), address: str('כתובת'), phone: str('טלפון'), description: str('תיאור', { nullable: true }), isActive: bool('פעילה'), cancelFutureAppointments: bool('לבטל תורים עתידיים בהשבתה') },
        },
        example: { isActive: false, cancelFutureAppointments: true },
      },
      success: { status: 200, description: 'עודכנה', schema: { allOf: [ref('Clinic'), { type: 'object', properties: { cancelledAppointments: int('תורים שבוטלו') } }] } },
      errors: [400, 404, 409],
    }),
  },
  '/api/admin/users': {
    get: op({
      tag: 'Admin',
      summary: 'כל המשתמשים',
      access: A,
      params: [
        { name: 'role', in: 'query', description: 'תפקיד', schema: { type: 'string', enum: ['SUPER_ADMIN', 'CLINIC_MANAGER', 'CLIENT'] } },
        { name: 'q', in: 'query', description: 'חיפוש: שם / מייל / טלפון / ת"ז', schema: { type: 'string' } },
        { name: 'isActive', in: 'query', description: 'פעילים / מושבתים', schema: { type: 'boolean' } },
        ...pageParams,
      ],
      success: { status: 200, description: 'משתמשים', schema: paged('User') },
      errors: [400],
    }),
  },
  '/api/admin/users/{id}': {
    patch: op({
      tag: 'Admin',
      summary: 'תיקון פרטי משתמש / השבתה',
      description: 'לא ניתן לשנות תפקיד או סיסמה כאן, ולא ניתן להשבית את עצמך. השבתת לקוח עם תורים עתידיים דורשת cancelFutureAppointments=true.',
      access: A,
      params: [idPath('מזהה המשתמש')],
      body: {
        schema: { type: 'object', properties: { fullName: str('שם'), phone: str('טלפון'), email: str('מייל'), nationalId: str('ת"ז (ללקוחות)'), isActive: bool('פעיל'), cancelFutureAppointments: bool('לבטל תורים עתידיים') } },
        example: { email: 'noa.cohen@example.com' },
      },
      success: { status: 200, description: 'עודכן', schema: ref('User') },
      errors: [400, 404, 409],
    }),
  },
  '/api/admin/users/{id}/reset-password': {
    post: op({
      tag: 'Admin',
      summary: 'איפוס סיסמה למשתמש (סיסמה זמנית במייל)',
      access: A,
      params: [idPath('מזהה המשתמש')],
      success: { status: 200, description: 'אופסה', example: { message: 'הסיסמה אופסה ונשלחה במייל למשתמש', temporaryPassword: 'aB3kLm9QxP' } },
      errors: [400, 404],
    }),
  },

  // ---------------- Jobs ----------------
  '/api/jobs/send-reminders': {
    post: op({
      tag: 'System',
      summary: 'שליחת תזכורות (נקרא על ידי cron-job.org)',
      description: 'דורש כותרת x-cron-secret זהה למשתנה הסביבה CRON_SECRET. לא דורש JWT.',
      access: 'public',
      params: [{ name: 'x-cron-secret', in: 'header', required: true, description: 'הסוד מ-CRON_SECRET', schema: { type: 'string' } }],
      success: { status: 200, description: 'הבדיקה רצה', example: { checked: 4, sent: 1, ranAt: '2026-11-03T14:40:00.000Z' } },
      errors: [401, 503],
    }),
  },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'QuickQ API - מערכת תורים חכמה',
    version: '1.0.0',
    description:
      'Backend של QuickQ: קביעת תורים, תור חי עם הערכת זמן, תזכורות במייל וניהול קליניקות.\n\n' +
      '**איך מתחברים מתוך Swagger:**\n' +
      '1. פתחי `POST /api/auth/login` → Try it out → Execute\n' +
      '2. העתיקי את הערך של `token` מהתשובה\n' +
      '3. לחצי על כפתור **Authorize** 🔓 למעלה, הדביקי את ה-token (בלי המילה Bearer) ולחצי Authorize\n' +
      '4. עכשיו אפשר לקרוא ל-Endpoints המוגנים 🔒\n\n' +
      'בלי Token → 401 · Token של תפקיד לא מתאים → 403.\n\n' +
      'כל הזמנים ב-API הם ISO 8601 ב-UTC (למשל `2026-11-03T14:10:00.000Z`). השדות `date`/`time` מוחזרים גם בשעון ישראל.',
  },
  servers: [{ url: '/', description: 'השרת הנוכחי' }],
  tags: [
    { name: 'System', description: 'בריאות השרת ומשימות רקע' },
    { name: 'Auth', description: 'הרשמה, התחברות וסיסמאות' },
    { name: 'Clinics (public)', description: 'חיפוש קליניקות' },
    { name: 'Booking (public)', description: 'לוח שנה ושעות פנויות' },
    { name: 'Live queue (public)', description: 'מסך התור החי' },
    { name: 'Join requests', description: 'פניות הצטרפות של קליניקות' },
    { name: 'Appointments (client)', description: 'התורים של הלקוח' },
    { name: 'Manage: clinic', description: 'מנהל קליניקה - פרטים והגדרות' },
    { name: 'Manage: providers', description: 'מנהל קליניקה - אנשי מקצוע' },
    { name: 'Manage: schedule', description: 'מנהל קליניקה - שעות והיעדרויות' },
    { name: 'Manage: live queue', description: 'מנהל קליניקה - ניהול התור של היום' },
    { name: 'Manage: appointments', description: 'מנהל קליניקה - יומן תורים' },
    { name: 'Manage: import', description: 'מנהל קליניקה - ייבוא CSV' },
    { name: 'Manage: clients & staff', description: 'מנהל קליניקה - לקוחות וצוות' },
    { name: 'Admin', description: 'מנהל על' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'הדביקי כאן את ה-token מ-/api/auth/login' },
    },
    schemas,
    responses: responsesComponents,
  },
  paths,
};
