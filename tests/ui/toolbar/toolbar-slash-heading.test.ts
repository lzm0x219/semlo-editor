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
      mountHeading(level: number, text?: string): void;
      mountNestedHeading(
        container: "blockquote" | "details" | "callout" | "foldCallout",
        level?: number,
        text?: string,
      ): void;
      mountDetailsParagraph(text: string): void;
      check(text: string, from: number, to: number): boolean;
      checkHeading(from: number, to: number): boolean;
      checkNestedHeading(): boolean;
      snapshot(): unknown;
    };
  }
}

test("root and observed containers keep H1–H6 slash input as literal text", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-slash-list-context-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-slash-heading-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate(
        (level) => window.__semloRequireFixture("listSlashFixture").mountHeading(level, "/原文"),
        level,
      );
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").checkHeading(1, 2))).toBe(true);
    }
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mount("paragraph", "/原文"));
    expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").checkHeading(1, 2))).toBe(false);
    for (const container of ["blockquote", "details", "callout", "foldCallout"] as const) {
      await page.evaluate(
        (container) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading(container),
        container,
      );
      expect(await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").checkNestedHeading())).toBe(
        true,
      );
    }
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate((level) => window.__semloRequireFixture("listSlashFixture").mountHeading(level), level);
      const heading = page.locator(`#slash-list-fixture .semlo-editor-prose h${level}`);
      await heading.click();
      await page.keyboard.type("/");
      await page.keyboard.insertText("高亮");
      await expect(heading).toHaveText("/高亮");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      for (const position of ["start", "middle", "end"] as const) {
        await page.evaluate(
          (level) => window.__semloRequireFixture("listSlashFixture").mountHeading(level, "甲乙丙"),
          level,
        );
        await heading.click();
        await page.keyboard.press("Home");
        if (position === "middle") await page.keyboard.press("ArrowRight");
        if (position === "end") await page.keyboard.press("End");
        await page.keyboard.type("/");
        await expect(heading).toHaveText(
          position === "start" ? "/甲乙丙" : position === "middle" ? "甲/乙丙" : "甲乙丙/",
        );
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
        await expect(page.locator("#slash-list-fixture .semlo-editor-prose")).toBeFocused();
      }
    }
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate(
        (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("blockquote", level, ""),
        level,
      );
      const heading = page.locator(`#slash-list-fixture .semlo-editor-prose blockquote h${level}`);
      await heading.click();
      await page.keyboard.type("/");
      await page.keyboard.insertText("高亮");
      await expect(heading).toHaveText("/高亮");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      for (const position of ["start", "middle", "end"] as const) {
        await page.evaluate(
          (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("blockquote", level, "甲乙丙"),
          level,
        );
        await heading.click();
        await page.keyboard.press("Home");
        if (position === "middle") await page.keyboard.press("ArrowRight");
        if (position === "end") await page.keyboard.press("End");
        await page.keyboard.type("/");
        await expect(heading).toHaveText(
          position === "start" ? "/甲乙丙" : position === "middle" ? "甲/乙丙" : "甲乙丙/",
        );
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
        await expect(page.locator("#slash-list-fixture .semlo-editor-prose")).toBeFocused();
      }
    }
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate(
        (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("details", level, ""),
        level,
      );
      const heading = page.locator(`#slash-list-fixture .semlo-editor-prose [data-type="detailsContent"] h${level}`);
      await heading.click();
      await page.keyboard.type("/");
      await page.keyboard.insertText("高亮");
      await expect(heading).toHaveText("/高亮");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      for (const position of ["start", "middle", "end"] as const) {
        await page.evaluate(
          (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("details", level, "甲乙丙"),
          level,
        );
        await heading.click();
        await heading.evaluate((element, position) => {
          const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
          const range = document.createRange();
          range.setStart(text, position === "start" ? 0 : position === "middle" ? 1 : 3);
          range.collapse(true);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        }, position);
        await page.keyboard.type("/");
        await expect(heading).toHaveText(
          position === "start" ? "/甲乙丙" : position === "middle" ? "甲/乙丙" : "甲乙丙/",
        );
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
        await expect(page.locator("#slash-list-fixture .semlo-editor-prose")).toBeFocused();
      }
    }
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate(
        (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("callout", level, ""),
        level,
      );
      const heading = page.locator(
        `#slash-list-fixture .semlo-editor-prose aside[data-semlo-editor-callout] h${level}`,
      );
      await heading.click();
      await page.keyboard.type("/");
      await page.keyboard.insertText("高亮");
      await expect(heading).toHaveText("/高亮");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      for (const position of ["start", "middle", "end"] as const) {
        await page.evaluate(
          (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("callout", level, "甲乙丙"),
          level,
        );
        await heading.click();
        await page.keyboard.press("Home");
        if (position === "middle") await page.keyboard.press("ArrowRight");
        if (position === "end") await page.keyboard.press("End");
        await page.keyboard.type("/");
        await expect(heading).toHaveText(
          position === "start" ? "/甲乙丙" : position === "middle" ? "甲/乙丙" : "甲乙丙/",
        );
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
        await expect(page.locator("#slash-list-fixture .semlo-editor-prose")).toBeFocused();
      }
    }
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate(
        (level) => window.__semloRequireFixture("listSlashFixture").mountNestedHeading("foldCallout", level, ""),
        level,
      );
      const heading = page.locator(
        `#slash-list-fixture .semlo-editor-prose [data-type="detailsContent"] aside[data-semlo-editor-callout] h${level}`,
      );
      await heading.click();
      await page.keyboard.type("/");
      await page.keyboard.insertText("高亮");
      await expect(heading).toHaveText("/高亮");
      await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
      for (const position of ["start", "middle", "end"] as const) {
        await page.evaluate(
          (level) =>
            window.__semloRequireFixture("listSlashFixture").mountNestedHeading("foldCallout", level, "甲乙丙"),
          level,
        );
        await heading.click();
        await heading.evaluate((element, position) => {
          const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
          const range = document.createRange();
          range.setStart(text, position === "start" ? 0 : position === "middle" ? 1 : 3);
          range.collapse(true);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        }, position);
        await page.keyboard.type("/");
        await expect(heading).toHaveText(
          position === "start" ? "/甲乙丙" : position === "middle" ? "甲/乙丙" : "甲乙丙/",
        );
        await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
        expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
        await expect(page.locator("#slash-list-fixture .semlo-editor-prose")).toBeFocused();
      }
    }
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mount("ordered", "原文"));
    await page.locator("#slash-list-fixture .semlo-editor-prose li p").click();
    await page.keyboard.press("ControlOrMeta+Alt+2");
    const convertedHeading = page.locator("#slash-list-fixture .semlo-editor-prose h2");
    await expect(convertedHeading).toHaveCount(1);
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await expect(convertedHeading).toContainText("/原文");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("listSlashFixture").mount("paragraph"));
    await page.locator("#slash-list-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
  } finally {
    await server.close();
  }
});
