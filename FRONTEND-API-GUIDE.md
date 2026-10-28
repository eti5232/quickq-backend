# 📘 מדריך API לצד ה־React של QuickQ

המסמך מסביר איך צד ה־React מדבר עם השרת. **אין כאן קוד React.** את הקוד את כותבת בעצמך, והמסמך מתאר רק מה לשלוח ומה מקבלים.

📚 התיעוד המלא והאינטראקטיבי נמצא ב־Swagger: `<BASE_URL>/api-docs`

---

## 1. כתובת השרת (Base URL)

| סביבה | Base URL |
|---|---|
| במחשב שלך | `http://localhost:3000` |
| בענן (Render) | `https://quickq-api.onrender.com`, או הכתובת שקיבלת |

כל הנתיבים מתחילים ב־`/api`, למשל `https://quickq-api.onrender.com/api/clinics`.

💡 **טיפ:** שמרי את ה־Base URL במשתנה סביבה של פרויקט ה־React (למשל `VITE_API_URL`), כדי שלא תצטרכי לשנות קוד במעבר בין המחשב לענן.

⚠️ **CORS:** כתובת אתר ה־React שלך חייבת להופיע במשתנה `CORS_ORIGINS` בשרת. ברירת המחדל לפיתוח היא `http://localhost:5173`.

---

## 2. התחברות (Authentication)

1. שולחים `POST /api/auth/login` עם מייל וסיסמה.
2. מקבלים `token` (JWT) ופרטי משתמש, כולל `role`.
3. שומרים את ה־token, למשל ב־localStorage.
4. **בכל בקשה מוגנת** שולחים את הכותרת:
   ```
   Authorization: Bearer <token>
   ```
5. ה־token תקף ל־**8 שעות**. אם מתקבל `401` עם `TOKEN_EXPIRED` או `INVALID_TOKEN`, מוחקים את ה־token ומעבירים את המשתמש למסך ההתחברות.
6. **התנתקות** = פשוט למחוק את ה־token בצד הלקוח. אין צורך לפנות לשרת.

### לפי איזה שדה מחליטים לאן לנווט אחרי התחברות?
| `user.role` | מסך ראשי מומלץ |
|---|---|
| `CLIENT` | חיפוש קליניקות / התורים שלי |
| `CLINIC_MANAGER` | ניהול התור של היום |
| `SUPER_ADMIN` | פניות הצטרפות |

אם `user.mustChangePassword === true`, מעבירים **קודם** למסך "החלפת סיסמה". עד שהסיסמה מוחלפת, השרת מחזיר `403 PASSWORD_CHANGE_REQUIRED` כמעט לכל בקשה.

### דוגמה
**בקשה:**
```http
POST /api/auth/login
Content-Type: application/json

{ "email": "client@quickq.dev", "password": "Client123!" }
```
**תשובה 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "8h",
  "user": {
    "id": 3, "role": "CLIENT", "fullName": "נועה כהן", "email": "client@quickq.dev",
    "phone": "0521111111", "nationalId": "312345671", "defaultTravelMinutes": 30,
    "mustChangePassword": false, "isActive": true, "isRegistered": true, "clinicId": null,
    "createdAt": "2026-10-01T08:00:00.000Z"
  }
}
```

---

## 3. זמנים ותאריכים — חשוב!

- כל הזמנים שהשרת מחזיר ומקבל הם **ISO 8601 ב־UTC**, למשל `"2026-11-03T14:10:00.000Z"` (זה 16:10 בשעון ישראל).
- בתורים השרת מחזיר בנוסף `date` (`"2026-11-03"`) ו־`time` (`"16:10"`) **בשעון ישראל**, כך שאפשר להציג אותם ישירות.
- **בקביעת תור** שולחים בדיוק את ה־`startTime` שהתקבל מרשימת השעות הפנויות (`/slots`). אין צורך לחשב בעצמך.
- תאריכים בלי שעה (`date`, `from`, `to`) נשלחים בפורמט `YYYY-MM-DD`.
- ימים בשבוע: `0` = ראשון ... `6` = שבת.

---

## 4. מבנה שגיאות אחיד

כל שגיאה חוזרת באותו מבנה:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "הנתונים שנשלחו אינם תקינים",
    "details": [ { "field": "email", "message": "כתובת מייל לא תקינה" } ]
  }
}
```
- `message` כתוב בעברית, ואפשר להציג אותו ישירות למשתמש.
- `code` קבוע באנגלית. השתמשי בו בקוד כדי להחליט מה לעשות.
- `details` מופיע בשגיאות ולידציה, ומאפשר לסמן שדה ספציפי בטופס.

