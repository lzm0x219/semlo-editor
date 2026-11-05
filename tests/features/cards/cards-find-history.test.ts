import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    concurrentColumnsEditor?: EditorController;
  }
}

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/blocks/columns-concurrent-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

test("finding and replacing next to a date in a closed fold keeps the date through undo and redo", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: false },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "折叠标题" }] },
            {
              type: "detailsContent",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "semloEditorDate", attrs: { date: "2026-11-03", time: "12:30" } },
                    { type: "text", text: "日期后目标文字" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const editor = page.locator(".ProseMirror");
  const date = editor.getByRole("button", { name: "日期：2026-11-03 12:30" });
  await expect(date).toBeHidden();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await expect(date).toBeVisible();
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("替换");
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(editor).toContainText("日期后替换文字");
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 12:30");
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(editor).toContainText("日期后目标文字");
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 12:30");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  await expect(editor).toContainText("日期后替换文字");
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 12:30");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(date).toBeHidden();
  const collapsed = await page.evaluate(
    () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json,
  );
  expect(collapsed.content?.[0].attrs?.open).toBe(false);
  const inline = collapsed.content?.[0].content?.[1].content?.[0].content;
  expect(inline?.[0].attrs?.date).toBe("2026-11-03");
  expect(inline?.[0].attrs?.time).toBe("12:30");
  expect(inline?.[1].text).toBe("日期后目标文字");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  await expect(date).toBeVisible();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  await expect(editor).toContainText("日期后替换文字");
  const saved = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  for (const content of [saved.json, saved.html]) {
    const restored = await page.evaluate((value) => {
      const controller = window.__semloRequireFixture("concurrentColumnsEditor");
      controller.setContent("<p>临时内容</p>");
      controller.setContent(value);
      return controller.getSnapshot().json;
    }, content);
    expect(restored).toEqual(saved.json);
    await expect(date).toBeVisible();
  }
});
