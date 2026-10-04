import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'corrected-*.spec.ts', outputDir: './retest-results',
  use: { baseURL: 'http://127.0.0.1:1430', viewport: { width: 1440, height: 920 }, trace: 'retain-on-failure' },
  workers: 2,
});
