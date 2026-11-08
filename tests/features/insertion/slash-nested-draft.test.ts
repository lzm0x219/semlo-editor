import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import type { EditorControllerWithResults, EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { paragraph, slashDraftContexts } from "../../fixtures/insertion/slash-draft-content";

declare global {
  interface Window {
    nestedSlashEditor?: EditorControllerWithResults;
    nestedSlashChanges?: EditorSnapshot[];
  }
}

let origin: string;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/insertion/slash-nested-draft-fixture.ts" } },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
test.afterAll(async () => stop?.());

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.nestedSlashEditor));
});

for (const context of slashDraftContexts) {
  test(`${context.name}查询的保存、退格和 Esc 保留受控编辑内容`, async ({ page }) => {
    const before = await page.evaluate(
      (content) => {
        const controller = window.__semloRequireFixture("nestedSlashEditor");
        controller.setContent(content);
        return controller.getSnapshot();
      },
      { type: "doc", content: [context.node(), paragraph("外部后文")] },
    );
    const prose = page.locator("#nested-slash .semlo-editor-prose");
    // 折叠正文的节点视图在微任务中同步展开状态；从已可见正文点击进入，覆盖真实输入接缝。
    const emptyBody = prose.locator("p").first();
    await expect(emptyBody).toBeVisible();
    await emptyBody.click();
    await expect(prose).toBeFocused();
    expect(
      await emptyBody.evaluate((element) => {
        const selection = element.ownerDocument.getSelection();
        return selection?.isCollapsed && selection.anchorNode !== null && element.contains(selection.anchorNode);
      }),
    ).toBe(true);
    await page.keyboard.type("/p");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSlashEditor").getSnapshot())).toEqual(before);
    await expect(prose).toContainText("/p");
    await page.keyboard.press("Backspace");
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSlashEditor").getSnapshot())).toEqual(before);
    await page.keyboard.type("p");
    const count = await page.evaluate(() => window.__semloRequireFixture("nestedSlashChanges").length);
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("nestedSlashChanges").length))
      .toBe(count + 1);
    const committed = await page.evaluate(() => {
      const snapshot = window.__semloRequireFixture("nestedSlashEditor").getSnapshot();
      return { snapshot, change: window.__semloRequireFixture("nestedSlashChanges").at(-1) };
    });
    expect(committed.snapshot.text).toContain("/p");
    expect(committed.snapshot.text).toContain("容器后文");
    expect(committed.snapshot.text).toContain("外部后文");
    expect(committed.change).toEqual(committed.snapshot);
    await expect(prose).toContainText("/p");
  });
}

test("高亮块活动查询与 Esc 正文分别按宿主保存快照重载", async ({ page }) => {
  await page.goto(`${origin}/?persistence`);
  const body = page.locator("#nested-slash .semlo-editor-prose aside p");
  await body.click();
  await page.keyboard.type("/p");
  await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
  await page.reload();
  await expect(body).toHaveText("");
  await expect(page.locator("#nested-slash .semlo-editor-prose > p")).toHaveText("基线");
  await body.click();
  await page.keyboard.type("/p");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(body).toHaveText("/p");
  await expect(page.locator("#nested-slash .semlo-editor-prose > p")).toHaveText("基线");
});
