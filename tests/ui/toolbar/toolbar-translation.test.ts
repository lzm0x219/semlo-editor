import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    translationFixture?: {
      select(from: number, to: number): void;
      requests(): { text: string; aborted: boolean }[];
      resolve(index: number, text: string): void;
      reject(index: number): void;
      snapshot(): string;
      replaceDocument(): void;
      destroy(): void;
    };
  }
}

test("translation ignores stale requests, inserts plain text into the selection, and aborts on close", async ({
  page,
}) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-translation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-translation-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole("button", { name: "打开翻译" }).click();
    const panel = page.getByRole("complementary", { name: "翻译" });
    const contentBounds = await page.locator(".semlo-editor-content").boundingBox();
    const panelBounds = await panel.boundingBox();
    expect(panelBounds!.x).toBeGreaterThanOrEqual(contentBounds!.x + contentBounds!.width - 1);
    await expect(page.locator(".semlo-editor-outline")).toBeVisible();
    await expect(panel.getByRole("button", { name: "插入文档" })).toBeDisabled();
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").select(1, 3));
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().length))
      .toBe(1);
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").select(3, 5));
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().length))
      .toBe(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("translationFixture").requests())).toEqual([
      { text: "甲乙", aborted: true },
      { text: "丙丁", aborted: false },
    ]);
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").resolve(0, "过期"));
    await expect(panel.locator(".semlo-editor-translation-result")).toHaveText("");
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").resolve(1, "<b>译文</b>"));
    await expect(panel.locator(".semlo-editor-translation-result")).toHaveText("<b>译文</b>");
    await panel.getByRole("button", { name: "插入文档" }).click();
    const html = await page.evaluate(() => window.__semloRequireFixture("translationFixture").snapshot());
    expect(html).toContain("&lt;b&gt;译文&lt;/b&gt;");
    expect(html).toContain("<strong>");
    await page.locator(".semlo-editor-prose").press("ControlOrMeta+z");
    expect(await page.evaluate(() => window.__semloRequireFixture("translationFixture").snapshot())).toContain(
      "甲乙丙丁",
    );
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").select(1, 3));
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().length))
      .toBeGreaterThan(2);
    const failedIndex =
      (await page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().length)) - 1;
    await page.evaluate((index) => window.__semloRequireFixture("translationFixture").reject(index), failedIndex);
    await expect(panel.getByRole("status")).toHaveText("翻译失败");
    await panel.getByRole("button", { name: "重试" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().length))
      .toBeGreaterThan(failedIndex + 1);
    await panel.getByRole("button", { name: "关闭翻译" }).click();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().at(-1)?.aborted),
    ).toBe(true);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.getByRole("button", { name: "打开翻译" }).click();
    const narrow = await panel.boundingBox();
    expect(narrow!.x).toBeGreaterThanOrEqual(0);
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(360);
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").select(1, 3));
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().at(-1)?.aborted))
      .toBe(false);
    const staleIndex =
      (await page.evaluate(() => window.__semloRequireFixture("translationFixture").requests().length)) - 1;
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").replaceDocument());
    expect(
      await page.evaluate(
        (index) => window.__semloRequireFixture("translationFixture").requests()[index].aborted,
        staleIndex,
      ),
    ).toBe(true);
    await page.evaluate(
      (index) => window.__semloRequireFixture("translationFixture").resolve(index, "不应显示"),
      staleIndex,
    );
    await expect(panel.locator(".semlo-editor-translation-result")).not.toHaveText("不应显示");
    await page.evaluate(() => window.__semloRequireFixture("translationFixture").destroy());
  } finally {
    await server.close();
  }
});
