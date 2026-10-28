# 🚀 מתחילים כאן: איך מעלים את QuickQ לאינטרנט

המדריך הזה מיועד למי שאף פעם לא העלתה שרת לאינטרנט. עברי עליו לפי הסדר, שלב אחרי שלב.

> ⚠️ **הערה חשובה:** האתרים GitHub, Neon, Render ו־cron-job.org משנים מדי פעם את העיצוב שלהם. שמות הכפתורים כאן נכונים למיטב ידיעתי, אבל לא יכולתי לבדוק את המסך העדכני של כל אתר. אם כפתור נקרא קצת אחרת, חפשי משהו דומה במשמעות.

**מה נשתמש בו (הכול חינמי):**

| שירות | בשביל מה |
|---|---|
| **GitHub** | לשמור את קוד הפרויקט באינטרנט |
| **Neon** | מסד הנתונים (PostgreSQL) |
| **Render** | להריץ את השרת |
| **cron-job.org** | לשלוח תזכורות במייל בזמן, ו"להעיר" את השרת |
| **Brevo** (לא חובה) | לשלוח מיילים אמיתיים |

**למה לא מסד הנתונים של Render?** ב־Render, מסד נתונים חינמי **נמחק אחרי 30 יום**. ל־Neon יש מסלול חינמי בלי תאריך תפוגה (עם מגבלת נפח של כחצי GB, שזה הרבה יותר ממה שהפרויקט צריך).

**מגבלות של Render החינמי שכדאי להכיר:**
- השרת "נרדם" אחרי **15 דקות** בלי פניות. הפנייה הראשונה אחרי זה לוקחת כדקה. שירות cron-job.org (בחלק ה) פותר את זה.
- יש **750 שעות** חינם בחודש לכל החשבון. שרת אחד שרץ כל החודש צורך כ־744 שעות, ולכן **אל תפתחי עוד שרת חינמי באותו חשבון**.

---

## חלק א: GitHub (שמירת הקוד)

### 1. פתיחת חשבון
1. היכנסי ל־https://github.com
2. לחצי **Sign up**.
3. הזיני מייל, סיסמה ושם משתמש, ואשרי את המייל שתקבלי.

### 2. יצירת Repository (מאגר)
1. אחרי ההתחברות לחצי על **+** בפינה העליונה, ואז **New repository**.
2. **Repository name:** `quickq-backend`
3. בחרי **Private** (מומלץ) או **Public**.
4. **אל** תסמני "Add a README file". כבר יש לנו README.
5. לחצי **Create repository**.

### 3. חילוץ קובץ ה־ZIP
1. מצאי את הקובץ `quickq-backend.zip` שהורדת.
2. לחצי עליו קליק ימני ובחרי **חלץ הכל...** (Extract All), ואז **חלץ**.
3. תיווצר תיקייה בשם `backend-project`. בתוכה יש את התיקיות `src`, `prisma`, `tests`, `docs` וקבצים כמו `package.json`.

> 💡 **קבצים מוסתרים:** יש קבצים ששמם מתחיל בנקודה (`.gitignore`, `.env.example`, `.node-version`). כדי לראות אותם ב־Windows, פתחי את התיקייה ובחרי בתפריט העליון **תצוגה** ← **הצג** ← **פריטים מוסתרים**.

### 4. העלאת הקבצים דרך הדפדפן
1. בעמוד ה־Repository החדש לחצי על הקישור **uploading an existing file**. אם כבר יש קבצים במאגר, לחצי **Add file** ← **Upload files**.
2. פתחי את התיקייה `backend-project` במחשב.
3. סמני **את כל התוכן שבתוך התיקייה** (Ctrl+A), כולל התיקיות והקבצים המוסתרים, וגררי אותם לחלון של GitHub.
   - ❗ גררי את **מה שבתוך** `backend-project`, ולא את התיקייה עצמה. הקובץ `package.json` חייב להיות בשורש ה־Repository.
4. חכי שכל הקבצים יעלו. בתחתית, תחת **Commit changes**, לחצי **Commit changes**.

