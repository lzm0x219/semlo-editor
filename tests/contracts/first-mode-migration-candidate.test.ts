import path from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/list/list-fold-framework-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let origin = "",
  stop = async () => {};
test.beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/list/list-fold-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": path.resolve("packages/core/src/index.ts") } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = async () => {
    await server.close();
  };
});
test.afterAll(async () => {
  await stop();
});
for (const continued of [false, true]) {
  for (const action of ["删除", "无序列表"] as const) {
    test(`first ${action} retains ${continued ? "continue" : "restart"} mode and undo`, async ({ page }) => {
      await page.goto(origin);
      await page.waitForFunction(() => window.listFoldFramework);
      await page.evaluate((mode) => {
        const fixture = window.__semloRequireFixture("listFoldFramework");
        fixture.mount("core");
        const item = (text: string) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        });
        fixture.controller!.setContent({
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { semloEditorListFirstContinue: mode },
              content: [item("首项"), item("次项"), item("末项")],
            },
          ],
        });
      }, continued);
      const before = await page.evaluate(
        () => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json,
      );
      const host = page.locator("#list-fold-framework");
      await host.getByText("首项", { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      const blockMenu = page.getByRole("menu", { name: "块操作" });
      if (action === "删除") await blockMenu.getByRole("menuitem", { name: "删除", exact: true }).click();
      else {
        await blockMenu.getByRole("menuitem", { name: "转化为" }).click();
        await page
          .getByRole("menu", { name: "转化为" })
          .getByRole("menuitem", { name: "无序列表", exact: true })
          .click();
      }
      await host.getByRole("button", { name: "设置列表编号：次项" }).click();
      const menu = page.getByRole("menu", { name: "设置列表编号" });
      await expect(menu.getByRole("menuitem", { name: "重新编号" })).toHaveJSProperty("disabled", !continued);
      await expect(menu.getByRole("menuitem", { name: "继续编号" })).toHaveJSProperty("disabled", continued);
      const saved = await page.evaluate(() =>
        window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot(),
      );
      expect(saved.html.includes('data-semlo-editor-list-first-continue="true"')).toBe(continued);
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
      expect(
        await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
      ).toEqual(before);
    });
  }
}

test("snapshot omits default first mode, retains explicit continuation, and round trips", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  const saved = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("listFoldFramework");
    fixture.mount("core");
    const item = (text: string) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    fixture.controller!.setContent({
      type: "doc",
      content: [
        { type: "orderedList", content: [item("甲")] },
        { type: "paragraph" },
        { type: "orderedList", attrs: { semloEditorListFirstContinue: true }, content: [item("乙")] },
      ],
    });
    return fixture.controller!.getSnapshot();
  });
  expect(saved.json.content?.[0].attrs).not.toHaveProperty("semloEditorListFirstContinue");
  expect(saved.json.content?.[2].attrs?.semloEditorListFirstContinue).toBe(true);
  expect(saved.html.match(/data-semlo-editor-list-first-continue="true"/g)).toHaveLength(1);
  for (const value of [saved.json, saved.html]) {
    await page.evaluate(
      (content) => window.__semloRequireFixture("listFoldFramework").controller!.setContent(content),
      value,
    );
    const roundtrip = await page.evaluate(() =>
      window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot(),
    );
    expect(roundtrip.json.content?.[0].attrs).not.toHaveProperty("semloEditorListFirstContinue");
    expect(roundtrip.json.content?.[2].attrs?.semloEditorListFirstContinue).toBe(true);
  }
});

for (const conversion of ["标题 3"] as string[]) {
  test(`continued list refuses unverified middle ${conversion} without data changes`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: true },
            content: [item("首项"), item("次项"), item("末项")],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    });
    const host = page.locator("#list-fold-framework");
    await host.getByText("次项", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    const option = page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: conversion, exact: true });
    if (conversion === "引用") await expect(option).toBeDisabled();
    else {
      await option.click();
      await expect(page.getByText("当前块无法无损转换")).toBeVisible();
    }
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const scenario of ["continue-cross-source", "continue-cross-target"] as const) {
  test(`unverified ${scenario} drag leaves the document intact`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const setup = await page.evaluate((name) => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      const list = (items: string[], mode: boolean) => ({
        type: "orderedList",
        attrs: { semloEditorListFirstContinue: mode },
        content: items.map(item),
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          list(["甲", "乙"], name === "continue-cross-source"),
          { type: "paragraph", content: [{ type: "text", text: "分隔" }] },
          list(["丙", "丁"], name === "continue-cross-target"),
        ],
      });
      return fixture.controller!.getSnapshot().json;
    }, scenario);
    const host = page.locator("#list-fold-framework");
    await host.getByText("乙", { exact: true }).hover();
    const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
    const target = await host.getByText("丙", { exact: true }).boundingBox();
    if (!from || !target) throw new Error("Missing drag bounds");
    await page.mouse.move(from.x + 12, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
    await page.mouse.move(target.x + 5, target.y + 2, { steps: 10 });
    await expect(page.locator(".semlo-editor-block-drop-indicator")).toBeVisible();
    await page.mouse.up();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(setup);
  });
}

