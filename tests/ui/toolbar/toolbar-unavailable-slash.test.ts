import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    unavailableSetEditable?(editable: boolean): void;
  }
}

test("unavailable slash entries remain visible and do not consume the query", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-unavailable-slash-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-unavailable-slash-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    for (const { query, command } of [
      { query: "AI", command: "ai" },
      { query: "yq", command: "yuque" },
      { query: "语雀内容", command: "yuque" },
      { query: "jm", command: "encrypted" },
      { query: "加密文本", command: "encrypted" },
    ]) {
      await page.goto(`http://127.0.0.1:${port}`);
      const editor = page.locator("#unavailable-slash-fixture .semlo-editor-prose");
      await editor.locator("p").click();
      await page.keyboard.type("/");
      const menu = page.getByRole("listbox", { name: "插入内容" });
      const disabled = menu.locator(`[data-command="${command}"]`);
      await expect(disabled).toBeDisabled();
      await page.keyboard.insertText(query);
      await expect(disabled).toBeVisible();
      const box = await disabled.boundingBox();
      if (!box) throw new Error("Unavailable entry is not visible");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(editor.locator("p")).toHaveText(`/${query}`);
      await expect(editor).toBeFocused();
      await page.keyboard.type("x");
      await expect(editor.locator("p")).toHaveText(`/${query}x`);
      await page.reload();
      await editor.locator("p").click();
      await page.keyboard.type("/");
      await page.keyboard.insertText(query);
      await expect(disabled).toBeVisible();
      await expect(editor).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(editor.locator("p")).toHaveText(`/${query}`);
      await expect(editor.locator("aside, table, [data-type=details]")).toHaveCount(0);
      if (query === "AI") {
        await page.keyboard.press("ArrowDown");
        const chosen = menu.locator('[role="option"][aria-selected="true"]');
        await expect(chosen).toHaveCount(1);
        await expect(chosen).toBeEnabled();
        await expect(chosen).not.toHaveAttribute("data-command", command);
        await page.keyboard.press("Enter");
        await expect(menu).toHaveCount(0);
      }
    }
    const browser = page.context().browser();
    if (!browser) throw new Error("Browser unavailable for touch emulation");
    const touchContext = await browser.newContext({ hasTouch: true });
    try {
      const touchPage = await touchContext.newPage();
      await touchPage.goto(`http://127.0.0.1:${port}`);
      const touchEditor = touchPage.locator("#unavailable-slash-fixture .semlo-editor-prose");
      await touchEditor.locator("p").click();
      await touchPage.keyboard.type("/AI");
      const disabled = touchPage.getByRole("listbox", { name: "插入内容" }).locator('[data-command="ai"]');
      const box = await disabled.boundingBox();
      if (!box) throw new Error("Unavailable entry is not visible for touch");
      await touchPage.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(touchEditor).toBeFocused();
      await touchPage.keyboard.type("x");
      await expect(touchEditor.locator("p")).toHaveText("/AIx");
      await touchPage.reload();
      await touchEditor.locator("p").click();
      await touchPage.keyboard.type("/glk");
      const available = touchPage.getByRole("listbox", { name: "插入内容" }).getByRole("option", { name: /高亮块/ });
      const availableBox = await available.boundingBox();
      if (!availableBox) throw new Error("Available entry is not visible for touch");
      await touchPage.touchscreen.tap(
        availableBox.x + availableBox.width / 2,
        availableBox.y + availableBox.height / 2,
      );
      await expect(touchEditor.locator("aside[data-semlo-editor-callout]")).toHaveCount(1);
      await expect(touchEditor).toBeFocused();
    } finally {
      await touchContext.close();
    }
    await page.goto(`http://127.0.0.1:${port}`);
    const mouseEditor = page.locator("#unavailable-slash-fixture .semlo-editor-prose");
    await mouseEditor.locator("p").click();
    await page.keyboard.type("/glk");
    await page
      .getByRole("listbox", { name: "插入内容" })
      .getByRole("option", { name: /高亮块/ })
      .click();
    await expect(mouseEditor.locator("aside[data-semlo-editor-callout]")).toHaveCount(1);
    await expect(mouseEditor).toBeFocused();
    await page.reload();
    await page.evaluate(() => window.__semloRequireFixture("unavailableSetEditable").bind(window)(false));
    await mouseEditor.locator("p").click();
    await page.keyboard.type("/p");
    await expect(mouseEditor.locator("p")).toHaveText("");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
    await page.reload();
    await mouseEditor.locator("p").click();
    await page.keyboard.type("/p");
    await expect(page.getByRole("listbox", { name: "插入内容" }).locator('[aria-selected="true"]')).toHaveAttribute(
      "data-command",
      "paragraph",
    );
    await page.keyboard.press("Enter");
    await expect(mouseEditor.locator("p")).toHaveText("");
    await expect(mouseEditor).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(mouseEditor.locator("p")).toHaveText("/");
    await page.goto(`http://127.0.0.1:${port}`);
    const paragraph = page.locator("#unavailable-slash-fixture .semlo-editor-prose p");
    await paragraph.click();
    await page.keyboard.insertText("甲乙丙");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(paragraph).toHaveText("/甲乙丙");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("/");
    await expect(paragraph).toHaveText("甲/乙丙");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
    await page.keyboard.press("End");
    await page.keyboard.type("/");
    await expect(paragraph).toHaveText("甲/乙丙/");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
    await page.reload();
    await paragraph.click();
    await page.keyboard.type("/hndm");
    await expect(page.getByRole("listbox", { name: "插入内容" }).getByText("行内代码", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect(paragraph.locator("code")).toHaveText("abc");
    await expect(page.locator("#unavailable-slash-fixture .semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(paragraph.locator("code")).toHaveCount(0);
    await expect(paragraph).toHaveText("/");
  } finally {
    await server.close();
  }
});
