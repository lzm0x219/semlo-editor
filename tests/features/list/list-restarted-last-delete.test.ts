import path from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/list/list-fold-framework-fixture";

test.beforeEach(async ({ page }) => installFixtureGuards(page));
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
  stop = () => server.close();
});
test.afterAll(async () => stop());

test("delete a last restarted direct child and undo preserves the restart", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("Parent", 0), item("ChildA", 1), item("ChildB", 1)],
        },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    });
  });
  const host = page.locator("#list-fold-framework");
  await host.getByRole("button", { name: "设置列表编号：ChildB" }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "重新编号" }).click();
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .getSnapshot().json,
  );
  await host.getByText("ChildB", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  const items = host.locator(".semlo-editor-prose ol > li");
  await expect(items).toHaveText(["Parent", "ChildA"]);
  await expect(items.nth(1)).toHaveCSS("list-style-type", '"1.1. "');
  await expect(host.locator(".semlo-editor-prose > p")).toHaveText(["Before", "After"]);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
          .getSnapshot().json,
    ),
  ).toEqual(before);
  await expect(items.nth(2)).toHaveCSS("list-style-type", '"1.1. "');
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.redo(),
  );
  await expect(items).toHaveText(["Parent", "ChildA"]);
});

test("deleting a restarted child before a sibling transfers the boundary", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller").setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("Parent", 0), item("ChildA", 1), item("ChildB", 1, true), item("ChildC", 1)],
        },
      ],
    });
  });
  const host = page.locator("#list-fold-framework");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .getSnapshot().json,
  );
  await host.getByText("ChildB", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  const items = host.locator(".semlo-editor-prose ol > li");
  await expect(items).toHaveText(["Parent", "ChildA", "ChildC"]);
  await expect(items.nth(2)).toHaveCSS("list-style-type", '"1.1. "');
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("an unverified multiple-parent last restart remains protected", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller").setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [
            item("ParentA", 0),
            item("ChildA", 1),
            item("ParentB", 0),
            item("ChildB", 1),
            item("ChildExtra", 1),
            item("ChildC", 1, true),
          ],
        },
      ],
    });
  });
  const host = page.locator("#list-fold-framework");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .getSnapshot().json,
  );
  await host.getByText("ChildC", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法安全删除");
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("deleting the child before a restarted last sibling keeps continuation available", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller").setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("Parent", 0), item("ChildA", 1), item("ChildB", 1)],
        },
      ],
    });
  });
  const host = page.locator("#list-fold-framework");
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await host.getByRole("button", { name: "设置列表编号：ChildB" }).click();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .getSnapshot().json,
  );
  await host.getByText("ChildA", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  const items = host.locator(".semlo-editor-prose ol > li");
  await expect(items).toHaveText(["Parent", "ChildB"]);
  await expect(items.nth(1)).toHaveCSS("list-style-type", '"1.1. "');
  await host.getByRole("button", { name: "设置列表编号：ChildB" }).click();
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
          .getSnapshot().json,
    ),
  ).toEqual(before);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.redo(),
  );
  await host.getByRole("button", { name: "设置列表编号：ChildB" }).click();
  await menu.getByRole("menuitem", { name: "继续编号" }).click();
  const after = await page.evaluate(
    () =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .getSnapshot().json,
  );
  expect(after.content?.[0].content?.[1].attrs?.semloEditorListRestart).not.toBe(true);
  await expect(items.nth(1)).toHaveCSS("list-style-type", '"1.1. "');
});

for (const deleted of ["ChildB", "ChildC"] as const) {
  test(`two parents: restart final child and delete ${deleted}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    await page.evaluate(() => {
      window.__semloRequireFixture("listFoldFramework").mount("core");
      const item = (text: string, level: number) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: level },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .setContent({
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { semloEditorOrderedStyle: "decimal" },
              content: [
                item("ParentA", 0),
                item("ChildA", 1),
                item("ParentB", 0),
                item("ChildB", 1),
                item("ChildC", 1),
              ],
            },
          ],
        });
    });
    const host = page.locator("#list-fold-framework");
    const items = host.locator(".semlo-editor-prose ol > li");
    await host.getByRole("button", { name: "设置列表编号：ChildC" }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await menu.getByRole("menuitem", { name: "重新编号" }).click();
    await expect(items.nth(4)).toHaveCSS("list-style-type", '"2.1. "');
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
          .getSnapshot().json,
    );
    await host.getByText(deleted, { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
    await expect(items).toHaveText(["ParentA", "ChildA", "ParentB", deleted === "ChildB" ? "ChildC" : "ChildB"]);
    await expect(items.nth(3)).toHaveCSS("list-style-type", '"2.1. "');
    if (deleted === "ChildB") {
      await host.getByRole("button", { name: "设置列表编号：ChildC" }).click();
      await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeEnabled();
      await page.keyboard.press("Escape");
    }
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .editor.commands.undo(),
    );
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
            .getSnapshot().json,
      ),
    ).toEqual(before);
  });
}

test("deleting the last ordinary child keeps an earlier restart and undo restores it", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller").setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("Parent", 0), item("A", 1), item("B", 1), item("C", 1), item("D", 1, true), item("E", 1)],
        },
      ],
    });
  });
  const host = page.locator("#list-fold-framework");
  const items = host.locator(".semlo-editor-prose ol > li");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
        .getSnapshot().json,
  );
  await host.getByText("E", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(items).toHaveText(["Parent", "A", "B", "C", "D"]);
  await expect(items.nth(4)).toHaveCSS("list-style-type", '"1.1. "');
  await host.getByRole("button", { name: "设置列表编号：D" }).click();
  await expect(
    page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "继续编号" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
          .getSnapshot().json,
    ),
  ).toEqual(before);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "controller")
      .editor.commands.redo(),
  );
  await expect(items).toHaveText(["Parent", "A", "B", "C", "D"]);
});
