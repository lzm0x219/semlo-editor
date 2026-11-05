import path from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/list/list-fold-framework-fixture";

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
for (const kind of ["core", "react", "vue", "solid"] as const) {
  test(`${kind}: fold, history, serialization and read-only viewing`, async ({ page }) => {
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => console.error("fixture error:", error.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework, null, { timeout: 7000 });
    await page.evaluate((value) => window.__semloRequireFixture("listFoldFramework").mount(value), kind);
    await page.waitForFunction(() => window.listFoldFramework?.controller, null, { timeout: 5000 });
    const host = page.locator("#list-fold-framework");
    await host.getByText("甲", { exact: true }).hover();
    await host.getByRole("button", { name: "折叠列表项：甲" }).click();
    await expect(host.getByText("乙", { exact: true })).toBeHidden();
    await expect(host.getByText("丙", { exact: true })).toBeVisible();
    const snapshot = await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot(),
    );
    expect(snapshot.html).toContain('data-semlo-editor-list-folded="true"');
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .editor.commands.undo(),
    );
    await expect(host.getByText("乙", { exact: true })).toBeVisible();
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .editor.commands.redo(),
    );
    await expect(host.getByText("乙", { exact: true })).toBeHidden();
    for (const content of [snapshot.html, snapshot.json]) {
      await page.evaluate(
        (value) =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .setContent(value),
        content,
      );
      await expect(host.getByText("乙", { exact: true })).toBeHidden();
    }
    await host.getByRole("button", { name: "折叠标题：标题" }).click({ force: true });
    await expect(host.getByText("甲", { exact: true })).toBeHidden();
    await host.getByRole("button", { name: "展开标题：标题" }).click();
    await expect(host.getByText("甲", { exact: true })).toBeVisible();
    await expect(host.getByText("乙", { exact: true })).toBeHidden();
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .setEditable(false),
    );
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    await host.getByRole("button", { name: "展开列表项：甲" }).click();
    await expect(host.getByText("乙", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(before);
    await host.getByText("甲", { exact: true }).hover();
    await host.getByRole("button", { name: "折叠列表项：甲" }).click();
    await expect(host.getByText("乙", { exact: true })).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(before);
  });
}

test("dragging a folded parent moves its hidden descendants and undo restores the group", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  await page.waitForFunction(() => window.listFoldFramework?.controller);
  const host = page.locator("#list-fold-framework");
  const parent = host.getByText("甲", { exact: true });
  await parent.hover();
  await host.getByRole("button", { name: "折叠列表项：甲" }).click();
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  const from = await handle.boundingBox(),
    target = await host.getByText("丙", { exact: true }).boundingBox();
  if (!from || !target) throw new Error("Missing drag bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 10 });
  await page.mouse.up();
  expect(await host.locator(".semlo-editor-prose ol > li").allTextContents()).toEqual(["丙", "甲", "乙"]);
  await expect(host.getByText("乙", { exact: true })).toBeHidden();
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("pointer can move diagonally from block conversion to a title option", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  await page.locator("#list-fold-framework").getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  const convert = page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" });
  await convert.hover();
  const title = page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true });
  const from = await convert.boundingBox(),
    to = await title.boundingBox();
  if (!from || !to) throw new Error("Missing menu bounds");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await expect(title).toBeVisible();
  await title.click();
  await expect(page.locator("#list-fold-framework .semlo-editor-prose h3")).toHaveCount(2);
});

