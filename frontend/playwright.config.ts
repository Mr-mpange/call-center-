import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, "..");
const database = path.join(os.tmpdir(), "mpange-playwright.sqlite");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node src/server.js",
      cwd: root,
      url: "http://127.0.0.1:3311/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        PORT: "3311",
        AUTH_SECRET: "playwright-test-secret-0123456789abcdef",
        API_AUTH_REQUIRED: "true",
        DASHBOARD_DB_FILE: database,
        CORS_ORIGINS: "http://127.0.0.1:4173",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      cwd: currentDir,
      url: "http://127.0.0.1:4173/login",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, VITE_API_BASE_URL: "http://127.0.0.1:3311/api" },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