for (const continued of [false, true]) {
  test(`dragging first item after second sets continue mode and undo restores ${continued}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate((mode) => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: mode },
            content: [item("甲"), item("乙"), item("丙")],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    }, continued);
    const host = page.locator("#list-fold-framework");
    await host.getByText("甲", { exact: true }).hover();
    const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
    const target = await host.getByText("乙", { exact: true }).boundingBox();
    if (!from || !target) throw new Error("Missing drag bounds");
    await page.mouse.move(from.x + 12, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
    await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 10 });
    await expect(page.locator(".semlo-editor-block-drop-indicator")).toBeVisible();
    await page.mouse.up();
    await expect(host.locator(".semlo-editor-prose ol > li")).toHaveText(["乙", "甲", "丙"]);
    const after = await page.evaluate(() =>
      window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot(),
    );
    expect(after.json.content?.[0].attrs?.semloEditorListFirstContinue).toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const continued of [false, true]) {
  test(`empty first item Enter keeps mode of remaining items and undo restores ${continued}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate((mode) => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: mode },
            content: [
              { type: "listItem", content: [{ type: "paragraph" }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
            ],
          },
        ],
      });
      fixture.controller!.editor.chain().focus().setTextSelection(3).run();
      return fixture.controller!.getSnapshot().json;
    }, continued);
    await page.waitForTimeout(650); // Keep fixture setup out of the Enter history event.
    await page.keyboard.press("Enter");
    await expect(page.locator("#list-fold-framework .semlo-editor-prose ol > li")).toHaveText(["乙"]);
    const after = await page.evaluate(() =>
      window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot(),
    );
    const list = after.json.content?.find((node) => node.type === "orderedList");
    expect(list?.attrs?.semloEditorListFirstContinue === true).toBe(continued);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const action of ["复制", "剪切"] as const) {
  test(`continued list partial ${action} avoids unverified clipboard mode`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          { type: "orderedList", attrs: { semloEditorListFirstContinue: true }, content: [item("甲"), item("乙")] },
        ],
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          write: async () => {
            document.body.dataset.clipboardWritten = "yes";
          },
        },
      });
      return fixture.controller!.getSnapshot().json;
    });
    await page.locator("#list-fold-framework").getByText("乙", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: action, exact: true }).click();
    await expect(page.getByText("当前块无法复制")).toBeVisible();
    expect(await page.evaluate(() => document.body.dataset.clipboardWritten)).toBeUndefined();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const continued of [false, true]) {
  test(`Tab level change and undo preserve first mode ${continued}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate((mode) => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          { type: "orderedList", attrs: { semloEditorListFirstContinue: mode }, content: [item("甲"), item("乙")] },
        ],
      });
      fixture.controller!.editor.chain().focus().setTextSelection(3).run();
      return fixture.controller!.getSnapshot().json;
    }, continued);
    await page.waitForTimeout(650);
    await page.keyboard.press("Tab");
    const after = await page.evaluate(
      () => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json,
    );
    expect(after.content?.[0].content?.[0].attrs?.semloEditorListIndent).toBe(1);
    expect(after.content?.[0].attrs?.semloEditorListFirstContinue === true).toBe(continued);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.redo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(after);
  });
}

test("copying a whole continued list keeps its mode in rich HTML", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  const before = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("listFoldFramework");
    fixture.mount("core");
    fixture.controller!.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorListFirstContinue: true },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] }],
        },
      ],
    });
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: class {
        constructor(public data: Record<string, Blob>) {}
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: Array<{ data: Record<string, Blob> }>) => {
          document.body.dataset.copyHtml = await items[0].data["text/html"].text();
        },
      },
    });
    return fixture.controller!.getSnapshot().json;
  });
  await page.locator("#list-fold-framework").getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "复制", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.copyHtml !== undefined);
  expect(await page.evaluate(() => document.body.dataset.copyHtml)).toContain(
    'data-semlo-editor-list-first-continue="true"',
  );
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(before);
});

test("continued nested group deletion is rejected without modifying the document", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  const before = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("listFoldFramework");
    fixture.mount("core");
    const item = (text: string, indent: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: indent },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    fixture.controller!.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorListFirstContinue: true },
          content: [item("父项", 0), item("子项", 1), item("后项", 0)],
        },
      ],
    });
    return fixture.controller!.getSnapshot().json;
  });
  await page.locator("#list-fold-framework").getByText("父项", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.getByText("当前块无法安全删除")).toBeVisible();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(before);
});

test("continued first mode survives changing ordered style and undo", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  const before = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("listFoldFramework");
    fixture.mount("core");
    fixture.controller!.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorListFirstContinue: true },
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "首项" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "次项" }] }] },
          ],
        },
      ],
    });
    return fixture.controller!.getSnapshot().json;
  });
  const host = page.locator("#list-fold-framework");
  await host.getByRole("button", { name: "设置列表编号：首项" }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "修改样式" }).click();
  await page.getByRole("menu", { name: "有序列表样式" }).getByRole("menuitemradio", { name: "中文数字" }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot());
  expect(after.json.content?.[0].attrs?.semloEditorListFirstContinue).toBe(true);
  expect(after.json.content?.[0].attrs?.semloEditorOrderedStyle).toBe("chinese");
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(before);
});

for (const mode of [false, true]) {
  test(`unobserved Chinese first mode ${mode} remains unchanged`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate((continued) => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "chinese", semloEditorListFirstContinue: continued },
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "首项" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "次项" }] }] },
            ],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    }, mode);
    await page.getByRole("button", { name: "设置列表编号：首项" }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
    await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeDisabled();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const continued of [false, true]) {
  test(`dragging a later item to first retains ${continued ? "continue" : "restart"} mode and undo`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate((mode) => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: mode },
            content: [item("首项"), item("次项"), item("末项")],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    }, continued);
    const host = page.locator("#list-fold-framework");
    await host.getByText("次项", { exact: true }).hover();
    const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
    const target = await host.getByText("首项", { exact: true }).boundingBox();
    if (!from || !target) throw new Error("Missing drag bounds");
    await page.mouse.move(from.x + 12, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
    await page.mouse.move(target.x + 5, target.y + 2, { steps: 10 });
    await expect(page.locator(".semlo-editor-block-drop-indicator")).toBeVisible();
    await page.mouse.up();
    await expect(host.locator(".semlo-editor-prose ol > li")).toHaveText(["次项", "首项", "末项"]);
    await host.getByRole("button", { name: "设置列表编号：次项" }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    expect(await menu.getByRole("menuitem", { name: "重新编号" }).isEnabled()).toBe(continued);
    expect(await menu.getByRole("menuitem", { name: "继续编号" }).isEnabled()).toBe(!continued);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const [label, type] of [
  ["无序列表", "bulletList"],
  ["待办事项", "taskList"],
] as const) {
  test(`continued middle item converts to ${label} with continued prefix and suffix`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: true },
            content: [item("首项"), item("次项"), item("末项")],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    });
    const host = page.locator("#list-fold-framework");
    await host.getByText("次项", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: label, exact: true }).click();
    const after = await page.evaluate(
      () => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json,
    );
    expect(after.content?.map((node) => node.type)).toEqual(["orderedList", type, "orderedList"]);
    expect(after.content?.[0].attrs?.semloEditorListFirstContinue).toBe(true);
    expect(after.content?.[2].attrs?.start).toBe(2);
    await host.getByRole("button", { name: "设置列表编号：末项" }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeEnabled();
    await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeDisabled();
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const [target, conversion, remaining] of [
  ["首项", "待办事项", "次项"],
  ["末项", "无序列表", "首项"],
  ["末项", "待办事项", "首项"],
] as const) {
  test(`continued ${target} to ${conversion} retains mode on ${remaining}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: true },
            content: [item("首项"), item("次项"), item("末项")],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    });
    const host = page.locator("#list-fold-framework");
    await host.getByText(target, { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: conversion, exact: true }).click();
    const after = await page.evaluate(
      () => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json,
    );
    const targetNode = after.content?.find(
      (node) => node.type === (conversion === "待办事项" ? "taskList" : "bulletList"),
    );
    expect(targetNode?.content?.[0].content?.[0].content?.[0].text).toBe(target);
    if (conversion === "待办事项") expect(targetNode?.content?.[0].attrs?.checked).toBe(false);
    const remainingList = after.content?.find((node) => node.type === "orderedList");
    expect(remainingList?.attrs?.semloEditorListFirstContinue).toBe(true);
    expect(remainingList?.content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(
      target === "首项" ? ["次项", "末项"] : ["首项", "次项"],
    );
    await host.getByRole("button", { name: `设置列表编号：${remaining}` }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeEnabled();
    await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeDisabled();
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
  });
}