> ❌ **לעולם אל תעלי קובץ בשם `.env`**, כי הוא מכיל סיסמאות. ב־ZIP אין קובץ כזה, ויש רק `.env.example`, שבטוח להעלות.

### 5. בדיקה שהקבצים נמצאים ב־GitHub
ודאי שבעמוד הראשי של ה־Repository רואים:
- את התיקיות `src`, `prisma`, `tests` ו־`docs`
- את הקבצים `package.json`, `package-lock.json`, `render.yaml` ו־`README.md`
- בתוך `prisma/migrations` צריכה להיות תיקייה שמתחילה במספר, ובתוכה `migration.sql`

אם חסרה התיקייה `prisma/migrations`, השרת לא יצליח ליצור את הטבלאות. במקרה כזה העלי אותה שוב.

---

## חלק ב: מסד נתונים ב־Neon

### 1. פתיחת חשבון
1. היכנסי ל־https://neon.com (או https://neon.tech)
2. לחצי **Sign up**. אפשר להירשם עם חשבון GitHub או Google.

### 2. יצירת מסד נתונים
1. אחרי ההרשמה תתבקשי ליצור **Project**. אם לא, לחצי **New Project**.
2. **Project name:** `quickq`
3. **Postgres version:** השאירי את ברירת המחדל.
4. **Region:** בחרי אזור באירופה, למשל **Frankfurt**, כי הוא קרוב לשרת שנפתח ב־Render.
5. לחצי **Create project**.

### 3. קבלת כתובת החיבור (Connection String)
1. בלוח הבקרה של הפרויקט לחצי **Connect**.
2. ודאי שהאפשרות **Connection pooling** **כבויה**. כתובת רגילה, בלי המילה `-pooler`, היא המתאימה ביותר להרצת ה־Migrations.
3. העתיקי את הכתובת. היא נראית בערך כך:
   ```
   postgresql://neondb_owner:abc123XYZ@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

### 4. שמירה בטוחה
- הכתובת הזו מכילה **סיסמה**. אל תשלחי אותה לאף אחד, אל תשימי אותה בקוד ואל תעלי אותה ל־GitHub.
- שמרי אותה זמנית בקובץ טקסט אצלך במחשב, או בכלי לניהול סיסמאות.

### 5. חיבור השרת למסד הנתונים
את הכתובת נדביק ב־Render בשלב הבא, במשתנה `DATABASE_URL`. את הטבלאות לא צריך ליצור ידנית: השרת יוצר אותן בעצמו בכל הפעלה, באמצעות `prisma migrate deploy`.

---

## חלק ג: הפעלת השרת ב־Render

### 1. פתיחת חשבון
1. היכנסי ל־https://render.com
2. לחצי **Get Started** והירשמי, הכי פשוט עם **GitHub**.

### 2. חיבור GitHub
אם נרשמת עם GitHub, Render יבקש הרשאה לגשת ל־Repositories. אפשר לאשר גישה רק ל־`quickq-backend`.

### 3. יצירת Web Service
1. בלוח הבקרה לחצי **New** (או **+ New**) ← **Web Service**.
2. בחרי מקור: **Git Provider** / **GitHub**.

### 4. בחירת ה־Repository
בחרי את `quickq-backend` מהרשימה ולחצי **Connect**.

### 5. הגדרות Build ו־Start
מלאי בדיוק כך:

| שדה | ערך |
|---|---|
| **Name** | `quickq-api` (זה יהיה חלק מהכתובת) |
| **Region** | `Frankfurt (EU Central)` |
| **Branch** | `main` |
| **Root Directory** | השאירי ריק |
| **Language / Runtime** | `Node` |
| **Build Command** | `npm run render:build` |
| **Start Command** | `npm run render:start` |
| **Instance Type** | **Free** |

### 6. משתני סביבה (Environment Variables)
באותו עמוד, תחת **Environment Variables**, לחצי **Add Environment Variable** לכל שורה:

| Key | Value | הסבר |
|---|---|---|
| `NODE_ENV` | `production` | חובה |
| `DATABASE_URL` | הכתובת מ־Neon | חובה |
| `JWT_SECRET` | מחרוזת אקראית של 40 תווים לפחות | חובה. אפשר ללחוץ **Generate**, אם הכפתור מופיע |
| `CRON_SECRET` | מחרוזת אקראית אחרת | בשביל התזכורות (חלק ה) |
| `CORS_ORIGINS` | כתובת אתר ה־React, למשל `https://quickq.vercel.app` | בינתיים אפשר לרשום `*` |
| `APP_TIMEZONE` | `Asia/Jerusalem` | |
| `SEED_ADMIN_EMAIL` | המייל שלך | יוצר מנהל על בהפעלה הראשונה |
| `SEED_ADMIN_PASSWORD` | סיסמה חזקה (8 תווים לפחות, עם אות וספרה) | **אל** תשתמשי בסיסמה מהמדריך |
| `SEED_DEMO_DATA` | `true` | ליצירת קליניקות ותורים לדוגמה (לא חובה) |
| `SEED_DEMO_PASSWORD` | סיסמה לכל משתמשי הדוגמה | רק אם `SEED_DEMO_DATA=true` |

