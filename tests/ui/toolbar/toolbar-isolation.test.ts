import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import { openFontToolbar } from "../../fixtures/browser/font-toolbar";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
declare global {
  interface Window {
    toolbarIsolation?: {
      openEmoji(index: number): void;
      openBlockBelow(index: number): void;
      destroyNextChange(index: number): void;
      setEditable(index: number, value: boolean): void;
      setContent(index: number, value: string): void;
      selectText(index: number, from: number, to: number): void;
      appendReplace(index: number): void;
      rejectReplace(index: number): void;
      appendEqual(index: number): void;
      appendRebuild(index: number): void;
      rootReplaceThenRestore(index: number): void;
      rootReplaceActiveThenRestore(index: number): void;
      appendSplitRestore(index: number): void;
      appendLocal(index: number): void;
      destroy(index: number): void;
      destroyNextTransaction(index: number): void;
      clickStaleOnTransaction(index: number): void;
      clickSelectorOnTransaction(index: number, selector: string): void;
      clickStaleColorOnTransaction(index: number): void;
      clickStaleColorBeforeTransaction(index: number): void;
      clickStaleCardOnTransaction(index: number): void;
      replaceNextTransaction(index: number): void;
      replaceSameNextTransaction(index: number): void;
      replaceAsyncNextTransaction(index: number): void;
      replaceAsyncSameNextTransaction(index: number): void;
      beginOtherNextTransaction(index: number): void;
      replaceExtraNextTransaction(
        index: number,
        mode: "direct-different" | "direct-same" | "double" | "atomic-different" | "atomic-same" | "atomic-double",
      ): void;
      changes(index: number): string[];
      clearEvents(index: number): void;
      events(
        index: number,
      ): { docChanged: boolean; appendedChanges: number; appendedCount: number; slashVisible: boolean }[];
      snapshot(index: number): unknown;
    };
  }
}
test("pending slash menus respect read-only and document replacement across editors", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    for (const mode of ["readonly", "controlled", "append", "rebuild"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      const a = page.locator("#editor-a .semlo-editor-prose");
      const b = page.locator("#editor-b .semlo-editor-prose");
      await a.click();
      await page.keyboard.type("/p");
      const menu = page.getByRole("listbox", { name: "插入内容" });
      await expect(menu).toBeVisible();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").clearEvents(0));
      if (mode === "readonly")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setEditable(0, false));
      if (mode === "controlled")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>新文档</p>"));
      if (mode === "append")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
      if (mode === "rebuild")
        await page.evaluate(() => {
          window.__semloRequireFixture("toolbarIsolation").clickStaleOnTransaction(0);
          window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
        });
      const before = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0));
      if (mode === "rebuild") await expect(a.locator("p")).toHaveText("/p");
      await expect(menu, mode).toBeHidden();
      if (mode === "rebuild") {
        const events = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").events(0));
        expect(events).toEqual([
          { docChanged: false, appendedChanges: 1, appendedCount: 1, slashVisible: false },
          { docChanged: false, appendedChanges: 0, appendedCount: 0, slashVisible: false },
        ]);
      }
      if (await menu.isVisible()) {
        const item = menu.locator('[data-command="paragraph"]');
        if (await item.isVisible()) await item.click({ timeout: 2000 });
      }
      expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0)), mode).toEqual(
        before,
      );
      await b.click();
      await page.keyboard.type("/p");
      await page.keyboard.press("Enter");
      await page.keyboard.type("B");
      await expect(b.locator("p")).toHaveText("B");
      expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0)), mode).toEqual(
        before,
      );
    }
  } finally {
    await server.close();
  }
});

