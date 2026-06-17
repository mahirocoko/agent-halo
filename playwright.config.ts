import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/desktop/tests",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:47622",
    channel: "chrome",
  },
  webServer: {
    command: "pnpm --filter @agent-halo/desktop dev",
    url: "http://127.0.0.1:47622/?demo=1",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