| קוד HTTP | משמעות | מה עושים בצד ה־React |
|---|---|---|
| 400 | נתונים לא תקינים | מציגים את השגיאות ליד השדות |
| 401 | לא מחובר / Token לא תקין | מעבירים למסך התחברות |
| 403 | אין הרשאה | מציגים "אין הרשאה". אם `PASSWORD_CHANGE_REQUIRED`, מעבירים להחלפת סיסמה |
| 404 | לא נמצא | "הפריט לא נמצא" |
| 409 | התנגשות (שעה תפוסה, מייל קיים...) | מציגים את `message`. ב־`SLOT_TAKEN` כדאי לרענן את רשימת השעות |
| 429 | יותר מדי ניסיונות | "נסי שוב מאוחר יותר" |
| 500 | שגיאת שרת | "משהו השתבש" |

### קודי שגיאה חשובים (`error.code`)
| קוד | מתי |
|---|---|
| `INVALID_CREDENTIALS` | מייל או סיסמה שגויים |
| `TOKEN_EXPIRED` / `INVALID_TOKEN` | צריך להתחבר מחדש |
| `PASSWORD_CHANGE_REQUIRED` | צריך להחליף סיסמה זמנית |
| `EMAIL_TAKEN` / `NATIONAL_ID_TAKEN` | ההרשמה נכשלה, הפרט כבר קיים |
| `CLAIM_PHONE_MISMATCH` | יש לקוח עם ת"ז זו אבל הטלפון שונה |
| `SLOT_TAKEN` | השעה נתפסה הרגע |
| `CLIENT_OVERLAP` | ללקוח כבר יש תור חופף |
| `MAX_FUTURE_APPOINTMENTS` | הגעת למקסימום תורים עתידיים אצל רופא זה |
| `CHANGE_DEADLINE_PASSED` | מאוחר מדי לשנות את התור |
| `PROVIDER_ABSENT` | הרופא לא עובד ביום הזה |
| `QUEUE_NOT_OPEN` / `QUEUE_PAUSED` | (מנהל) צריך לפתוח את היום או להמשיך אחרי הפסקה |
| `ANOTHER_IN_PROGRESS` | (מנהל) יש כבר לקוח בטיפול |
| `HAS_FUTURE_APPOINTMENTS` | השבתה דורשת אישור: לשלוח שוב עם `cancelFutureAppointments: true` |

---

## 5. מבני הנתונים העיקריים

### User (משתמש)
| שדה | טיפוס | הערה |
|---|---|---|
| id | number | |
| role | `SUPER_ADMIN` / `CLINIC_MANAGER` / `CLIENT` | |
| fullName | string | |
| email | string \| null | |
| phone | string | |
| nationalId | string \| null | לקוחות בלבד |
| defaultTravelMinutes | number | זמן הגעה לקליניקה |
| mustChangePassword | boolean | |
| isActive | boolean | |
| isRegistered | boolean | false = לקוח שנוסף טלפונית |
| clinicId | number \| null | למנהל קליניקה |

### Clinic (קליניקה)
`id, name, category, city, address, phone, description, isActive, settings{changeDeadlineHours, maxFutureAppointmentsPerProvider, bookingHorizonDays}`

**תחומים (`category`) והתרגום המוצע:**
| ערך | להציג |
|---|---|
| `DENTAL` | רפואת שיניים |
| `GENERAL_MEDICINE` | רפואה כללית |
| `PHYSIOTHERAPY` | פיזיותרפיה |
| `CONSULTING` | ייעוץ |
| `OTHER` | אחר |

### Appointment (תור)
| שדה | הערה |
|---|---|
| id, status | ראי טבלת סטטוסים |
| startTime, endTime | UTC |
| date, time | שעון ישראל, מוכנים להצגה |
| queueNumber | מספר בתור היומי (null עד שהקליניקה פותחת את היום) |
| source | `ONLINE` / `CLINIC` / `IMPORT` |
| notes, reminderEnabled, travelMinutes, effectiveTravelMinutes | |
| isLateCancellation | ביטול מאוחר |
| **canReschedule** | true = להציג כפתור "שינוי שעה" |
| **canCancel** | true = להציג כפתור "ביטול" |
| **cancellationWouldBeLate** | true = להציג אזהרה "הביטול ייחשב מאוחר" |
| changeDeadline | עד מתי מותר לשנות |
| provider `{id, fullName, specialty, slotMinutes}` | |
| clinic `{id, name, city, address, phone}` | |
| client | רק למנהל קליניקה ולמנהל העל |

