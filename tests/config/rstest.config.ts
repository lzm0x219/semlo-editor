import { defineConfig } from "@rstest/core";
import { definePlaywrightConfig } from "@rstest/playwright/config";

import { playwrightOptions } from "./playwright-options";

const playwrightConfig = definePlaywrightConfig(playwrightOptions);

export default defineConfig({
  // The helper’s generated setup resolves @rstest/playwright from the workspace root.
  extends: playwrightConfig,
  include: ["tests/**/*.{test,spec}.{ts,mts,cts,tsx}"],
  globalSetup: ["./tests/config/rstest-global-setup.ts"],
  testTimeout: 90_000,
  hookTimeout: 60_000,
  pool: { maxWorkers: 1 },
});