test("replaced documents ignore stale slash quick actions and child menus", async ({ page }) => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/toolbar/toolbar-isolation-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const mode of ["quick", "table", "columns", "table-trigger"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      const editor = page.locator("#editor-a .semlo-editor-prose");
      await editor.click();
      await page.keyboard.type("/");
      const menu = page.getByRole("listbox", { name: "插入内容" });
      await expect(menu).toBeVisible();
      if (mode === "table") {
        await menu.locator('[data-command="table"]').hover();
        await expect(page.getByLabel("选择表格大小")).toBeVisible();
      }
      if (mode === "columns") {
        await menu.locator('[data-command="columns"]').hover();
        await expect(page.getByRole("menu", { name: "选择分栏数" })).toBeVisible();
      }
      const selector = {
        quick: '.semlo-editor-slash-menu .semlo-editor-quick-grid button[aria-label="标题1"]',
        table: '.semlo-editor-table-grid button[aria-label="1行1列"]',
        columns: '.semlo-editor-column-picker button[aria-label="两栏"]',
        "table-trigger": '.semlo-editor-slash-menu [data-command="table"]',
      }[mode];
      const before = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0));
      await page.evaluate((selector) => {
        const fixture = window.__semloRequireFixture("toolbarIsolation");
        fixture.clickSelectorOnTransaction(0, selector);
        fixture.appendRebuild(0);
      }, selector);
      await expect(menu, mode).toBeHidden();
      await expect(page.locator(".semlo-editor-table-grid-popover, .semlo-editor-column-picker"), mode).toHaveCount(0);
      expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0)), mode).toEqual(
        before,
      );
    }
  } finally {
    await server.close();
  }
});

test("open toolbar insertion does not act on a replaced document", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    for (const mode of ["readonly", "controlled", "append", "rebuild"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      await page.locator("#editor-a").getByRole("button", { name: "插入内容", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "插入内容" });
      await expect(panel).toBeVisible();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").clearEvents(0));
      if (mode === "readonly")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setEditable(0, false));
      if (mode === "controlled")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>新文档</p>"));
      if (mode === "append")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
      if (mode === "rebuild")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendRebuild(0));
      const before = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0));
      await expect(panel, mode).toBeHidden();
      if (mode === "rebuild") {
        const events = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").events(0));
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ docChanged: false, appendedChanges: 1, appendedCount: 1, slashVisible: false });
      }
      expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").snapshot(0)), mode).toEqual(
        before,
      );
    }
  } finally {
    await server.close();
  }
});

test("local or net-equal changes preserve toolbar insertion and teardown is isolated", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    for (const mode of ["local", "equal"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      await page.locator("#editor-a").getByRole("button", { name: "插入内容", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "插入内容" });
      await expect(panel).toBeVisible();
      if (mode === "local") await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendLocal(0));
      else await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendEqual(0));
      await expect(panel, mode).toBeVisible();
      await panel.locator('[role="option"][data-command="callout"]').click();
      await expect(page.locator("#editor-a .semlo-editor-prose aside[data-semlo-editor-callout]")).toHaveCount(1);
    }
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.locator("#editor-a").getByRole("button", { name: "插入内容", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "插入内容" });
    await expect(panel).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").destroy(0));
    await expect(panel).toBeHidden();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.locator("#editor-a").getByRole("button", { name: "插入内容", exact: true }).click();
    await expect(panel).toBeVisible();
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").destroyNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendReplace(0);
    });
    await expect(panel).toBeHidden();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setEditable(1, false));
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setEditable(1, true));
    await page.locator("#editor-b .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("B");
    await expect(page.locator("#editor-b .semlo-editor-prose p")).toHaveText("B");
  } finally {
    await server.close();
  }
});

