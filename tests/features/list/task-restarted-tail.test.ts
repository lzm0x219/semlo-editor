import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/list/task-item-conversion-fixture";

let origin = "",
  stop = async () => {};
test.beforeAll(async () => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/list/task-item-conversion-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
test.beforeEach(async ({ page }) => installFixtureGuards(page));
test.afterAll(async () => stop());

test("convert the last restarted direct child to an unchecked task and undo", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("Parent", 0), item("A", 1), item("B", 1), item("C", 1), item("D", 1, true)],
          },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("D", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "D",
  );
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  expect(after.json.content?.map((node) => node.type)).toEqual(["paragraph", "orderedList", "taskList", "paragraph"]);
  expect(after.json.content?.[2].content?.[0]).toMatchObject({
    type: "taskItem",
    attrs: { checked: false, semloEditorListIndent: 1 },
  });
  expect(after.json.content?.[2].content?.[0].attrs?.semloEditorListRestart).not.toBe(true);
  await expect(page.locator(".semlo-editor-prose ol > li")).toHaveText(["Parent", "A", "B", "C"]);
  await expect(page.locator(".semlo-editor-prose ol > li").nth(3)).toHaveCSS("list-style-type", '"1.3. "');
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText(["Before", "After"]);
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    after.json,
  );
  for (const content of [after.json, after.html]) {
    await page.evaluate((value) => window.__semloRequireFixture("taskConversionEditor").setContent(value), content);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      after.json,
    );
  }
});

test("unverified restarted list shapes remain unchanged on task conversion", async ({ page }) => {
  for (const specimen of [
    { levels: [0, 1, 0, 1, 1], restarts: [4], style: "decimal" },
    { levels: [0, 1, 1, 1], restarts: [2, 3], style: "decimal" },
    { levels: [0, 1, 1], restarts: [2], style: "mixed" },
  ]) {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(({ levels, restarts, style }) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { semloEditorOrderedStyle: style },
              content: levels.map((level, index) => ({
                type: "listItem",
                attrs: { semloEditorListIndent: level, semloEditorListRestart: restarts.includes(index) },
                content: [{ type: "paragraph", content: [{ type: "text", text: `item${index}` }] }],
              })),
            },
          ],
        },
      });
    }, specimen);
    const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    await page.getByText(`item${specimen.levels.length - 1}`, { exact: true }).click();
    await page.getByRole("button", { name: "待办事项", exact: true }).click();
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      before,
    );
  }
});

test("converting a restarted child transfers its boundary to its only following sibling", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("Parent", 0), item("A", 1), item("B", 1), item("C", 1), item("D", 1, true), item("E", 1)],
          },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("D", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "D",
  );
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "taskList", "orderedList"]);
  expect(after.json.content?.[1].content?.[0]).toMatchObject({
    type: "taskItem",
    attrs: { checked: false, semloEditorListIndent: 1 },
  });
  expect(after.json.content?.[2].content?.[0]).toMatchObject({ attrs: { semloEditorListRestart: true } });
  await expect(page.locator(".semlo-editor-prose ol").first().locator("> li")).toHaveText(["Parent", "A", "B", "C"]);
  await expect(page.locator(".semlo-editor-prose ol").last().locator("> li")).toHaveText(["E"]);
  await expect(page.locator(".semlo-editor-prose ol").last().locator("> li")).toHaveCSS("list-style-type", '"1.1. "');
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    after.json,
  );
  for (const content of [after.json, after.html]) {
    await page.evaluate((value) => window.__semloRequireFixture("taskConversionEditor").setContent(value), content);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      after.json,
    );
    await page.getByRole("button", { name: "设置列表编号：E", exact: true }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    await expect(page.locator(".semlo-editor-prose ol").last().locator("> li")).toHaveCSS("list-style-type", '"1.4. "');
    await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      after.json,
    );
  }
  await page.getByRole("button", { name: "设置列表编号：E", exact: true }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "修改样式" }).click();
  const styles = page.getByRole("menu", { name: "有序列表样式" });
  await expect(styles.getByRole("menuitemradio", { name: "数字、字母和罗马数字" })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(styles.getByRole("menuitemradio", { name: "中文数字" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(styles.getByRole("menuitemradio", { name: "多级数字" })).toBeFocused();
  await styles.getByRole("menuitemradio", { name: "中文数字" }).click();
  await expect(page.locator(".semlo-editor-prose ol").first().locator("> li").nth(3)).toHaveCSS(
    "list-style-type",
    '"1.3. "',
  );
  await expect(page.locator(".semlo-editor-prose ol").last().locator("> li")).toHaveCSS("list-style-type", '"(一) "');
  const chinese = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByRole("button", { name: "设置列表编号：E", exact: true }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "继续编号" }).click();
  await expect(page.locator(".semlo-editor-prose ol").last().locator("> li")).toHaveCSS("list-style-type", '"1.4. "');
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    chinese,
  );
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    after.json,
  );
});

test("linked continuation follows prefix edits and unlinks safely when the task is removed", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("Parent", 0), item("A", 1), item("B", 1, true), item("C", 1)],
          },
        ],
      },
    });
  });
  await page.getByText("B", { exact: true }).click();
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  await page.getByRole("button", { name: "设置列表编号：C", exact: true }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "继续编号" }).click();
  const suffix = page.locator(".semlo-editor-prose ol").last().locator("> li");
  await expect(suffix).toHaveCSS("list-style-type", '"1.2. "');
  await page.locator(".semlo-editor-prose").getByText("A", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Extra");
  await expect(suffix).toHaveCSS("list-style-type", '"1.3. "');
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
  await expect(suffix).toHaveCSS("list-style-type", '"1.2. "');
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo());
  await expect(suffix).toHaveCSS("list-style-type", '"1.3. "');
  const linked = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(linked.content?.map((node) => node.type)).toEqual(["orderedList", "taskList", "orderedList"]);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    let from = -1,
      to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskList") {
        from = pos;
        to = pos + node.nodeSize;
      }
    });
    if (from < 0) throw new Error("Missing task list");
    editor.commands.deleteRange({ from, to });
  });
  const unlinked = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(unlinked.content?.map((node) => node.type)).toEqual(["orderedList", "orderedList"]);
  expect(unlinked.content?.every((node) => !node.attrs?.semloEditorListTaskChain)).toBe(true);
  await expect(suffix).toHaveCSS("list-style-type", '"1.3. "');
  await expect(page.getByRole("button", { name: "设置列表编号：C", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    linked,
  );
  await expect(page.getByRole("button", { name: "设置列表编号：C", exact: true })).toHaveCount(1);
});

test("duplicated chain identifiers never connect unrelated fragments", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: "decimal" },
            content: [item("Parent", 0), item("A", 1), item("B", 1, true), item("C", 1)],
          },
        ],
      },
    });
  });
  await page.locator(".semlo-editor-prose").getByText("B", { exact: true }).click();
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("taskConversionEditor");
    const json = controller.getSnapshot().json;
    controller.setContent({ type: "doc", content: [...(json.content ?? []), ...(json.content ?? [])] });
  });
  const json = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(json.content).toHaveLength(6);
  expect(json.content?.every((node) => !node.attrs?.semloEditorListTaskChain)).toBe(true);
  await expect(page.getByRole("button", { name: "设置列表编号：C", exact: true })).toHaveCount(0);
  await expect(page.locator(".semlo-editor-prose")).toContainText("Parent");
});
