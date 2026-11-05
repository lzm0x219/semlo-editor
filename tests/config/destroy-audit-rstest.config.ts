import { defineConfig } from "@rstest/core";
import { definePlaywrightConfig } from "@rstest/playwright/config";

import { playwrightOptions } from "./playwright-options";

const playwrightConfig = definePlaywrightConfig(playwrightOptions);

export default defineConfig({
  // The helper’s generated setup resolves @rstest/playwright from the workspace root.
  extends: playwrightConfig,
  include: ["tests/lifecycle/destroy-audit.test.ts", "tests/lifecycle/destroy-framework.test.ts"],
  testTimeout: 90000,
  hookTimeout: 60000,
  pool: { maxWorkers: 1 },
});