test("slash menu survives ordinary typing and an equal replacement preserving nodes", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const editor = page.locator("#editor-a .semlo-editor-prose");
    await editor.click();
    await page.keyboard.type("/");
    const menu = page.getByRole("listbox", { name: "插入内容" });
    await expect(menu).toBeVisible();
    await page.keyboard.type("p");
    await expect(menu.locator('[data-command="paragraph"]')).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendEqual(0));
    await expect(menu).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").rootReplaceThenRestore(0));
    await expect(menu).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").rootReplaceActiveThenRestore(0));
    await expect(menu).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").clearEvents(0));
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendSplitRestore(0));
    await expect(menu).toBeVisible();
    const events = await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").events(0));
    expect(events).toHaveLength(1);
    expect(events[0].appendedCount).toBe(2);
    await page.keyboard.press("Enter");
    await expect(editor.locator("p")).toHaveText("");
    await expect(editor).toBeFocused();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").beginOtherNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
    });
    await expect(page.locator("#editor-b .semlo-editor-prose p")).toHaveText("/h1");
    await expect(menu.locator('[data-command="heading1"]')).toBeVisible();
    for (const mode of [
      "direct-different",
      "direct-same",
      "double",
      "atomic-different",
      "atomic-same",
      "atomic-double",
    ] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.locator("#editor-a .semlo-editor-prose").click();
      await page.keyboard.type("/p");
      await page.evaluate((value) => {
        window.__semloRequireFixture("toolbarIsolation").replaceExtraNextTransaction(0, value);
        window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
      }, mode);
      if (mode === "direct-different" || mode === "atomic-different")
        await expect(menu.locator('[data-command="heading1"]'), mode).toBeVisible();
      else if (mode === "atomic-same" || mode === "atomic-double") await expect(menu, mode).toBeHidden();
      else await expect(menu.locator('[data-command="paragraph"]'), mode).toBeVisible();
    }
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").replaceNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
    });
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("/h1");
    await expect(menu.locator('[data-command="heading1"]')).toBeVisible();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").replaceAsyncSameNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
    });
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("/p");
    await expect(menu.locator('[data-command="paragraph"]')).toBeVisible();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").replaceAsyncNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
    });
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("/h1");
    await expect(menu.locator('[data-command="heading1"]')).toBeVisible();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").replaceSameNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
    });
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("/p");
    await expect(menu.locator('[data-command="paragraph"]')).toBeVisible();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#editor-a .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await expect(menu).toBeVisible();
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").destroyNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendRebuild(0);
    });
    await expect(menu).toBeHidden();
    await page.locator("#editor-b .semlo-editor-prose").click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("B");
    await expect(page.locator("#editor-b .semlo-editor-prose p")).toHaveText("B");
  } finally {
    await server.close();
  }
});

test("synthetic composition and destruction do not leave an actionable stale slash menu", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const editor = page.locator("#editor-a .semlo-editor-prose");
    await editor.click();
    await page.keyboard.type("/p");
    const menu = page.getByRole("listbox", { name: "插入内容" });
    await expect(menu).toBeVisible();
    await editor.dispatchEvent("compositionstart", { data: "" });
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendRebuild(0));
    await editor.dispatchEvent("compositionend", { data: "" });
    await expect(menu).toBeHidden();
    await expect(editor.locator("p")).toHaveText("/p");
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").destroy(0));
    await page.locator("#editor-b .semlo-editor-prose").click();
    await page.keyboard.type("B");
    await expect(page.locator("#editor-b .semlo-editor-prose p")).toHaveText("B");
  } finally {
    await server.close();
  }
});

test("user Escape retains normal dismissed behavior after an invalidation", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const editor = page.locator("#editor-a .semlo-editor-prose");
    const menu = page.getByRole("listbox", { name: "插入内容" });
    await editor.click();
    await page.keyboard.type("/p");
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendRebuild(0));
    await expect(menu).toBeHidden();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendSplitRestore(0));
    await expect(menu).toBeHidden();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p></p>"));
    await editor.click();
    await page.keyboard.type("/p");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.keyboard.type("x");
    await expect(menu).toBeHidden();
    await expect(editor.locator("p")).toHaveText("/px");
  } finally {
    await server.close();
  }
});

