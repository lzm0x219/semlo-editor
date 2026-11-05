import { expect, test } from "@rstest/playwright";

import { playwrightOptions } from "../config/playwright-options";

test("uses the configured browser viewport", async ({ page }) => {
  expect(page.viewportSize()).toEqual(playwrightOptions.contextOptions.viewport);
});
