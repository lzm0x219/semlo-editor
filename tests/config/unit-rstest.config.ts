import { defineConfig } from "@rstest/core";

export default defineConfig({
  include: ["tests/**/*.unit.test.ts"],
  testTimeout: 5_000,
  pool: { maxWorkers: 1 },
});
