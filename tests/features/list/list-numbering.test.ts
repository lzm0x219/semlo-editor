import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/list/list-fold-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let origin = "",
  stop = async () => {};
test.beforeAll(async () => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/list/list-fold-fixture.ts", { publicDir: false });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = async () => {
    await server.close();
  };
});
test.afterAll(async () => {
  await stop();
});
test("restart and continue numbering are separately undoable and serialize", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")(
      "<ol><li><p>甲</p></li><li><p>乙</p></li><li><p>丙</p></li></ol>",
    ),
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  await page.getByRole("button", { name: "设置列表编号：乙" }).click();
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  await expect(page.locator("ol")).toHaveCount(2);
  expect(
    await page
      .locator("ol")
      .nth(1)
      .evaluate((element) => (element as HTMLOListElement).start),
  ).toBe(1);
  const saved = await page.evaluate(() => ({
    html: window.__semloRequireFixture("listFoldEditor").getHTML(),
    json: window.__semloRequireFixture("listFoldEditor").getJSON(),
  }));
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(before);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.redo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(saved.json);
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("createListFoldEditor")(value), content);
    await page.getByRole("button", { name: "设置列表编号：乙" }).click();
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    await expect(page.locator("ol")).toHaveCount(1);
    await expect(page.locator("ol > li")).toHaveText(["甲", "乙", "丙"]);
  }
});

test("numbering menu opens style choices and applies selection to the targeted list", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")("<ol><li><p>甲</p></li><li><p>乙</p></li></ol>"),
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  await page.getByRole("button", { name: "设置列表编号：乙" }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "修改样式" }).click();
  await page.getByRole("menu", { name: "有序列表样式" }).getByRole("menuitemradio", { name: "中文数字" }).click();
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).content?.[0],
  ).toMatchObject({
    attrs: { semloEditorOrderedStyle: "chinese" },
  });
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(before);
});

test("first item at one can switch its persistent numbering mode", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")("<ol><li><p>甲</p></li><li><p>乙</p></li></ol>"),
  );
  await page.getByRole("button", { name: "设置列表编号：甲" }).click();
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "修改样式" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "继续编号" }).click();
  await page.getByRole("button", { name: "设置列表编号：甲" }).click();
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeDisabled();
});

test("numbering menu supports keyboard focus, navigation and escape", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")("<ol><li><p>甲</p></li><li><p>乙</p></li></ol>"),
  );
  const trigger = page.getByRole("button", { name: "设置列表编号：乙" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "修改样式" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("restarting a nested sibling keeps the parent group intact and can be continued", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() => {
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireFixture("createListFoldEditor")({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("甲", 0), item("乙", 1), item("丙", 1), item("丁", 1)],
        },
      ],
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  await page.getByRole("button", { name: "设置列表编号：丙" }).click();
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  await expect(page.locator("ol")).toHaveCount(1);
  const restarted = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  expect(restarted.content?.[0].content?.[2]).toMatchObject({ attrs: { semloEditorListRestart: true } });
  expect(
    await page
      .locator("ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).style.listStyleType)),
  ).toEqual(['"1. "', '"1.1. "', '"1.1. "', '"1.2. "']);
  await page.getByRole("button", { name: /折叠.*甲/ }).click();
  await expect(page.getByText("乙", { exact: true })).toBeHidden();
  await expect(page.getByText("丙", { exact: true })).toBeHidden();
  await expect(page.getByText("丁", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: /展开.*甲/ }).click();
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(before);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.redo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(restarted);
  await page.getByRole("button", { name: "设置列表编号：丙" }).click();
  await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "继续编号" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(before);
});

test("multi-level restart stays unavailable while group operations are being verified", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }],
            },
          ],
        },
      ],
    }),
  );
  await expect(page.getByRole("button", { name: "设置列表编号：乙" })).toHaveCount(0);
});

test("per-item restart attribute survives JSON and HTML without splitting the list", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")(
      '<ol><li><p>甲</p></li><li data-semlo-editor-list-restart="true"><p>乙</p></li></ol>',
    ),
  );
  const saved = await page.evaluate(() => ({
    json: window.__semloRequireFixture("listFoldEditor").getJSON(),
    html: window.__semloRequireFixture("listFoldEditor").getHTML(),
  }));
  expect(saved.json.content?.[0].content?.[1]).toMatchObject({ attrs: { semloEditorListRestart: true } });
  expect(saved.html).toContain('data-semlo-editor-list-restart="true"');
  await page.evaluate((value) => window.__semloRequireFixture("createListFoldEditor")(value), saved.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(saved.json);
});

for (const [style, expected] of [
  ["decimal", ['"1. "', '"1.1. "', '"1.1. "', '"1.2. "']],
  ["chinese", ['"一、 "', '"(一) "', '"(一) "', '"(二) "']],
] as const) {
  test(`${style} markers reflect a nested restart`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.createListFoldEditor);
    await page.evaluate((orderedStyle) => {
      const item = (text: string, level: number, restart = false) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.__semloRequireFixture("createListFoldEditor")({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: orderedStyle },
            content: [item("甲", 0), item("乙", 1), item("丙", 1, true), item("丁", 1)],
          },
        ],
      });
    }, style);
    expect(
      await page
        .locator("ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLElement).style.listStyleType)),
    ).toEqual(expected);
  });
}