for (const [target, remaining] of [
  ["首项", ["次项", "末项"]],
  ["末项", ["首项", "次项"]],
] as const) {
  test(`continued ${target} converts to heading while preserving the remaining list and undo`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("listFoldFramework");
      fixture.mount("core");
      const item = (text: string) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      fixture.controller!.setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorListFirstContinue: true },
            content: [item("首项"), item("次项"), item("末项")],
          },
        ],
      });
      return fixture.controller!.getSnapshot().json;
    });
    const host = page.locator("#list-fold-framework");
    await host.getByText(target, { exact: true }).click();
    await host.getByText(target, { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true }).click();
    await expect(host.locator("h3")).toContainText(target);
    const after = await page.evaluate(() => {
      const controller = window.__semloRequireFixture("listFoldFramework").controller!;
      const selection = controller.editor.state.selection;
      return {
        snapshot: controller.getSnapshot(),
        selectionParent: selection.$from.parent.type.name,
        selectedText: selection.$from.parent.textContent,
      };
    });
    expect(after.selectionParent).toBe("heading");
    expect(after.selectedText).toBe(target);
    const list = after.snapshot.json.content?.find((node) => node.type === "orderedList");
    expect(list?.attrs?.semloEditorListFirstContinue).toBe(true);
    expect(list?.content?.map((item) => item.content?.[0].content?.[0].text)).toEqual([...remaining]);
    expect(after.snapshot.html).toContain('data-semlo-editor-list-first-continue="true"');
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
    ).toEqual(before);
    for (const format of ["json", "html"] as const) {
      const roundtrip = await page.evaluate(
        ({ format, snapshot }) => {
          const controller = window.__semloRequireFixture("listFoldFramework").controller!;
          controller.setContent(snapshot[format]);
          return controller.getSnapshot().json;
        },
        { format, snapshot: after.snapshot },
      );
      expect(roundtrip).toEqual(after.snapshot.json);
    }
  });
}

