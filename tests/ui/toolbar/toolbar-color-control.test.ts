import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/toolbar/toolbar-color-control-fixture";

test("split color controls apply the remembered color and open the palette separately", async ({ page }) => {
  await installFixtureGuards(page);
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/toolbar/toolbar-color-control-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole("button", { name: "应用文字颜色" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-text", "#df2a3f");
    await page.getByRole("button", { name: "文字颜色", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-open", "text");
    await page.evaluate(() => window.__semloRequireFixture("setTextColor")("#117cee"));
    await page.getByRole("button", { name: "应用文字颜色" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-text", "#117cee");
    await page.evaluate(() => window.__semloRequireFixture("setTextColor")(null));
    await page.getByRole("button", { name: "应用文字颜色" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-text", "null");
    await page.getByRole("button", { name: "应用高亮颜色" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-background", "#fbde28");
    await page.evaluate(() => window.__semloRequireFixture("setBackgroundColor")(null));
    await expect(page.locator("#background .semlo-editor-toolbar-color-swatch")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await page.getByRole("button", { name: "应用高亮颜色" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-background", "null");
  } finally {
    await server.close();
  }
});
