import { defineConfig, devices } from "@playwright/test";

// E2E гоняется против той же статики, что уезжает в образ web, и против настоящего
// API-процесса: оба поднимаются локально. Порт нестандартный (>40000) — на «красивых»
// портах localhost может висеть service worker чужого проекта и перехватить навигацию.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:41731",
    headless: true,
    trace: "off",
  },
  projects: [
    // Мини-апп живёт в мобильном вебвью. Pixel 5 — та же мобильная эмуляция, но на
    // chromium: iPhone-профили тянут webkit, лишний браузер в гейте не нужен.
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: [
    {
      command: "CORPFLY_DB=:memory: BOT_TOKEN=e2e:testtoken PORT=41732 node server/src/server.js",
      url: "http://127.0.0.1:41732/api/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "PORT=41731 API_ORIGIN=http://127.0.0.1:41732 node tools/devstatic.js",
      url: "http://127.0.0.1:41731/",
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
