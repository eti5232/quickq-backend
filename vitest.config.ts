import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // הבדיקות חולקות מסד נתונים אחד - לכן קבצים רצים בזה אחר זה
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
