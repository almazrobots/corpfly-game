import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["web/src/engine.js", "web/src/identity-view.js", "web/src/sfx.js", "server/src/initdata.js", "server/src/identity.js", "server/src/db.js", "server/src/api.js"],
      // Пороги подняты под фактически достигнутое (97.6% строк / 92.4% ветвей) с
      // небольшим запасом: это храповик против сползания, а не цель сама по себе.
      // Ветви честнее строк, поэтому их порог держим отдельно и высоко.
      thresholds: { lines: 92, functions: 85, branches: 88, statements: 92 },
    },
  },
});
