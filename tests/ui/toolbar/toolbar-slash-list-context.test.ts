import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    listSlashFixture?: {
      mount(
        kind: "bullet" | "ordered" | "task" | "paragraph",
        suffix?: string,
        depth?: number,
        child?: boolean,
        multi?: boolean,
      ): void;
      check(text: string, from: number, to: number): boolean;
      mountHeading(level: number, text?: string): void;
      mountNestedHeading(
        container: "blockquote" | "details" | "callout" | "foldCallout",
        level?: number,
        text?: string,
      ): void;
      mountDetailsParagraph(text: string): void;
      checkHeading(from: number, to: number): boolean;
      checkNestedHeading(): boolean;
      snapshot(): unknown;
    };
  }
}

test("slash queries in observed list contexts stay as text", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-slash-list-context-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-slash-list-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    for (const kind of ["bullet", "ordered", "task"] as const) {
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮"), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
        true,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮后文"), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮后文", 0, 3))).toBe(
        true,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮", 1), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
        true,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮", 2), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
        true,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮", 3), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
        true,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮", 4), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
        true,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮", 9), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
        false,
      );
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "/高亮后文", 3), kind);
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮后文", 0, 3))).toBe(
        true,
      );
    }
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mount("paragraph", "/高亮"));
    expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮", 0, 3))).toBe(
      false,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("listSlashFixture").mount("bullet", "/高亮后文", 1, false, true),
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").check("/高亮后文", 0, 3))).toBe(
      false,
    );
    for (const kind of ["bullet", "ordered", "task"] as const) {
      for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        await page.evaluate(
          ([kind, depth]) => window.__semloRequireFixture("listSlashFixture").mount(kind, "", depth),
          [kind, depth] as const,
        );
        const paragraph = page.locator("#slash-list-fixture .semlo-editor-prose p").last();
        await paragraph.click();
        await page.keyboard.type("/");
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        await page.keyboard.insertText("高亮");
        await expect(paragraph).toHaveText("/高亮");
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
        await expect(page.locator("#slash-list-fixture .semlo-editor-prose")).toBeFocused();
      }
      for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        await page.evaluate(
          ([kind, depth]) => window.__semloRequireFixture("listSlashFixture").mount(kind, "原文字", depth),
          [kind, depth] as const,
        );
        const nonempty = page.locator("#slash-list-fixture .semlo-editor-prose p").last();
        await nonempty.click();
        await page.keyboard.press("Home");
        await page.keyboard.type("/");
        await page.keyboard.insertText("高亮");
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        await expect(nonempty).toHaveText("/高亮原文字");
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
      }
    }
    for (const kind of ["bullet", "ordered"] as const) {
      await page.evaluate(
        (kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "原文字", 1, true),
        kind,
      );
      const parent = page.locator("#slash-list-fixture .semlo-editor-prose p").filter({ hasText: "原文字" });
      await parent.click();
      await parent.evaluate((element) => {
        const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.keyboard.type("/");
      await expect(parent).toHaveText("/原文字");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      await expect(page.locator("#slash-list-fixture .semlo-editor-prose p").filter({ hasText: "子项" })).toHaveText(
        "子项",
      );
    }
    for (const kind of ["bullet", "task"] as const) {
      await page.evaluate((kind) => window.__semloRequireFixture("listSlashFixture").mount(kind, "", 5, true), kind);
      const parent = page.locator("#slash-list-fixture .semlo-editor-prose p").nth(5);
      await parent.click();
      await page.keyboard.type("/");
      await page.keyboard.insertText("高亮");
      await expect(parent).toHaveText("/高亮");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      await expect(page.locator("#slash-list-fixture .semlo-editor-prose p").filter({ hasText: "子项" })).toHaveText(
        "子项",
      );
    }
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mount("paragraph"));
    await page.locator("#slash-list-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mount("bullet", "原文字", 1, true));
    const parentWithChild = page.locator("#slash-list-fixture .semlo-editor-prose p").filter({ hasText: "原文字" });
    await parentWithChild.click();
    await page.keyboard.press("Home");
    await page.keyboard.type("a");
    await expect(parentWithChild).toHaveText("a原文字");
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(parentWithChild).toHaveText("/a原文字");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
  } finally {
    await server.close();
  }
});
