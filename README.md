# QuickQ — Backend למערכת תורים חכמה

**QuickQ** ("תור מהיר") היא מערכת לניהול תורים בקליניקות. מה שמייחד אותה הוא **מסך תור חי**: הלקוח רואה מהבית כמה אנשים לפניו, מה העיכוב ומתי כדאי לו לצאת מהבית. אם ביקש, הוא גם מקבל תזכורת במייל.

> 🚀 **להעלאה לאינטרנט:** [START-HERE.md](START-HERE.md)
> 📘 **לכתיבת צד ה־React:** [FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md)
> 📋 **האפיון המאושר:** [docs/SPEC.md](docs/SPEC.md)
> 🧪 **תוצאות בדיקות:** [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md)

---

## טכנולוגיות

| תחום | טכנולוגיה |
|---|---|
| שפה וסביבה | Node.js 22 LTS, TypeScript 5.9 (strict) |
| שרת | Express 5 |
| מסד נתונים | PostgreSQL + Prisma ORM 6 |
| ולידציה | Zod 4 |
| אימות | JWT (jsonwebtoken) + bcrypt (bcryptjs) |
| תיעוד | OpenAPI 3 + Swagger UI (`/api-docs`) |
| אבטחה | helmet, CORS ניתן להגדרה, הגבלת ניסיונות (express-rate-limit) |
| מיילים | nodemailer (SMTP, למשל Brevo). בלי SMTP, המיילים מודפסים ללוג |
| קבצים | multer + csv-parse + iconv-lite (ייבוא CSV בעברית) |
| בדיקות | Vitest + Supertest + swagger-parser |

אין תלות בשירות AI או בשירות בתשלום.

---

## מבנה הפרויקט

```
backend-project/
├── src/
│   ├── server.ts              # הפעלת השרת + בדיקת תזכורות פנימית
│   ├── app.ts                 # הרכבת Express: middleware, routes, swagger
│   ├── config/env.ts          # קריאה ובדיקה של משתני סביבה (Zod)
│   ├── db/prisma.ts           # חיבור למסד הנתונים
│   ├── auth/jwt.ts            # יצירה ואימות של JWT
│   ├── middleware/            # authenticate, authorize, error-handler, rate-limit
│   ├── services/              # לוגיקה משותפת: scheduling, queue, reminders, email, cancellation
│   ├── utils/                 # זמנים (שעון ישראל), ת"ז, סיסמאות, ולידציה, serializers
│   ├── docs/openapi.ts        # מסמך OpenAPI
│   └── modules/               # לכל תחום: *.routes.ts / *.controller.ts / *.service.ts / *.schemas.ts
│       ├── auth/              # הרשמה, התחברות, סיסמאות
│       ├── clinics/           # חיפוש קליניקות (ציבורי)
│       ├── providers/         # לוח שנה, שעות פנויות, תור חי (ציבורי)
│       ├── appointments/      # התורים של הלקוח
│       ├── join-requests/     # פניות הצטרפות
│       ├── manage/            # מנהל קליניקה (+ import.service.ts לייבוא CSV)
│       ├── admin/             # מנהל על
│       ├── jobs/              # Endpoint לתזכורות (cron)
│       └── health/            # GET /api/health
├── prisma/
│   ├── schema.prisma          # 9 טבלאות
│   ├── migrations/            # Migrations ל-PostgreSQL
│   └── seed.ts                # נתוני הדגמה
├── tests/                     # 192 בדיקות אוטומטיות
├── scripts/export-openapi.ts  # יוצר docs/openapi.json
├── docs/                      # אפיון, openapi.json, קובץ CSV לדוגמה, תוצאות בדיקות
├── render.yaml                # הגדרת פריסה ל-Render
├── START-HERE.md              # מדריך העלאה לאינטרנט (עברית פשוטה)
└── FRONTEND-API-GUIDE.md      # מדריך API לצד ה-React
```

---

## הרצה מקומית

**דרישות:** Node.js 20 ומעלה (מומלץ 22 LTS), ומסד נתונים PostgreSQL. אפשר מקומי, ואפשר מסד חינמי ב־Neon (הוראות ב־START-HERE).

```bash
npm install
cp .env.example .env          # ומלאי DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET
npx prisma migrate deploy     # יצירת הטבלאות
npm run db:seed               # נתוני הדגמה (מוחק את הנתונים הקיימים!)
npm run dev                   # http://localhost:3000/api-docs
```

### פקודות

| פקודה | מה עושה |
|---|---|
| `npm run dev` | שרת פיתוח שמתרענן אוטומטית |
| `npm run build` | Prisma generate + קומפילציה ל־`dist/` |
| `npm start` | הרצת הגרסה המקומפלת |
| `npm run typecheck` | בדיקת TypeScript |
| `npm test` | הרצת כל הבדיקות (דורש `TEST_DATABASE_URL`) |
| `npm run db:migrate` | יצירת Migration חדש אחרי שינוי ב־schema (פיתוח) |
| `npm run db:deploy` | הרצת Migrations (Production) |
| `npm run db:seed` | נתוני הדגמה |
| `npm run db:studio` | ממשק גרפי לצפייה במסד הנתונים |
| `npm run openapi:export` | עדכון `docs/openapi.json` |
| `npm run render:build` / `render:start` | הפקודות שמשמשות את Render |