**סטטוסים (`status`):**
| ערך | להציג |
|---|---|
| `BOOKED` | נקבע |
| `ARRIVED` | הגיע / ממתין |
| `IN_PROGRESS` | בטיפול |
| `COMPLETED` | הסתיים |
| `NO_SHOW` | לא הגיע |
| `CANCELLED_BY_CLIENT` | בוטל על ידך |
| `CANCELLED_BY_CLINIC` | בוטל על ידי הקליניקה |

### רשימות עם עמודים (Pagination)
רשימות ארוכות חוזרות כך:
```json
{ "items": [ ... ], "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 }
```
שולחים `?page=2&pageSize=20` כדי לעבור עמוד.

---

## 6. מסכים ← אילו Endpoints צריך

### 🌐 מסכים ציבוריים

#### דף הבית
אין צורך בקריאה לשרת.

#### הרשמה
`POST /api/auth/register`

| שדה בטופס | חובה | כללים |
|---|:-:|---|
| fullName | ✅ | 2-100 תווים |
| email | ✅ | מייל תקין |
| phone | ✅ | טלפון ישראלי, למשל `0501234567` (מותרים רווחים ומקפים) |
| nationalId | ✅ | ת"ז תקינה (9 ספרות עם ספרת ביקורת) |
| password | ✅ | 8 תווים לפחות, אות באנגלית וספרה |
| defaultTravelMinutes | ❌ | 0-300, ברירת מחדל 30 |

תשובה **201**: אותו מבנה כמו בהתחברות (`token` + `user`), ועוד `claimedExistingClient`. אם הוא `true`, אפשר להציג "מצאנו את התורים שקבעת בטלפון!".

> 💡 **לנסות:** אחרי Seed מקומי, אפשר להירשם עם ת"ז `412345670` וטלפון `0537777777`. זה לקוח שנוסף טלפונית, והתורים שלו יתחברו לחשבון.

#### התחברות
`POST /api/auth/login`. שדות חובה: `email`, `password`.

#### שכחתי סיסמה (שני מסכים)
1. `POST /api/auth/forgot-password` עם `{ "email": "..." }`. התשובה תמיד זהה, גם אם המייל לא קיים.
2. `POST /api/auth/reset-password` עם `{ "email", "code" (6 ספרות), "newPassword" }`.

#### חיפוש קליניקות
- `GET /api/clinics?q=&category=&city=&openNow=&hasAvailabilityThisWeek=&sort=&page=&pageSize=`
- `GET /api/clinics/cities` ← לתיבת הבחירה של הערים

| פרמטר | ערכים |
|---|---|
| q | טקסט: שם קליניקה **או** שם רופא |
| category | `DENTAL` ... |
| city | שם עיר |
| openNow | `true` / `false` |
| hasAvailabilityThisWeek | `true` / `false` |
| sort | `name` / `nextAvailable` |

כל פריט ברשימה כולל גם:
```json
{ "providersCount": 3, "isOpenNow": true,
  "nextAvailableSlot": { "startTime": "2026-11-03T14:20:00.000Z", "providerId": 1, "providerName": "ד\"ר רונית לוי" } }
```
`nextAvailableSlot` יכול להיות `null` כשאין תור פנוי ב־30 הימים הקרובים.

#### עמוד קליניקה
`GET /api/clinics/:id` ← פרטים ו־`providers[]`, ולכל רופא `todayQueueStatus` (`NOT_OPENED` / `OPEN` / `PAUSED` / `CLOSED`).

#### מסך התור החי ⭐
`GET /api/providers/:providerId/live`
- **בלי Token** מקבלים רק את המידע הציבורי (בלי שמות).
- **עם Token של לקוח** שיש לו תור היום אצל הרופא הזה מתווסף `myAppointment`.
- **מומלץ לרענן כל 20-30 שניות**, למשל עם `setInterval`.

