import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    mergedBandEditor?: EditorController;
  }
}

test("selecting a row expands through chained vertical merges", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'merged-band-test'
      document.body.prepend(host)
      window.mergedBandEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2"><p>A</p></td><td><p>B1</p></td><td><p>C1</p></td></tr><tr><td rowspan="2"><p>B</p></td><td><p>C2</p></td></tr><tr><td><p>A3</p></td><td><p>C3</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.mergedBandEditor));
  const prose = page.locator("#merged-band-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("mergedBandEditor").getSnapshot());
  await prose.getByRole("cell", { name: "C1" }).hover();
  await page.getByRole("button", { name: "选择第 1 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(7);
  for (const row of [1, 2, 3])
    await expect(page.getByRole("button", { name: `选择第 ${row} 行` })).toHaveAttribute("aria-pressed", "true");
  expect((await page.evaluate(() => window.__semloRequireFixture("mergedBandEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("selecting a column expands through chained horizontal merges", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'merged-band-test'
      document.body.prepend(host)
      window.mergedBandEditor = createEditor({ element: host, content: '<table><tbody><tr><td colspan="2"><p>A</p></td><td><p>C1</p></td></tr><tr><td><p>A2</p></td><td colspan="2"><p>B</p></td></tr><tr><td><p>A3</p></td><td><p>B3</p></td><td><p>C3</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.mergedBandEditor));
  const prose = page.locator("#merged-band-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("mergedBandEditor").getSnapshot());
  await prose.getByRole("cell", { name: "A3" }).hover();
  await page.getByRole("button", { name: "选择第 1 列" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(7);
  for (const column of [1, 2, 3])
    await expect(page.getByRole("button", { name: `选择第 ${column} 列` })).toHaveAttribute("aria-pressed", "true");
  expect((await page.evaluate(() => window.__semloRequireFixture("mergedBandEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});
