import { defineConfig, devices } from "@playwright/test";
import { FAKE_PORT } from "./tests/helpers";

// Ports are deliberately not 3000/8000 (the compose stack) and nothing is ever reused:
// attaching to a running stack would hit the real backend and model.
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 3100);
// BACKEND_URL set = test against that backend instead of the fake (e.g. the real compose stack).
const EXTERNAL_BACKEND = process.env.BACKEND_URL;
const BACKEND_URL = EXTERNAL_BACKEND ?? `http://127.0.0.1:${FAKE_PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${FRONTEND_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    ...(EXTERNAL_BACKEND
      ? []
      : [{
          command: "node tests/fake-backend.mts",
          url: `http://127.0.0.1:${FAKE_PORT}/health`,
          env: { FAKE_BACKEND_PORT: String(FAKE_PORT) },
          reuseExistingServer: false,
        }]),
    {
      // Production build: prefetching and theme-flash behaviour only exist outside `next dev`.
      command: `npm run build && npm run start -- -H 127.0.0.1 -p ${FRONTEND_PORT}`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      env: { BACKEND_URL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
