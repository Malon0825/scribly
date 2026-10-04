import { defineConfig } from "@playwright/test";
const preview = process.env.PLAYWRIGHT_PREVIEW === "1";
const baseURL = preview ? "http://127.0.0.1:1421" : "http://127.0.0.1:1420";

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
    command: preview ? "npm run preview -- --port 1421" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