> 🔐 **ליצירת מחרוזת אקראית:** אם Node.js מותקן אצלך, הריצי בטרמינל:
> ```
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```
> אפשר גם פשוט להקליד בעצמך 40 תווים אקראיים.

**לא חובה, בשביל מייל אמיתי** (ראי חלק ו): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. בלי ההגדרות האלה, המיילים מודפסים ללוג של השרת ולא נשלחים באמת.

### 7. הפעלת Prisma Migrations
**לא צריך לעשות שום דבר ידני.** הפקודה `npm run render:start` מריצה בכל הפעלה, לפי הסדר:
1. `prisma migrate deploy`: יוצרת או מעדכנת את הטבלאות במסד הנתונים.
2. `prisma db seed`: יוצרת את מנהל העל (ונתוני הדגמה, אם ביקשת). אם הם כבר קיימים, היא לא נוגעת בהם.
3. מפעילה את השרת.

### 8. Deploy
1. לחצי על **Advanced** ובשדה **Health Check Path** רשמי `/api/health`.
2. לחצי **Deploy Web Service** (או **Create Web Service**).
3. תיפתח מסך עם **Logs**. ה־Build הראשון לוקח כמה דקות. חכי עד שתראי:
   ```
   All migrations have been successfully applied.
   ✅ Super admin created: ...
   🚀 QuickQ API running on port ...
   ```
4. למעלה יופיע הסטטוס **Live** 🟢.

> 💡 **דרך חלופית:** בפרויקט יש קובץ `render.yaml`. אפשר לבחור **New** ← **Blueprint**, ו־Render ימלא את רוב ההגדרות לבד. את הערכים הסודיים (DATABASE_URL ועוד) תתבקשי להזין ידנית.

### 9. בדיקה שהשרת פעיל
בראש העמוד ב־Render מופיעה הכתובת של השרת, למשל `https://quickq-api.onrender.com`. פתחי בדפדפן:
```
https://quickq-api.onrender.com/api/health
```
צריך לראות:
```json
{"status":"ok","database":"ok", ...}
```

---

## חלק ד: בדיקה מלאה

נניח שהכתובת שלך היא `https://quickq-api.onrender.com`.