```json
{
  "dayStatus": "OPEN",
  "plannedOpenTime": "16:00",
  "currentQueueNumber": 12,
  "delayMinutes": 35,
  "averageMinutesPerClient": 14,
  "pace": "SLOWER",
  "completedCount": 11, "noShowCount": 0, "waitingCount": 9, "totalToday": 21,
  "progressPercent": 52,
  "updatedAt": "2026-11-03T14:42:10.000Z",
  "myAppointment": {
    "appointmentId": 87, "status": "BOOKED", "queueNumber": 18, "peopleAhead": 5,
    "scheduledTime": "2026-11-03T15:05:00.000Z",
    "estimatedTime": "2026-11-03T15:40:00.000Z",
    "minutesUntilTurn": 58, "travelMinutes": 30,
    "leaveHomeAt": "2026-11-03T15:10:00.000Z",
    "reminderEnabled": true
  }
}
```

| `dayStatus` | הודעה מוצעת |
|---|---|
| `NOT_OPENED` | "המרפאה עוד לא נפתחה היום. שעת פתיחה מתוכננת: {plannedOpenTime}" |
| `OPEN` | "🟢 המרפאה פתוחה" |
| `PAUSED` | "⏸️ הרופא בהפסקה קצרה" |
| `CLOSED` | "🔴 המרפאה סגורה להיום" |
| `NO_SERVICE_TODAY` | "אין קבלת קהל היום" |

| `pace` | הודעה מוצעת |
|---|---|
| `FASTER` | "🎉 התור מתקדם מהר מהצפוי!" |
| `ON_TIME` | "התור מתקדם בזמן" |
| `SLOWER` | "התור מתקדם לאט מהצפוי" |

"עודכן לפני X שניות" = ההפרש בין עכשיו ל־`updatedAt`.

#### טופס הצטרפות לקליניקות
`POST /api/join-requests`

| שדה | חובה |
|---|:-:|
| clinicName | ✅ |
| category | ✅ |
| city | ✅ |
| contactName | ✅ |
| email | ✅ |
| phone | ✅ |
| message | ❌ |

### 👤 מסכי לקוח

#### קביעת תור (רופא ← לוח שנה ← שעה)
1. **רשימת רופאים:** מ־`GET /api/clinics/:id` (`providers`). אם יש רק רופא אחד, דלגי על שלב הבחירה.
2. **לוח שנה:** `GET /api/providers/:providerId/availability?month=2026-11`
   ```json
   { "days": [ { "date": "2026-11-01", "status": "AVAILABLE", "freeSlots": 17 }, ... ] }
   ```
   | status | צבע מוצע |
   |---|---|
   | `AVAILABLE` | ירוק, לחיץ |
   | `FULL` | אדום / אפור |
   | `NOT_WORKING` / `ABSENT` / `PAST` / `BEYOND_HORIZON` | אפור, לא לחיץ |
3. **שעות פנויות ביום שנבחר:** `GET /api/providers/:providerId/slots?date=2026-11-03`
   ```json
   { "slots": [ { "time": "16:00", "startTime": "2026-11-03T14:00:00.000Z" }, ... ] }
   ```
4. **אישור:** `POST /api/appointments`
   | שדה | חובה | הערה |
   |---|:-:|---|
   | providerId | ✅ | |
   | startTime | ✅ | **ה־startTime מה־slot שנבחר** |
   | reminderEnabled | ❌ | תיבת סימון "שלחו לי תזכורת במייל" |
   | travelMinutes | ❌ | "זמן הגעה לתור הזה" (ריק = מהפרופיל) |
   | notes | ❌ | עד 500 תווים |

   תשובה **201** עם התור. ב־**409 SLOT_TAKEN**: "השעה נתפסה הרגע, בחרי שעה אחרת" ורענון של רשימת השעות.

#### התורים שלי
`GET /api/appointments/my?status=upcoming|past|cancelled|all&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1`

#### פרטי תור
- `GET /api/appointments/:id`
- **שינוי שעה** (רק אם `canReschedule`): שוב לוח שנה ושעות, ואז `PATCH /api/appointments/:id` עם `{ "startTime": "..." }`
- **עדכון תזכורת / זמן הגעה / הערה:** `PATCH /api/appointments/:id` עם `{ "reminderEnabled": true, "travelMinutes": 45, "notes": "..." }`. שלחי רק את השדות שהשתנו.
- **ביטול** (רק אם `canCancel`): `POST /api/appointments/:id/cancel` עם גוף `{}`. אם `cancellationWouldBeLate` הוא true, הציגי קודם אזהרה ובקשי אישור.

#### הפרופיל שלי
- `GET /api/auth/me`
- `PATCH /api/auth/me` עם `{ "fullName", "phone", "defaultTravelMinutes" }` (כל השדות לא חובה)
- `POST /api/auth/change-password` עם `{ "currentPassword", "newPassword" }`
- **כפתור "בדקי זמן נסיעה בגוגל מפות":** זה קישור רגיל, בלי שרת:
  `https://www.google.com/maps/dir/?api=1&destination=<כתובת הקליניקה + עיר, מקודדת>`