test("open color palette is invalidated after document replacement or read-only transition", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const mode of ["append", "rebuild", "controlled", "readonly"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
      await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
      const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
      await expect(palette).toBeVisible();
      if (mode === "append")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
      if (mode === "rebuild")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendRebuild(0));
      if (mode === "controlled")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>新文档</p>"));
      if (mode === "readonly")
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setEditable(0, false));
      await expect(palette, mode).toBeHidden();
      const text = mode === "append" || mode === "controlled" ? "新文档" : "旧文档";
      await expect(page.locator("#editor-a .semlo-editor-prose p"), mode).toHaveText(text);
    }
  } finally {
    await server.close();
  }
});

test("color palette survives local or reference-preserving net-equal changes", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const mode of ["local", "equal"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
      await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
      const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
      await expect(palette).toBeVisible();
      if (mode === "local") await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendLocal(0));
      else await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendEqual(0));
      await expect(palette, mode).toBeVisible();
      await palette.getByRole("button", { name: "浅蓝 #117cee" }).click();
      await expect(palette).toBeHidden();
    }
  } finally {
    await server.close();
  }
});

test("alignment, line-height and custom color popovers close after replacement", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const mode of ["alignment", "lineheight", "custom"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
      if (mode === "custom") {
        await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
        await page
          .getByRole("dialog", { name: "选择颜色", exact: true })
          .getByRole("button", { name: "更多颜色" })
          .click();
        await expect(page.getByRole("dialog", { name: "自定义颜色" })).toBeVisible();
      } else {
        const name = mode === "alignment" ? "文本对齐" : "行高调整";
        await page.locator("#editor-a").getByRole("button", { name, exact: true }).click();
        await expect(page.locator("#editor-a").getByRole("button", { name, exact: true })).toHaveAttribute(
          "aria-expanded",
          "true",
        );
      }
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
      if (mode === "custom") {
        await expect(page.getByRole("dialog", { name: "自定义颜色" })).toBeHidden();
        await expect(page.getByRole("dialog", { name: "选择颜色", exact: true })).toBeHidden();
      } else {
        const name = mode === "alignment" ? "文本对齐" : "行高调整";
        await expect(page.locator("#editor-a").getByRole("button", { name, exact: true })).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      }
      await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("新文档");
    }
  } finally {
    await server.close();
  }
});

test("replacement and reentrant teardown do not close another editor palette", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>");
      window.__semloRequireFixture("toolbarIsolation").setContent(1, "<p>另一文档</p>");
    });
    await page.locator("#editor-b .semlo-editor-prose p").click();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(1, 1, 5));
    await page.locator("#editor-b").getByRole("button", { name: "文字颜色", exact: true }).click();
    const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
    await expect(palette).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
    await expect(palette).toBeVisible();
    await palette.getByRole("button", { name: "浅蓝 #117cee" }).click();
    await expect(page.locator('#editor-b .semlo-editor-prose span[style*="color"]')).toHaveCount(1);
    await page.locator("#editor-a .semlo-editor-prose p").click();
    await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
    await expect(palette).toBeVisible();
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").destroyNextTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendReplace(0);
    });
    await expect(palette).toBeHidden();
    await page.locator("#editor-b .semlo-editor-prose p").click();
    await page.keyboard.type("B");
    await expect(page.locator("#editor-b .semlo-editor-prose p")).toContainText("B");
  } finally {
    await server.close();
  }
});

test("font and emoji pickers close after appended replacement", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const mode of ["font", "emoji"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      if (mode === "font") {
        await openFontToolbar(page.locator("#editor-a"));
      } else {
        await page.locator("#editor-a").getByRole("button", { name: "插入内容", exact: true }).click();
        await page.getByRole("dialog", { name: "插入内容" }).locator('[role="option"][data-command="emoji"]').click();
      }
      const picker = page.getByRole("dialog", { name: mode === "font" ? "选择字体" : "选择表情" });
      await expect(picker, mode).toBeVisible();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
      await expect(picker, mode).toBeHidden();
      await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("新文档");
    }
  } finally {
    await server.close();
  }
});