| # | מה בודקים | איך |
|---|---|---|
| 1 | `/api/health` | פתחי את `https://quickq-api.onrender.com/api/health` ← `"status":"ok"` |
| 2 | Swagger | פתחי את `https://quickq-api.onrender.com/api-docs` ← אמור להופיע עמוד תיעוד עם כל ה־Endpoints |
| 3 | התחברות מתוך Swagger | פתחי **Auth** ← `POST /api/auth/login` ← **Try it out**. בגוף הבקשה הזיני את `SEED_ADMIN_EMAIL` ואת `SEED_ADMIN_PASSWORD`, ואז **Execute** |
| 4 | קבלת JWT | בתשובה (Code 200) יש שדה `"token"`. העתיקי את הערך שלו, בלי המרכאות |
| 5 | Authorize | גללי למעלה ולחצי על הכפתור הירוק **Authorize** 🔓. הדביקי את ה־token (בלי המילה Bearer), לחצי **Authorize** ואז **Close** |
| 6 | Endpoint מוגן | פתחי `GET /api/auth/me` ← **Try it out** ← **Execute** ← אמור להתקבל **200** עם הפרטים שלך |
| 7 | הוספת רשומה | פתחי `POST /api/admin/clinics` ← **Try it out**. הדוגמה כבר מולאה, אז לחצי **Execute** ← **201** |
| 8 | שליפה מהמסד | פתחי `GET /api/admin/clinics` ← **Execute** ← הקליניקה שיצרת מופיעה ברשימה. היא באמת נשמרה במסד הנתונים |

**בדיקת 401 ו־403:**
- לחצי **Authorize** ← **Logout** ← הריצי שוב `GET /api/auth/me` ← אמור להתקבל **401**.
- התחברי כלקוח. אם הפעלת נתוני הדגמה: `client@quickq.dev` עם הסיסמה מ־`SEED_DEMO_PASSWORD`. עשי Authorize עם ה־token שלו, והריצי `GET /api/admin/users` ← אמור להתקבל **403**.

---

## חלק ה: תזכורות במייל ו"השכמת" השרת (cron-job.org)

1. היכנסי ל־https://cron-job.org והירשמי (**Sign up**).
2. לחצי **Create cronjob**.
3. מלאי:
   - **Title:** `QuickQ reminders`
   - **URL:** `https://quickq-api.onrender.com/api/jobs/send-reminders`
   - **Execution schedule:** **Every 5 minutes**
4. בלשונית **Advanced**:
   - **Request method:** `POST`
   - **Headers** ← הוסיפי: Key `x-cron-secret`, Value = **אותו ערך בדיוק** כמו `CRON_SECRET` ב־Render
5. לחצי **Create** (או **Save**).
6. אחרי כמה דקות, ב־**History** של המשימה אמור להופיע **200** 🟢.

כך השרת נשאר ער, והתזכורות נשלחות בזמן.

---

## חלק ו (לא חובה): מיילים אמיתיים עם Brevo

בלי ההגדרה הזו המערכת עובדת מצוין, אבל המיילים רק מודפסים ל־**Logs** ב־Render.

1. הירשמי ב־https://www.brevo.com. יש מסלול חינמי, ולפי מה שידוע לי הוא מוגבל לכ־300 מיילים ביום.
2. אמתי את כתובת השולח: **Senders** ← **Add a sender**.
3. בהגדרות, חפשי **SMTP & API** ← **SMTP** וצרי **SMTP key**.
4. ב־Render ← **Environment** הוסיפי:

| Key | Value |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | ה־Login שמופיע בעמוד ה־SMTP של Brevo |
| `SMTP_PASS` | ה־SMTP key |
| `EMAIL_FROM` | `QuickQ <המייל-שאימתת@example.com>` |

5. שמרי. Render יפעיל את השרת מחדש אוטומטית.

---

## חלק ז: פתרון תקלות