test("continued middle quote keeps numbering linked across conversion, undo and reload", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  const before = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("listFoldFramework");
    fixture.mount("core");
    const item = (text: string) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    fixture.controller!.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorListFirstContinue: true },
          content: [item("首项"), item("次项"), item("末项")],
        },
      ],
    });
    return fixture.controller!.getSnapshot().json;
  });
  const host = page.locator("#list-fold-framework");
  await host.getByText("次项", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "引用", exact: true }).click();
  await expect(host.locator("blockquote li")).toContainText("次项");
  const snapshot = await page.evaluate(() =>
    window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot(),
  );
  expect(snapshot.json.content?.map((node) => node.type)).toEqual(["orderedList", "blockquote", "orderedList"]);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(before);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.redo());
  const numbers = async () =>
    page
      .locator("#list-fold-framework .semlo-editor-prose ol")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOListElement).start));
  expect(await numbers()).toEqual([1, 2, 3]);
  const trigger = host.getByRole("button", { name: "设置列表编号：次项" });
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  expect(await numbers()).toEqual([1, 1, 2]);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(await numbers()).toEqual([1, 2, 3]);
  await trigger.click();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "继续编号" }).click();
  expect(await numbers()).toEqual([1, 2, 3]);
  await host.getByRole("button", { name: "设置列表编号：首项" }).click();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  expect(await numbers()).toEqual([1, 2, 3]);
  await host.getByRole("button", { name: "设置列表编号：末项" }).click();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  expect(await numbers()).toEqual([1, 2, 1]);
  await trigger.click();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  expect(await numbers()).toEqual([1, 1, 1]);
  for (const content of [snapshot.json, snapshot.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("listFoldFramework").controller!.setContent(value),
      content,
    );
    expect(await numbers()).toEqual([1, 2, 3]);
    await trigger.click();
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeEnabled();
    await page.keyboard.press("Escape");
  }
  await host.getByText("首项", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  const broken = await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot());
  expect(broken.html).not.toContain("data-semlo-editor-list-quote-chain");
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(snapshot.json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listFoldFramework").controller!.editor;
    const item = editor.schema.nodes.listItem.create(
      null,
      editor.schema.nodes.paragraph.create(null, editor.schema.text("新增")),
    );
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.firstChild!.nodeSize - 1, item));
  });
  expect(await numbers()).toEqual([1, 3, 4]);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(await numbers()).toEqual([1, 2, 3]);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listFoldFramework").controller!.editor;
    const last = editor.state.doc.lastChild!;
    editor.view.dispatch(
      editor.state.tr.delete(editor.state.doc.content.size - last.nodeSize, editor.state.doc.content.size),
    );
  });
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot())).html,
  ).not.toContain("data-semlo-editor-list-quote-chain");
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(await numbers()).toEqual([1, 2, 3]);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listFoldFramework").controller!.editor;
    const start = editor.state.doc.firstChild!.nodeSize;
    const quote = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.replaceWith(start, start + quote.nodeSize, quote.content));
  });
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot())).html,
  ).not.toContain("data-semlo-editor-list-quote-chain");
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(await numbers()).toEqual([1, 2, 3]);
  const imported = await page.evaluate((saved) => {
    const controller = window.__semloRequireFixture("listFoldFramework").controller!;
    const copy = structuredClone(saved.json);
    const first = copy.content![0];
    const inside = copy.content![1].content![0];
    const last = copy.content![2];
    for (const list of [first, inside, last]) delete list.attrs!.semloEditorListQuoteChain;
    inside.attrs!.start = 13;
    last.attrs!.start = 27;
    controller.setContent(copy);
    return controller.getSnapshot().json;
  }, snapshot);
  expect(imported.content?.[1].content?.[0].attrs?.start).toBe(13);
  expect(imported.content?.[2].attrs?.start).toBe(27);
  await page.evaluate(
    (saved) => window.__semloRequireFixture("listFoldFramework").controller!.setContent(saved.json),
    snapshot,
  );
  const cloned = await page.evaluate((saved) => {
    const controller = window.__semloRequireFixture("listFoldFramework").controller!;
    const copy = structuredClone(saved.json);
    copy.content!.push(structuredClone(copy.content![1]));
    controller.setContent(copy);
    return controller.getSnapshot();
  }, snapshot);
  expect((cloned.html.match(/data-semlo-editor-list-quote-chain/g) ?? []).length).toBe(3);
  expect(cloned.json.content?.[3].content?.[0].attrs?.semloEditorListQuoteChain).toBeUndefined();
  const wholeClone = await page.evaluate((saved) => {
    const controller = window.__semloRequireFixture("listFoldFramework").controller!;
    const copy = structuredClone(saved.json);
    copy.content!.push(...structuredClone(saved.json.content!));
    controller.setContent(copy);
    return controller.getSnapshot();
  }, snapshot);
  expect((wholeClone.html.match(/data-semlo-editor-list-quote-chain/g) ?? []).length).toBe(6);
  await page.evaluate(
    (value) => window.__semloRequireFixture("listFoldFramework").controller!.setContent(value),
    before,
  );
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(before);
});