test("a new sibling after a restarted item does not inherit its restart marker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")(
      '<ol><li><p>甲</p></li><li data-semlo-editor-list-restart="true"><p>乙</p></li></ol>',
    ),
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listFoldEditor");
    let position = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "listItem" && node.textContent === "乙") position = pos + 2 + node.textContent.length;
    });
    editor.commands.focus();
    editor.commands.setTextSelection(position);
  });
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("listFoldEditor").state.selection.$from.parent.textContent === "乙" &&
      window.__semloRequireFixture("listFoldEditor").view.hasFocus(),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("丙");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  expect(snapshot.content?.[0].content?.[1]).toMatchObject({ attrs: { semloEditorListRestart: true } });
  expect(snapshot.content?.[0].content?.[2]).toMatchObject({ attrs: { semloEditorListRestart: false } });
});

test("restarting a non-default first value resets to one and undo restores the value", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")('<ol start="7"><li><p>甲</p></li><li><p>乙</p></li></ol>'),
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  await page.getByRole("button", { name: "设置列表编号：甲" }).click();
  await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "重新编号" }).click();
  expect(await page.locator("ol").evaluate((element) => (element as HTMLOListElement).start)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(before);
});

test("a direct child can restart decimal numbering while preserving its parent and following child", async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() => {
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireFixture("createListFoldEditor")({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("戊", 0), item("己", 1), item("庚", 1)],
        },
      ],
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  const markers = () =>
    page.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLElement).style.listStyleType));
  expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.2. "']);
  await page.getByRole("button", { name: "设置列表编号：庚" }).click();
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.1. "']);
  const restarted = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  expect(restarted.content?.[0].content?.[2]).toMatchObject({ attrs: { semloEditorListRestart: true } });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("listFoldEditor");
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "庚") end = pos + node.nodeSize;
    });
    editor.commands.focus();
    editor.commands.setTextSelection(end);
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("辛");
  expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.1. "', '"1.2. "']);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(restarted);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(before);
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.redo());
  expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(restarted);
  const html = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getHTML());
  for (const content of [restarted, html]) {
    await page.evaluate((value) => window.__semloRequireFixture("createListFoldEditor")(value), content);
    expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.1. "']);
    await page.getByRole("button", { name: "设置列表编号：庚" }).click();
    await expect(menu.getByRole("menuitem", { name: "重新编号" })).toBeDisabled();
    await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeEnabled();
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.2. "']);
    await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
    expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(restarted);
  }
});

test("nested numbering stays unavailable for unverified list shapes", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  for (const specimen of [
    { levels: [0, 1, 0, 1], style: "decimal", start: 1, restarts: [] },
    { levels: [0, 1, 2, 1], style: "decimal", start: 1, restarts: [] },
    { levels: [0, 1, 1], style: "mixed", start: 1, restarts: [] },
    { levels: [0, 1, 1], style: "decimal", start: 5, restarts: [] },
    { levels: [0, 1, 1, 1, 1], style: "decimal", start: 1, restarts: [2, 3, 4] },
  ]) {
    await page.evaluate(({ levels, style, start, restarts }) => {
      window.__semloRequireFixture("createListFoldEditor")({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { semloEditorOrderedStyle: style, start },
            content: levels.map((level, index) => ({
              type: "listItem",
              attrs: { semloEditorListIndent: level, semloEditorListRestart: restarts.includes(index) },
              content: [{ type: "paragraph", content: [{ type: "text", text: `item${index}` }] }],
            })),
          },
        ],
      });
    }, specimen);
    await expect(page.getByRole("button", { name: /设置列表编号/ })).toHaveCount(0);
  }
});

test("continuing one of two restarted children preserves the other boundary", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() => {
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireFixture("createListFoldEditor")({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("Parent", 0), item("A", 1), item("B", 1), item("C", 1), item("D", 1), item("E", 1)],
        },
      ],
    });
  });
  const markers = () =>
    page.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLElement).style.listStyleType));
  const menu = page.getByRole("menu", { name: "设置列表编号" });
  await page.getByRole("button", { name: "设置列表编号：B", exact: true }).click();
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  await page.getByRole("button", { name: "设置列表编号：D", exact: true }).click({ timeout: 3000 });
  await menu.getByRole("menuitem", { name: "重新编号" }).click();
  expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.1. "', '"1.2. "', '"1.1. "', '"1.2. "']);
  const restarted = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
  const html = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getHTML());
  for (const content of [restarted, html]) {
    await page.evaluate((value) => window.__semloRequireFixture("createListFoldEditor")(value), content);
    await page.getByRole("button", { name: "设置列表编号：B", exact: true }).click();
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    expect(await markers()).toEqual(['"1. "', '"1.1. "', '"1.2. "', '"1.3. "', '"1.1. "', '"1.2. "']);
    const changed = await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON());
    const later = changed.content?.[0].content?.[4];
    expect(later && "attrs" in later ? later.attrs?.semloEditorListRestart : undefined).toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
    expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(restarted);
    await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.redo());
    expect(await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").getJSON())).toEqual(changed);
  }
});