| תקלה | איך מזהים | פתרון |
|---|---|---|
| **Build Failed** | ב־Logs: `npm ERR!` או `error TS` | ודאי שהקבצים `package.json` ו־`package-lock.json` נמצאים **בשורש** ה־Repository ולא בתוך תיקייה נוספת. ודאי שה־Build Command הוא `npm run render:build` |
| **DATABASE_URL שגוי** | `P1001: Can't reach database server` או `P1000: Authentication failed` | העתיקי שוב את הכתובת מ־Neon, בלי רווחים ובלי מרכאות. ודאי שבסוף יש `?sslmode=require` |
| **בעיית Prisma** | `P3005`, `P3009` או `migration failed` | ודאי שהתיקייה `prisma/migrations` הועלתה ל־GitHub. אם המסד מכיל טבלאות ישנות מניסיון קודם, הכי פשוט ליצור ב־Neon מסד נתונים חדש ולעדכן את `DATABASE_URL` |
| **JWT_SECRET חסר** | `Invalid environment variables: JWT_SECRET` | הוסיפי `JWT_SECRET` עם לפחות 32 תווים |
| **שגיאת CORS** | בדפדפן (Console) של אתר ה־React: `blocked by CORS policy` | ב־`CORS_ORIGINS` רשמי את הכתובת המדויקת של אתר ה־React, בלי `/` בסוף, למשל `https://quickq.vercel.app,http://localhost:5173` |
| **401** | `UNAUTHORIZED`, `INVALID_TOKEN` או `TOKEN_EXPIRED` | חסר Token, או שפג תוקפו (8 שעות). התחברי מחדש ועשי Authorize שוב. ודאי ששלחת `Authorization: Bearer <token>` |
| **403** | `FORBIDDEN` | התחברת עם משתמש שאין לו הרשאה (למשל לקוח שמנסה פעולת מנהל). `PASSWORD_CHANGE_REQUIRED` = צריך קודם להחליף סיסמה זמנית ב־`/api/auth/change-password` |
| **Swagger לא נפתח** | `/api-docs` לא נטען | ודאי שהכתובת היא `/api-docs` ולא `/api/docs`. אם השרת ישן, חכי כדקה ורענני |
| **השרת לא עולה** | הסטטוס נשאר **Deploying** או **Failed** | פתחי **Logs** וחפשי את השורה הראשונה עם `Error`. ודאי שהוגדרו `DATABASE_URL`, `JWT_SECRET` ו־`NODE_ENV` |
| **הבקשה הראשונה איטית מאוד** | לוקח כדקה | זה נורמלי במסלול החינמי: השרת "התעורר". cron-job.org (חלק ה) מונע את זה |
| **מנהל העל לא נוצר** | ב־Logs: `no admin created` | ודאי ש־`SEED_ADMIN_PASSWORD` מכילה לפחות 8 תווים עם אות וספרה, ופרסי מחדש: **Manual Deploy** ← **Deploy latest commit** |
| **cron-job.org מחזיר 401** | ב־History | הערך של `x-cron-secret` לא זהה ל־`CRON_SECRET`. שימי לב לרווחים |
| **cron-job.org מחזיר 503** | `JOBS_DISABLED` | לא הוגדר `CRON_SECRET` ב־Render |

---

## הרצה במחשב שלך (לפיתוח React)

1. התקיני **Node.js LTS** מ־https://nodejs.org
2. ב־Neon צרי מסד נתונים נוסף לבדיקות: **Databases** ← **New Database** ← שם `quickq_test`.
3. בתיקיית הפרויקט צרי קובץ בשם `.env`. העתיקי לתוכו את התוכן של `.env.example` ומלאי:
   - `DATABASE_URL` = כתובת Neon (אפשר להשתמש במסד נפרד לפיתוח)
   - `TEST_DATABASE_URL` = אותה כתובת, אבל עם `quickq_test` במקום `neondb`
   - `JWT_SECRET` = מחרוזת אקראית
4. פתחי טרמינל בתיקייה והריצי:
   ```
   npm install
   npx prisma migrate deploy
   npm run db:seed
   npm run dev
   ```
5. פתחי את http://localhost:3000/api-docs

> ⚠️ `npm run db:seed` **מוחק את כל הנתונים** במסד שאליו הוא מחובר ויוצר נתוני הדגמה. אל תריצי אותו על המסד של האתר החי.

**חשבונות הדגמה במחשב המקומי** (רק אחרי `db:seed` במצב פיתוח):

| תפקיד | מייל | סיסמה |
|---|---|---|
| מנהל על | admin@quickq.dev | Admin123! |
| מנהלת קליניקה | manager@quickq.dev | Manager123! |
| מזכירה | secretary@quickq.dev | Manager123! |
| לקוחה | client@quickq.dev | Client123! |

בהצלחה! 🎉
