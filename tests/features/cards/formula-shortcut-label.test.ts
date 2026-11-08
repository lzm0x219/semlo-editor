import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/cards-multi-editor-fixture.ts"));
});
afterAll(async () => closeServer?.());

test("formula confirmation displays the platform shortcut and still submits", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
  const host = page.locator('[data-editor-name="甲"]');
  await host.getByRole("button", { name: "公式：x" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑公式" });
  const button = dialog.getByRole("button", { name: "确定", exact: true });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Cmd" : "Ctrl"));
  await expect(button).toContainText(`${modifier} + Enter`);
  await expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
  await dialog.getByLabel("TeX 公式").fill("x+2");
  await dialog.getByLabel("TeX 公式").press("ControlOrMeta+Enter");
  await expect(dialog).toHaveCount(0);
  await expect(host.getByRole("button", { name: "公式：x+2" })).toBeVisible();
});