### 🏥 מסכי מנהל קליניקה

#### החלפת סיסמה ראשונה
`POST /api/auth/change-password`. התשובה כוללת `token` חדש, אז שמרי אותו.

#### ניהול התור של היום ⭐
| פעולה | Endpoint |
|---|---|
| בחירת רופא | `GET /api/manage/providers` |
| הצגת התור | `GET /api/manage/providers/:id/queue` |
| פתיחת היום | `POST /api/manage/providers/:id/queue/open` |
| "הבא בתור ▶" | `POST /api/manage/providers/:id/queue/next` |
| הגיע / נכנס / סיים / לא הגיע / תיקון | `POST /api/manage/appointments/:appointmentId/status` עם `{ "status": "ARRIVED" }` |
| הפסקה / המשך | `POST .../queue/pause` · `POST .../queue/resume` |
| סגירת היום | `POST .../queue/close` |

כל הפעולות האלה מחזירות את מצב התור המעודכן, אז אין צורך בבקשה נוספת.

תשובת התור:
```json
{
  "dayStatus": "OPEN", "averageMinutesPerClient": 14, "currentAppointmentId": 55,
  "appointments": [
    { "id": 55, "queueNumber": 5, "status": "IN_PROGRESS", "startTime": "...", "estimatedTime": null,
      "client": { "id": 9, "fullName": "משה ישראלי", "phone": "0537777777" } }
  ]
}
```
**הכפתורים שכדאי להציג ליד כל לקוח לפי הסטטוס שלו:**
| status | כפתורים |
|---|---|
| BOOKED | הגיע · נכנס · לא הגיע |
| ARRIVED | נכנס · לא הגיע · ביטול הגעה (BOOKED) |
| IN_PROGRESS | סיים · החזרה להמתנה (ARRIVED) |
| COMPLETED | החזרה לטיפול (IN_PROGRESS) |
| NO_SHOW | הגיע בכל זאת (ARRIVED) |

#### יומן תורים
- רשימה: `GET /api/manage/appointments?providerId=&date=&from=&to=&status=&q=&page=`
- קביעת תור עבור לקוח: `POST /api/manage/appointments`
  - לקוח קיים: `{ "providerId", "startTime", "clientId" }`
  - לקוח חדש: `{ "providerId", "startTime", "client": { "fullName", "phone", "nationalId", "email"? } }`
  - כדי להציג שעות פנויות, השתמשי באותם `/availability` ו־`/slots` הציבוריים.
- עריכה: `PATCH /api/manage/appointments/:id` עם `{ "startTime"?, "notes"? }`
- ביטול: `POST /api/manage/appointments/:id/cancel` עם `{ "reason"? }`. הלקוח מקבל מייל.

#### רופאים
- `GET /api/manage/providers` (כולל `workingHours`)
- `POST /api/manage/providers` עם `{ "fullName" ✅, "specialty", "slotMinutes" (5-120) }`
- `PATCH /api/manage/providers/:id` עם `{ "fullName", "specialty", "slotMinutes", "isActive", "cancelFutureAppointments" }`
  - ב־**409 HAS_FUTURE_APPOINTMENTS** הציגי: "יש X תורים עתידיים. להשבית ולבטל אותם?". אם המשתמש מאשר, שלחי שוב עם `cancelFutureAppointments: true`.

#### שעות פעילות והיעדרויות
- `GET /api/manage/providers/:id/working-hours`
- `PUT /api/manage/providers/:id/working-hours` עם הרשימה המלאה:
  ```json
  { "hours": [ { "dayOfWeek": 0, "startTime": "16:00", "endTime": "20:00" },
               { "dayOfWeek": 2, "startTime": "09:00", "endTime": "13:00" } ] }
  ```
  אם בתשובה `warning` אינו `null`, הציגי את `warning.message`.
- `GET /api/manage/providers/:id/absences`
- `POST /api/manage/providers/:id/absences` עם `{ "date" ✅, "reason" }`. מחזיר `cancelledAppointments`.
- `POST /api/manage/absences` עם `{ "date", "reason", "providerIds"? }`. בלי `providerIds`, ההיעדרות חלה על כל הרופאים.
- `DELETE /api/manage/absences/:absenceId` ← 204, בלי גוף תשובה.

