import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/cards/cards-multi-editor-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

test("an open formula editor follows its anchor during page scrolling without committing the draft", async ({
  page,
}) => {
  await installFixtureGuards(page);
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
  const host = page.locator('[data-editor-name="甲"]');
  await host.evaluate((node) => {
    node.style.marginTop = "600px";
    node.style.marginBottom = "1000px";
  });
  const button = host.locator(".semlo-editor-formula-node button");
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const node = document.querySelector('[data-editor-name="甲"] .semlo-editor-formula-node')!;
    window.scrollBy(0, node.getBoundingClientRect().top - 250);
  });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "编辑公式" });
  await dialog.getByLabel("TeX 公式").fill("x+1");
  const before = await button.boundingBox();
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect
    .poll(async () => {
      const after = await button.boundingBox();
      return before && after ? Math.round(before.y - after.y) : 0;
    })
    .toBe(80);
  await expect
    .poll(async () => {
      const [anchor, panel] = await Promise.all([
        host.locator(".semlo-editor-formula-node").boundingBox(),
        dialog.boundingBox(),
      ]);
      if (!anchor || !panel) return false;
      return Math.abs(panel.y - (anchor.y + anchor.height + 8)) <= 2;
    })
    .toBe(true);
  await expect(dialog.getByLabel("TeX 公式")).toHaveValue("x+1");
  const latex = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("cardMultiEditors")[0]
        .getSnapshot()
        .json.content![1].content!.find((node) => node.type === "semloEditorFormula")!.attrs!.latex,
  );
  expect(latex).toBe("x");
});

test("an open formula editor follows its anchor inside a scrolling container", async ({ page }) => {
  await installFixtureGuards(page);
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
  const host = page.locator('[data-editor-name="甲"]');
  await host.evaluate((node) => {
    const wrapper = document.createElement("div");
    wrapper.dataset.testScrollHost = "";
    wrapper.style.cssText = "height: 500px; overflow: auto";
    node.parentElement!.insertBefore(wrapper, node);
    wrapper.append(node);
    node.style.marginTop = "180px";
    node.style.marginBottom = "1000px";
  });
  const button = host.locator(".semlo-editor-formula-node button");
  await button.click();
  const dialog = page.getByRole("dialog", { name: "编辑公式" });
  await dialog.getByLabel("TeX 公式").fill("x+1");
  const before = await button.boundingBox();
  await page.locator("[data-test-scroll-host]").evaluate((node) => {
    node.scrollTop += 80;
  });
  await expect
    .poll(async () => {
      const after = await button.boundingBox();
      return before && after ? Math.round(before.y - after.y) : 0;
    })
    .toBe(80);
  await expect
    .poll(async () => {
      const [anchor, panel] = await Promise.all([
        host.locator(".semlo-editor-formula-node").boundingBox(),
        dialog.boundingBox(),
      ]);
      return !!anchor && !!panel && Math.abs(panel.y - (anchor.y + anchor.height + 8)) <= 2;
    })
    .toBe(true);
  await expect(dialog.getByLabel("TeX 公式")).toHaveValue("x+1");
});