test("linked quote toggles back into one continued list and undoes", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  const before = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("listFoldFramework");
    fixture.mount("core");
    fixture.controller!.setContent(
      '<ol data-semlo-editor-list-first-continue="true" data-semlo-editor-list-quote-chain="test-chain"><li><p>首项</p></li></ol><blockquote><ol start="2" data-semlo-editor-list-first-continue="true" data-semlo-editor-list-quote-chain="test-chain"><li><p>次项</p></li></ol></blockquote><ol start="3" data-semlo-editor-list-first-continue="true" data-semlo-editor-list-quote-chain="test-chain"><li><p>末项</p></li></ol>',
    );
    return fixture.controller!.getSnapshot().json;
  });
  const host = page.locator("#list-fold-framework");
  await host.getByText("次项", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "引用", exact: true }).click();
  await expect(host.locator("blockquote")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose ol")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-prose ol > li")).toHaveText(["首项", "次项", "末项"]);
  const after = await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot());
  expect(after.json.content?.[0].attrs?.semloEditorListFirstContinue).toBe(true);
  expect(after.html).not.toContain("data-semlo-editor-list-quote-chain");
  expect(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("listFoldFramework").controller!.editor.state.selection.$from.parent.textContent,
    ),
  ).toBe("次项");
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.editor.commands.undo());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").controller!.getSnapshot().json),
  ).toEqual(before);
});