#### לקוחות
- `GET /api/manage/clients?q=&page=`. כל לקוח כולל `appointmentsCount` ו־`lateCancellationCount`.
- `PATCH /api/manage/clients/:id`: רק ללקוח עם `isRegistered: false`.

#### צוות
- `GET /api/manage/staff`
- `POST /api/manage/staff` עם `{ "fullName", "email", "phone" }` ← מחזיר `temporaryPassword`. הציגי אותו פעם אחת.
- `PATCH /api/manage/staff/:id` עם `{ "isActive": false }`

#### ייבוא תורים (CSV)
- הורדת קובץ דוגמה: `GET /api/manage/appointments/import/template`. מחזיר קובץ CSV. ב־Swagger יש כפתור הורדה.
- העלאה: `POST /api/manage/appointments/import`
  - סוג הגוף: **`multipart/form-data`**, עם שדה בשם **`file`**. ב־JavaScript משתמשים ב־`FormData`. **אל** תגדירי `Content-Type` ידנית, כי הדפדפן מגדיר אותו לבד.
  - תשובה:
    ```json
    { "totalRows": 145, "imported": 142, "failed": 3, "createdClients": 87,
      "errors": [ { "row": 17, "message": "איש מקצוע לא קיים בקליניקה: \"ד\"ר שגוי\"" } ] }
    ```
- קובץ לדוגמה עם הרופאים של ה־Seed: `docs/sample-import.csv`

#### הגדרות קליניקה
`GET /api/manage/clinic` · `PATCH /api/manage/clinic` עם `{ "name", "city", "address", "phone", "description", "changeDeadlineHours" (0-168), "maxFutureAppointmentsPerProvider" (1-20), "bookingHorizonDays" (1-365) }`

### 👑 מסכי מנהל על
| מסך | Endpoints |
|---|---|
| פניות הצטרפות | `GET /api/admin/join-requests?status=PENDING` · `POST /api/admin/join-requests/:id/approve` (גוף `{}`, או `{ "email": "..." }` לתיקון מייל) · `POST /api/admin/join-requests/:id/reject` עם `{ "reason"? }` |
| קליניקות | `GET /api/admin/clinics?q=&category=&isActive=` · `POST /api/admin/clinics` (פרטי קליניקה + `manager{fullName,email,phone}`) · `PATCH /api/admin/clinics/:id` |
| משתמשים | `GET /api/admin/users?role=&q=&isActive=` · `PATCH /api/admin/users/:id` · `POST /api/admin/users/:id/reset-password` |

אישור פנייה ויצירת קליניקה מחזירים `temporaryPassword` של המנהל החדש. הוא נשלח גם במייל.

---

## 7. טבלת הרשאות

| פעולה | ציבורי | לקוח | מנהל קליניקה | מנהל על |
|---|:-:|:-:|:-:|:-:|
| חיפוש קליניקות, שעות פנויות, תור חי | ✅ | ✅ | ✅ | ✅ |
| פניית הצטרפות | ✅ | ✅ | ✅ | ✅ |
| הרשמה / התחברות / שכחתי סיסמה | ✅ | | | |
| הפרופיל שלי (`/api/auth/me`) | | ✅ | ✅ | ✅ |
| התורים שלי, קביעה, שינוי | | ✅ רק שלו | | |
| ביטול תור | | ✅ רק שלו | ✅ רק בקליניקה שלו | |
| צפייה בתור (`/api/appointments/:id`) | | ✅ רק שלו | ✅ רק בקליניקה שלו | ✅ |
| כל `/api/manage/*` | | | ✅ רק בקליניקה שלו | |
| כל `/api/admin/*` | | | | ✅ |

> השרת מזהה את המשתמש **רק לפי ה־Token**. אין צורך (ואין טעם) לשלוח `clientId` או `clinicId`: השרת מתעלם מהם ומשתמש במה שב־Token.

---

## 8. מה מוחזר בהצלחה — סיכום מהיר

| פעולה | קוד | גוף |
|---|---|---|
| התחברות / הרשמה | 200 / 201 | `{ token, expiresIn, user }` |
| יצירה (תור, רופא, היעדרות, פנייה...) | 201 | הרשומה שנוצרה |
| עדכון (PATCH / PUT) | 200 | הרשומה המעודכנת |
| ביטול תור | 200 | התור עם הסטטוס החדש |
| מחיקת היעדרות | 204 | ריק |
| רשימות | 200 | `{ items, page, pageSize, total, totalPages }` (או `{ items }`) |