test("block submenus still switch and close when hovering other menu rows", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  await page.locator("#list-fold-framework").getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  const menu = page.getByRole("menu", { name: "块操作" });
  await menu.getByRole("menuitem", { name: "转化为" }).hover();
  await expect(page.getByRole("menu", { name: "转化为" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "缩进", exact: true }).hover();
  await expect(page.getByRole("menu", { name: "缩进", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "删除", exact: true }).hover();
  await expect(page.getByRole("menu", { name: "缩进", exact: true })).toHaveCount(0);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework}: pointer can reach a block submenu on a restarted list`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    await page.evaluate((kind) => window.__semloRequireFixture("listFoldFramework").mount(kind), framework);
    await page.waitForFunction(() => window.listFoldFramework?.controller);
    await page.evaluate(() => {
      const item = (text: string, level: number, restart = false) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .setContent({
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { semloEditorOrderedStyle: "decimal" },
              content: [item("甲", 0), item("乙", 1), item("丙", 1, true), item("丁", 1)],
            },
          ],
        });
    });
    await page.locator("#list-fold-framework").getByText("丙", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    const convert = page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" });
    await convert.hover();
    const title = page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true });
    const from = await convert.boundingBox(),
      to = await title.boundingBox();
    if (!from || !to) throw new Error("Missing menu bounds");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
    await expect(title).toBeVisible();
    await title.click();
    await expect(page.locator("#list-fold-framework .semlo-editor-prose h3")).toContainText("丙");
  });
}

test("dragging a folded list group across lists keeps its children and target numbering", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, folded = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListFolded: folded },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 7, semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0, true), item("乙", 1)],
          },
          { type: "paragraph", content: [{ type: "text", text: "分隔" }] },
          { type: "orderedList", attrs: { semloEditorOrderedStyle: "decimal" }, content: [item("丙", 0)] },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox(),
    target = await host.getByText("丙", { exact: true }).boundingBox();
  if (!from || !target) throw new Error("Missing drag bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 10 });
  await page.mouse.up();
  expect(await host.locator(".semlo-editor-prose ol > li").allTextContents()).toEqual(["丙", "甲", "乙"]);
  await expect(host.getByText("乙", { exact: true })).toBeHidden();
  await expect(host.getByText("甲", { exact: true }).locator("..", {})).toHaveCSS("list-style-type", '"2. "');
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("dragging a group with unverified restart migration leaves the document unchanged", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1, true), item("丙", 0)],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await host.getByText("甲", { exact: true }).hover();
  const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
  const target = await host.getByText("丙", { exact: true }).boundingBox();
  if (!from || !target) throw new Error("Missing drag bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 10 });
  await page.mouse.up();
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("deleting a folded parent removes its descendants and undo restores them", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  await parent.hover();
  await host.getByRole("button", { name: "折叠列表项：甲" }).click();
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  expect(await host.locator(".semlo-editor-prose ol > li").allTextContents()).toEqual(["丙"]);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
  await expect(host.getByText("乙", { exact: true })).toBeHidden();
});

test("narrow viewport keeps the fold button and block handle separately usable with keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  await parent.hover();
  const toggle = host.getByRole("button", { name: "折叠列表项：甲" });
  const a = await toggle.boundingBox(),
    b = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
  if (!a || !b) throw new Error("Missing control bounds");
  expect(a.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(a.x);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(host.getByText("乙", { exact: true })).toBeHidden();
  const expanded = host.getByRole("button", { name: "展开列表项：甲" });
  await expect(expanded).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(host.getByText("乙", { exact: true })).toBeVisible();
});

test("task list folding preserves completion and can be toggled by pointer", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, checked: boolean) => ({
      type: "taskItem",
      attrs: { checked, semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          { type: "taskList", content: [item("任务甲", 0, true), item("任务乙", 1, false), item("任务丙", 0, true)] },
        ],
      });
  });
  const host = page.locator("#list-fold-framework");
  await host.getByText("任务甲", { exact: true }).hover();
  await host.getByRole("button", { name: "折叠列表项：任务甲" }).click();
  await expect(host.getByText("任务乙", { exact: true })).toBeHidden();
  await expect(host.getByText("任务丙", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .getSnapshot(),
  );
  expect(saved.json.content?.[0].content?.[0]).toMatchObject({ attrs: { checked: true, semloEditorListFolded: true } });
  expect(saved.json.content?.[0].content?.[1]).toMatchObject({ attrs: { checked: false } });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  await expect(host.getByText("任务乙", { exact: true })).toBeVisible();
});

test("wrapping a folded parent in a quote retains its hidden descendants", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  await parent.hover();
  await host.getByRole("button", { name: "折叠列表项：甲" }).click();
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menuitem", { name: "引用" }).click();
  const quote = host.locator(".semlo-editor-prose blockquote");
  expect(await quote.locator("li").allTextContents()).toEqual(["甲", "乙"]);
  await expect(quote.getByText("乙", { exact: true })).toBeHidden();
  await quote.getByRole("button", { name: "展开列表项：甲" }).click();
  await expect(quote.getByText("乙", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

for (const [label, type] of [
  ["高亮块", "callout"],
  ["分栏", "semloEditorColumns"],
  ["折叠块", "details"],
] as const) {
  test(`folded parent converted to ${label} retains the complete list group`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
    const host = page.locator("#list-fold-framework"),
      parent = host.getByText("甲", { exact: true });
    await parent.hover();
    await host.getByRole("button", { name: "折叠列表项：甲" }).click();
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    await parent.hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: label, exact: true }).click();
    const snapshot = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    const wrapper = snapshot.content?.find((node) => node.type === type);
    const inner =
      type === "semloEditorColumns"
        ? wrapper?.content?.[0].content?.[0]
        : type === "details"
          ? wrapper?.content?.[1].content?.[0]
          : wrapper?.content?.[0];
    expect(inner?.content).toHaveLength(2);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .editor.commands.undo(),
    );
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(before);
  });
}

for (const folded of [false, true]) {
  test(`block menu converts ${folded ? "folded" : "expanded"} flat parent and child to H3 in one undo`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
    const host = page.locator("#list-fold-framework"),
      parent = host.getByText("甲", { exact: true });
    if (folded) {
      await parent.hover();
      await host.getByRole("button", { name: "折叠列表项：甲" }).click();
    }
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    await parent.hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true }).click();
    await expect(host.locator(".semlo-editor-prose h3")).toHaveText(["1. 甲", "2. 乙"]);
    const cursor = await page.evaluate(() => {
      const selection = window.__semloRequireValue(
        window.__semloRequireFixture("listFoldFramework").controller,
        "listFoldFramework.controller",
      ).editor.state.selection;
      return {
        empty: selection.empty,
        parent: selection.$from.parent.textContent,
        offset: selection.$from.parentOffset,
      };
    });
    expect(cursor).toEqual({ empty: true, parent: "甲", offset: 0 });
    await expect(host.locator(".semlo-editor-prose ol > li")).toHaveText(["丙"]);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .editor.commands.undo(),
    );
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(before);
  });
}

for (const label of ["无序列表", "待办事项"] as const) {
  test(`block menu converts folded parent and child to ${label}, retaining fold and undo`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
    const host = page.locator("#list-fold-framework"),
      parent = host.getByText("甲", { exact: true });
    await parent.hover();
    await host.getByRole("button", { name: "折叠列表项：甲" }).click();
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    await parent.hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: label, exact: true }).click();
    await expect(host.getByText("乙", { exact: true })).toBeHidden();
    const snapshot = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    const target = snapshot.content?.find((node) => node.type === (label === "无序列表" ? "bulletList" : "taskList"));
    expect(target?.content).toHaveLength(2);
    expect(target?.content?.[0]).toMatchObject({ attrs: { semloEditorListFolded: true } });
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .editor.commands.undo(),
    );
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(before);
  });
}

test("wrapping an expanded parent in a quote includes its descendants", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await expect(host.locator(".semlo-editor-prose li.semlo-editor-block-actions-selected")).toHaveText(["甲", "乙"]);
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "引用", exact: true }).click();
  const quote = host.locator(".semlo-editor-prose blockquote");
  expect(await quote.locator("li").allTextContents()).toEqual(["甲", "乙"]);
  await expect(quote.getByText("乙", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("deleting an expanded parent removes its children and undo restores them", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  expect(await host.locator(".semlo-editor-prose ol > li").allTextContents()).toEqual(["丙"]);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("dragging an expanded parent moves its descendants", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  const from = await page.locator(".semlo-editor-block-handle:visible").boundingBox(),
    target = await host.getByText("丙", { exact: true }).boundingBox();
  if (!from || !target) throw new Error("Missing drag bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 10 });
  await page.mouse.up();
  expect(await host.locator(".semlo-editor-prose ol > li").allTextContents()).toEqual(["丙", "甲", "乙"]);
  await expect(host.getByText("乙", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("decimal list group converts to one code block with its displayed markers", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    parent = host.getByText("甲", { exact: true });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await parent.hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const after = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  const code = after.content?.find((node) => node.type === "codeBlock");
  expect(code?.content).toEqual([{ type: "text", text: "7. 甲\n  7.1. 乙" }]);
  await expect(host.locator(".semlo-editor-prose ol > li")).toHaveText(["丙"]);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

for (const label of ["甲", "乙"]) {
  test(`converting single default ordered item ${label} to code omits the list marker`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.listFoldFramework);
    await page.evaluate(() => {
      window.__semloRequireFixture("listFoldFramework").mount("core");
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .setContent("<ol><li><p>甲</p></li><li><p>乙</p></li><li><p>丙</p></li></ol>");
    });
    const before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    await page.locator("#list-fold-framework").getByText(label, { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
    const snapshot = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
    expect(snapshot.content?.find((node) => node.type === "codeBlock")?.content).toEqual([
      { type: "text", text: label },
    ]);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .editor.commands.undo(),
    );
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(before);
  });
}

test("converting an empty default ordered item to code preserves an editable empty block", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent("<ol><li><p></p></li></ol>");
  });
  await page.locator("#list-fold-framework .semlo-editor-prose ol > li p").hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const json = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(json.content?.[0].type).toBe("codeBlock");
  expect(json.content?.[0].content ?? []).toEqual([]);
});

test("code conversion retains restarted nested markers and undo restores the group", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 1, true), item("丁", 1), item("戊", 0)],
          },
        ],
      });
  });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await page.locator("#list-fold-framework").getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const after = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(after.content?.find((node) => node.type === "codeBlock")?.content).toEqual([
    { type: "text", text: "1. 甲\n  1.1. 乙\n  1.1. 丙\n  1.2. 丁" },
  ]);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("deleting the only list group leaves an editable empty document and undo restores it", async ({ page }) => {
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
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [{ type: "bulletList", content: [item("甲", 0), item("乙", 1)] }],
      });
  });
  const host = page.locator("#list-fold-framework");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose > p")).toHaveCount(1);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("cutting a parent copies its descendants before deleting them", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
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
          const html = await items[0].data["text/html"].text(),
            text = await items[0].data["text/plain"].text();
          document.body.dataset.listCutHtml = html;
          document.body.dataset.listCutText = text;
        },
      },
    });
  });
  const host = page.locator("#list-fold-framework");
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "剪切", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose ol > li")).toHaveText(["丙"]);
  const copied = await page.evaluate(() => ({
    html: document.body.dataset.listCutHtml,
    text: document.body.dataset.listCutText,
  }));
  expect(copied.html).toContain("甲");
  expect(copied.html).toContain("乙");
  expect(copied.text).toBe("甲\n乙");
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("copying a parent preserves the restart attribute of its descendants", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 1, true), item("丁", 1)],
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
          document.body.dataset.listCopyHtml = await items[0].data["text/html"].text();
        },
      },
    });
  });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await page.locator("#list-fold-framework").getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "复制", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.listCopyHtml !== undefined);
  const html = await page.evaluate(() => document.body.dataset.listCopyHtml);
  expect(html).toContain('data-semlo-editor-list-restart="true"');
  expect(html).toContain("丙");
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("deleting a restarted sibling transfers its restart boundary and undo restores it", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 1, true), item("丁", 1)],
          },
        ],
      });
  });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await page.locator("#list-fold-framework").getByText("丙", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  const items = page.locator("#list-fold-framework .semlo-editor-prose ol > li");
  await expect(items).toHaveText(["甲", "乙", "丁"]);
  await expect(items.nth(2)).toHaveCSS("list-style-type", '"1.1. "');
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.redo(),
  );
  await expect(items).toHaveText(["甲", "乙", "丁"]);
  await expect(items.nth(2)).toHaveCSS("list-style-type", '"1.1. "');
});

test("deleting an unverified deeper restart reports the limitation without changing content", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 3, true), item("丁", 3)],
          },
        ],
      });
  });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await page.locator("#list-fold-framework").getByText("丙", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法安全删除");
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("deleting a third-level restarted item transfers its boundary", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("己", 1), item("丙", 2), item("丁", 2, true), item("戊", 2)],
          },
        ],
      });
  });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await page.locator("#list-fold-framework").getByText("丁", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  const items = page.locator("#list-fold-framework .semlo-editor-prose ol > li");
  await expect(items).toHaveText(["甲", "乙", "己", "丙", "戊"]);
  await expect(items.nth(4)).toHaveCSS("list-style-type", '"1.2.1. "');
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("cutting a restarted item copies its marker and transfers the boundary", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 1, true), item("丁", 1)],
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
          document.body.dataset.listCopyHtml = await items[0].data["text/html"].text();
        },
      },
    });
  });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await page.locator("#list-fold-framework").getByText("丙", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "剪切", exact: true }).click();
  const items = page.locator("#list-fold-framework .semlo-editor-prose ol > li");
  await expect(items).toHaveText(["甲", "乙", "丁"]);
  expect(await page.evaluate(() => document.body.dataset.listCopyHtml)).toContain(
    'data-semlo-editor-list-restart="true"',
  );
  await expect(items.nth(2)).toHaveCSS("list-style-type", '"1.1. "');
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("unsupported seeded list conversion preserves document and reports why", async ({ page }) => {
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
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal", semloEditorListLevelStarts: { "1": 4 } },
            content: [item("甲", 0), item("乙", 1), item("丙", 0)],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "无序列表", exact: true }).click();
  await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法无损转换");
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("block menu turns a parent and child into paragraphs without changing neighbours", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => window.__semloRequireFixture("listFoldFramework").mount("core"));
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();
  const snapshot = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(snapshot.content?.map((node) => node.type)).toEqual(["heading", "paragraph", "paragraph", "orderedList"]);
  expect(snapshot.content?.[2]).toMatchObject({ attrs: { semloEditorIndent: 1 } });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("block list conversion restores the original caret on undo", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const controller = window.__semloRequireValue(
      window.__semloRequireFixture("listFoldFramework").controller,
      "listFoldFramework.controller",
    );
    controller.setContent({
      type: "doc",
      content: [{ type: "bulletList", content: [item("甲甲", 0), item("乙乙", 1)] }],
    });
    let position = -1;
    controller.editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "甲甲") position = pos + 2;
    });
    controller.editor.view.focus();
    controller.editor.commands.setTextSelection(position);
  });
  await page.locator("#list-fold-framework").getByText("甲甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "待办事项", exact: true }).click();
  const selection = () =>
    page.evaluate(() => {
      const selected = window.__semloRequireValue(
        window.__semloRequireFixture("listFoldFramework").controller,
        "listFoldFramework.controller",
      ).editor.state.selection;
      return {
        text: selected.$from.parent.textContent,
        from: selected.$from.parentOffset,
        to: selected.$to.parentOffset,
      };
    });
  expect(await selection()).toEqual({ text: "甲甲", from: 0, to: 0 });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(await selection()).toEqual({ text: "甲甲", from: 1, to: 1 });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.redo(),
  );
  expect(await selection()).toEqual({ text: "甲甲", from: 0, to: 0 });
});

test("block heading conversion restores the original caret on undo", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const controller = window.__semloRequireValue(
      window.__semloRequireFixture("listFoldFramework").controller,
      "listFoldFramework.controller",
    );
    controller.setContent({
      type: "doc",
      content: [{ type: "bulletList", content: [item("甲甲", 0), item("乙乙", 1)] }],
    });
    let position = -1;
    controller.editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "甲甲") position = pos + 2;
    });
    controller.editor.view.focus();
    controller.editor.commands.setTextSelection(position);
  });
  await page.locator("#list-fold-framework").getByText("甲甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true }).click();
  const selection = () =>
    page.evaluate(() => {
      const selected = window.__semloRequireValue(
        window.__semloRequireFixture("listFoldFramework").controller,
        "listFoldFramework.controller",
      ).editor.state.selection;
      return {
        text: selected.$from.parent.textContent,
        from: selected.$from.parentOffset,
        to: selected.$to.parentOffset,
      };
    });
  expect(await selection()).toEqual({ text: "甲甲", from: 0, to: 0 });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(await selection()).toEqual({ text: "甲甲", from: 1, to: 1 });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.redo(),
  );
  expect(await selection()).toEqual({ text: "甲甲", from: 0, to: 0 });
});

test("block menu converts a formatted parent group to paragraphs without removing text marks", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, mark: string) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: mark }] }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0, "bold"), item("乙", 1, "italic"), item("丙", 0, "bold")],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();
  const snapshot = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(snapshot.content?.[0].content?.[0]).toMatchObject({ text: "甲", marks: [{ type: "bold" }] });
  expect(snapshot.content?.[1].content?.[0]).toMatchObject({ text: "乙", marks: [{ type: "italic" }] });
  const cursor = await page.evaluate(() => {
    const selection = window.__semloRequireValue(
      window.__semloRequireFixture("listFoldFramework").controller,
      "listFoldFramework.controller",
    ).editor.state.selection;
    return { empty: selection.empty, parent: selection.$from.parent.textContent, offset: selection.$from.parentOffset };
  });
  expect(cursor).toEqual({ empty: true, parent: "甲", offset: 0 });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("decimal list code conversion removes observed bold and italic styling but undo restores it", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    const item = (text: string, level: number, mark: string) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: mark }] }] }],
    });
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0, "bold"), item("乙", 1, "italic")],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const snapshot = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(snapshot.content?.[0]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text: "1. 甲\n  1.1. 乙" }],
  });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("list items left after a parent group becomes code are renumbered", async ({ page }) => {
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
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 0)],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework");
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const items = host.locator(".semlo-editor-prose ol > li");
  await expect(items).toHaveText(["丙", "丁"]);
  await expect(items.nth(0)).toHaveCSS("list-style-type", '"1. "');
  await expect(items.nth(1)).toHaveCSS("list-style-type", '"2. "');
});

test("mixed two-level list converts its numeric and alphabetic markers to code", async ({ page }) => {
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
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [{ type: "orderedList", content: [item("甲", 0), item("乙", 1), item("丙", 0)] }],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const snapshot = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(snapshot.content?.[0]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text: "1. 甲\n  a. 乙" }],
  });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("real editor folds and restores a physically nested HTML list", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent("<ul><li><p>父</p><ul><li><p>子</p></li></ul></li><li><p>邻</p></li></ul>");
  });
  const host = page.locator("#list-fold-framework");
  await host.getByText("父", { exact: true }).hover();
  await host.getByRole("button", { name: "折叠列表项：父" }).click();
  await expect(host.getByText("子", { exact: true })).toBeHidden();
  await expect(host.getByText("邻", { exact: true })).toBeVisible();
  const snapshot = await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .getSnapshot(),
  );
  await page.evaluate(
    (html) =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .setContent(html),
    snapshot.html,
  );
  await expect(host.getByText("子", { exact: true })).toBeHidden();
  await host.getByRole("button", { name: "展开列表项：父" }).click();
  await expect(host.getByText("子", { exact: true })).toBeVisible();
});

test("Chinese two-level list converts its displayed markers to code", async ({ page }) => {
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
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "chinese" },
            content: [item("甲", 0), item("乙", 1)],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }).click();
  const snapshot = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  expect(snapshot.content?.[0]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text: "一、 甲\n  (一) 乙" }],
  });
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("list to code refuses unobserved paragraph attributes without modifying the document", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { semloEditorLineHeight: "1.5" },
                    content: [{ type: "text", text: "甲" }],
                  },
                ],
              },
            ],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await expect(
    page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "代码块", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("real editor numbering menu coexists with block handle and protects read-only content", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent("<ol><li><p>甲</p></li><li><p>乙</p></li><li><p>丙</p></li></ol>");
  });
  const host = page.locator("#list-fold-framework"),
    second = host.getByText("乙", { exact: true });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("listFoldFramework").controller,
          "listFoldFramework.controller",
        )
        .getSnapshot().json,
  );
  await second.hover();
  const trigger = host.getByRole("button", { name: "设置列表编号：乙" });
  const marker = await trigger.boundingBox(),
    handle = await page.locator(".semlo-editor-block-handle:visible").boundingBox();
  if (!marker || !handle) throw new Error("Missing marker or handle");
  expect(handle.x + handle.width).toBeLessThanOrEqual(marker.x);
  await trigger.click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "重新编号" }).click();
  await expect(host.locator(".semlo-editor-prose > ol")).toHaveCount(2);
  const saved = await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .getSnapshot(),
  );
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.undo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .editor.commands.redo(),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(saved.json);
  for (const content of [saved.html, saved.json]) {
    await page.evaluate(
      (value) =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .setContent(value),
      content,
    );
    await expect(host.locator(".semlo-editor-prose > ol")).toHaveCount(2);
  }
  await host.getByRole("button", { name: "设置列表编号：乙" }).click();
  await expect(page.getByRole("menu", { name: "设置列表编号" })).toBeVisible();
  await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setEditable(false),
  );
  await expect(page.getByRole("menu", { name: "设置列表编号" })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "设置列表编号：乙" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(saved.json);
});

test("unsupported paragraph indentation conversion keeps the menu and reports the failure", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent({
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", attrs: { semloEditorIndent: 1 }, content: [{ type: "text", text: "甲" }] },
                ],
              },
            ],
          },
        ],
      });
  });
  const host = page.locator("#list-fold-framework"),
    before = await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    );
  await host.getByText("甲", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();
  await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法无损转换");
  expect(
    await page.evaluate(
      () =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .getSnapshot().json,
    ),
  ).toEqual(before);
});

test("ordered list marker control does not intercept Home and typing", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent("<ol><li><p>甲乙</p></li><li><p>丙</p></li></ol>");
  });
  const host = page.locator("#list-fold-framework");
  await host.getByText("甲乙", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("a");
  await expect(host.locator(".semlo-editor-prose li").first()).toHaveText("a甲乙");
});

test("editor snapshots omit default restart but retain explicit restart through JSON and HTML", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.listFoldFramework);
  await page.evaluate(() => {
    window.__semloRequireFixture("listFoldFramework").mount("core");
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .setContent('<ol><li><p>甲</p></li><li data-semlo-editor-list-restart="true"><p>乙</p></li></ol>');
  });
  const saved = await page.evaluate(() =>
    window
      .__semloRequireValue(window.__semloRequireFixture("listFoldFramework").controller, "listFoldFramework.controller")
      .getSnapshot(),
  );
  const items = saved.json.content?.[0].content;
  expect(items?.[0].attrs).not.toHaveProperty("semloEditorListRestart");
  expect(items?.[1]).toMatchObject({ attrs: { semloEditorListRestart: true } });
  for (const content of [saved.json, saved.html]) {
    await page.evaluate(
      (value) =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("listFoldFramework").controller,
            "listFoldFramework.controller",
          )
          .setContent(value),
      content,
    );
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("listFoldFramework").controller,
              "listFoldFramework.controller",
            )
            .getSnapshot().json,
      ),
    ).toEqual(saved.json);
  }
});