### חשבונות הדגמה (רק במצב פיתוח, אחרי `db:seed`)

| תפקיד | מייל | סיסמה |
|---|---|---|
| מנהל על | admin@quickq.dev | Admin123! |
| מנהלת קליניקה ("חיוך") | manager@quickq.dev | Manager123! |
| מזכירה ("חיוך") | secretary@quickq.dev | Manager123! |
| מנהל קליניקה ("בריאות לכל") | manager2@quickq.dev | Manager123! |
| לקוחה | client@quickq.dev | Client123! |
| לקוחות נוספים | client2…client6@quickq.dev | Client123! |

ה־Seed יוצר תור חי **פתוח היום** אצל ד"ר רונית לוי (`/api/providers/1/live`), עם טיפולים שהסתיימו, לקוח בטיפול, ממתינים, ותור של client@quickq.dev עם תזכורת.

**ב־Production** ה־Seed לא יוצר סיסמאות ידועות. הוא יוצר מנהל על רק מתוך `SEED_ADMIN_EMAIL` ו־`SEED_ADMIN_PASSWORD`, ונתוני הדגמה רק עם `SEED_DEMO_DATA=true` ו־`SEED_DEMO_PASSWORD`. הוא גם לא מוחק נתונים.

---

## משתני סביבה

| משתנה | חובה | ברירת מחדל | תיאור |
|---|:-:|---|---|
| `DATABASE_URL` | ✅ | | כתובת PostgreSQL |
| `JWT_SECRET` | ✅ | | לפחות 32 תווים |
| `JWT_EXPIRES_IN` | | `8h` | תוקף Token |
| `PORT` | | `3000` | ב־Render נקבע אוטומטית |
| `NODE_ENV` | | `development` | `production` בענן |
| `CORS_ORIGINS` | | `*` | כתובות מורשות, מופרדות בפסיק |
| `APP_TIMEZONE` | | `Asia/Jerusalem` | |
| `CRON_SECRET` | | | סוד ל־`/api/jobs/send-reminders`. אם ריק, ה־Endpoint כבוי |
| `REMINDER_INTERVAL_SECONDS` | | `60` | בדיקת תזכורות פנימית (0 = כבוי) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | | | שליחת מיילים. בלי `SMTP_HOST` המיילים מודפסים ללוג |
| `FRONTEND_URL` | | `http://localhost:5173` | קישור שמופיע במיילים |
| `TEST_DATABASE_URL` | לבדיקות | | חייב להכיל `test` בשם המסד |
| `SEED_*` | | | ראי למעלה |

---

## עיקרי האבטחה

- סיסמאות נשמרות כ־**bcrypt hash**. קודי שחזור נשמרים כ־SHA-256, חד־פעמיים, תקפים ל־15 דקות ועד 5 ניסיונות.
- **JWT** עם תוקף מוגבל, נחתם ב־HS256 עם סוד ממשתנה סביבה.
- המשתמש מזוהה **רק לפי ה־Token**. התפקיד והסטטוס נטענים מחדש ממסד הנתונים בכל בקשה, כך שמשתמש מושבת נחסם מיד.
- **401** בלי Token או עם Token לא תקין או שפג תוקפו. **403** כשאין הרשאה.
- מנהל קליניקה מוגבל לקליניקה שלו. ניסיון לגשת לרשומה של קליניקה או לקוח אחר מחזיר **404**, כדי לא לחשוף שהרשומה קיימת.
- מסך התור הציבורי לא מציג שמות, רק מספרים.
- תשובות API לעולם לא כוללות `passwordHash` או סודות.
- הגבלת ניסיונות: התחברות (10 ב־15 דקות), טפסים ציבוריים (10 בשעה), כללי (300 בדקה).
- קביעת תור רצה בתוך **טרנזקציה עם נעילת שורה**, ולכן אין קביעה כפולה גם בבקשות מקבילות. בנוסף נבדקת **חפיפה בזמן**, ולא רק שעת התחלה זהה.
- helmet (כותרות אבטחה) ו־CORS ניתן להגדרה.

---

## Endpoints

התיעוד המלא, עם דוגמאות וקודי שגיאה, נמצא ב־**`/api-docs`** (Swagger) ובקובץ `docs/openapi.json`.
סיכום לפי תחומים נמצא ב־[FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md).

---

## הערות ומגבלות ידועות

- **תזכורות:** נשלח מייל אחד לכל תור. אם העיכוב גדל אחרי שהמייל נשלח, לא נשלח מייל נוסף (זו החלטה מתוך האפיון).
- **Render החינמי** "נרדם" אחרי 15 דקות. לכן cron-job.org קורא ל־`/api/jobs/send-reminders` כל 5 דקות. ההסבר ב־START-HERE.
- **npm audit** מדווח על פגיעות בחבילה `deepmerge-ts`, שמשמשת רק את כלי שורת הפקודה של Prisma (`prisma` CLI, בזמן Build ו־Migrations) ולא את השרת שרץ. התיקון היחיד הזמין דורש מעבר לגרסה ראשית חדשה של Prisma, ולכן לא בוצע.
