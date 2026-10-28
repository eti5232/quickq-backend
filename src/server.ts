import { createApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './db/prisma.js';
import { processReminders } from './services/reminder.service.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 QuickQ API running on port ${config.port} (${config.env})`);
  // eslint-disable-next-line no-console
  console.log(`📚 Swagger: http://localhost:${config.port}/api-docs`);
});

// בדיקת תזכורות פנימית - פועלת כל עוד השרת ער.
// ב-Render החינמי השרת "נרדם", ולכן cron-job.org קורא גם ל-/api/jobs/send-reminders.
let reminderTimer: NodeJS.Timeout | null = null;
if (config.reminderIntervalSeconds > 0) {
  reminderTimer = setInterval(() => {
    processReminders().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Reminder check failed:', err);
    });
  }, config.reminderIntervalSeconds * 1000);
  reminderTimer.unref();
}

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down...`);
  if (reminderTimer) clearInterval(reminderTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
