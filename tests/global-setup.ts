import { execSync } from 'node:child_process';
import 'dotenv/config';

/** מריץ את ה-Migrations על מסד הבדיקות פעם אחת לפני כל הבדיקות */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required to run tests (see .env.example)');
  if (!/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must contain "test" in the database name');
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