test("pending link form closes on appended document replacement", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
    await page.locator("#editor-a .semlo-editor-prose p").click();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
    await page
      .locator("#editor-a")
      .getByRole("toolbar", { name: "文本格式" })
      .getByRole("button", { name: "链接", exact: true })
      .click();
    const form = page.getByRole("dialog", { name: "插入链接" });
    await expect(form).toBeVisible();
    await form.getByPlaceholder("链接地址").fill("https://example.com");
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").appendReplace(0));
    await expect(form).toBeHidden();
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("新文档");
    await expect(page.locator("#editor-a .semlo-editor-prose a")).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("replacement cannot activate a stale palette from an earlier transaction listener", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
    await page.locator("#editor-a .semlo-editor-prose p").click();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
    await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "选择颜色", exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").clickStaleColorOnTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendReplace(0);
    });
    await expect(page.getByRole("dialog", { name: "选择颜色", exact: true })).toBeHidden();
    await page.locator("#editor-a .semlo-editor-prose").focus();
    await page.keyboard.type("Z");
    await expect(page.locator('#editor-a .semlo-editor-prose span[style*="color"]')).toHaveCount(0);
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("新文档Z");
  } finally {
    await server.close();
  }
});

test("replacement cannot activate stale insertion from an earlier transaction listener", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
    await page.locator("#editor-a .semlo-editor-prose p").click();
    await page.locator("#editor-a").getByRole("button", { name: "插入内容", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "插入内容" })).toBeVisible();
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").clickStaleCardOnTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendReplace(0);
    });
    await expect(page.getByRole("dialog", { name: "插入内容" })).toBeHidden();
    await expect(page.locator("#editor-a .semlo-editor-prose p")).toHaveText("新文档");
    await expect(page.locator("#editor-a .semlo-editor-prose aside[data-semlo-editor-callout]")).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("rejected and reference-preserving net-equal replacements do not block color actions", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const mode of ["reject", "equal", "split"] as const) {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
      await page.locator("#editor-a .semlo-editor-prose p").click();
      await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
      await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
      const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
      await expect(palette).toBeVisible();
      if (mode === "reject") {
        await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").rejectReplace(0));
        await expect(palette).toBeVisible();
        await palette.getByRole("button", { name: "浅蓝 #117cee" }).click();
      } else {
        await page.evaluate((value) => {
          window.__semloRequireFixture("toolbarIsolation").clickStaleColorOnTransaction(0);
          if (value === "split") window.__semloRequireFixture("toolbarIsolation").appendSplitRestore(0);
          else window.__semloRequireFixture("toolbarIsolation").appendEqual(0);
        }, mode);
      }
      await expect(palette).toBeHidden();
      if (mode === "reject")
        await expect(page.locator('#editor-a .semlo-editor-prose span[style*="color"]')).toHaveCount(1);
      else {
        await page.locator("#editor-a .semlo-editor-prose").focus();
        await page.keyboard.type("Z");
        await expect(page.locator('#editor-a .semlo-editor-prose span[style*="color"]')).toHaveCount(1);
      }
    }
  } finally {
    await server.close();
  }
});

test("before-transaction host listener cannot execute stale palette", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-isolation-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-toolbar-isolation-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").setContent(0, "<p>旧文档</p>"));
    await page.locator("#editor-a .semlo-editor-prose p").click();
    await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").selectText(0, 1, 4));
    await page.locator("#editor-a").getByRole("button", { name: "文字颜色", exact: true }).click();
    await page.evaluate(() => {
      window.__semloRequireFixture("toolbarIsolation").clearEvents(0);
      window.__semloRequireFixture("toolbarIsolation").clickStaleColorBeforeTransaction(0);
      window.__semloRequireFixture("toolbarIsolation").appendReplace(0);
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").changes(0))).toEqual([
      "<p>新文档</p>",
    ]);
    expect(await page.evaluate(() => window.__semloRequireFixture("toolbarIsolation").events(0))).toEqual([
      { docChanged: false, appendedChanges: 1, appendedCount: 1, slashVisible: false },
    ]);
  } finally {
    await server.close();
  }
});
