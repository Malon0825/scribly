import { defineConfig } from "@playwright/test";
const preview = process.env.PLAYWRIGHT_PREVIEW === "1";
const port = Number(process.env.PLAYWRIGHT_PORT || (preview ? 1421 : 1420));
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: preview ? "test-results-preview" : "test-results",
  fullyParallel: true,
  use: {
    baseURL,
    viewport: { width: 1440, height: 920 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js ${preview ? 'preview' : ''} --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
