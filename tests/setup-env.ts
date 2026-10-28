// רץ לפני כל קובץ בדיקות: מפנה את האפליקציה למסד הנתונים של הבדיקות
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required to run tests (see .env.example)');
if (!/test/i.test(new URL(testUrl).pathname)) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name contains "test" - refusing to run');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl;
process.env.CRON_SECRET = 'test-cron-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret-123';
process.env.REMINDER_INTERVAL_SECONDS = '0';
