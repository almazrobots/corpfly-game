import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "docs/original-corpfly.html", "coverage/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  {
    files: ["web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["server/**/*.js", "tools/**/*.js", "tests/**/*.js", "e2e/**/*.js", "*.config.js", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    // Тесты и e2e живут на два мира: сам файл исполняется в Node, а куски внутри
    // page.evaluate / addInitScript — в браузере. Поэтому оба набора глобалей.
    files: ["tests/**/*.js", "e2e/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
