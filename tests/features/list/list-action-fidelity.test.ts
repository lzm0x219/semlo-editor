import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/list/task-item-conversion-fixture";

let origin = "";
let stop = async () => {};

test.beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/list/task-item-conversion-fixture.ts" } },
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
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
test.afterAll(async () => {
  await stop();
});

for (const action of ["bullet", "ordered", "chinese"] as const) {
  test(`selected task converts to ${action} while neighbours and history survive`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const item = (text: string, checked: boolean, indent: number) => ({
        type: "taskItem",
        attrs: { checked, semloEditorListIndent: indent },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [{ type: "taskList", content: [item("甲", true, 0), item("乙", false, 1), item("丙", true, 0)] }],
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText("乙", { exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
    );
    if (action === "bullet") await page.getByRole("button", { name: "无序列表", exact: true }).click();
    else if (action === "ordered") await page.getByRole("button", { name: "有序列表", exact: true }).click();
    else {
      await page.getByRole("button", { name: "有序列表样式", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "中文数字" }).click();
    }
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual([
      "taskList",
      action === "bullet" ? "bulletList" : "orderedList",
      "taskList",
    ]);
    expect(after.json.content?.[0].content?.[0].attrs?.checked).toBe(true);
    expect(after.json.content?.[1].content?.[0].attrs?.semloEditorListIndent).toBe(1);
    expect(after.json.content?.[2].content?.[0].attrs?.checked).toBe(true);
    if (action === "chinese")
      await expect(page.locator(".semlo-editor-prose ol > li")).toHaveCSS("list-style-type", '"(一) "');
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    for (const key of ["json", "html"] as const) {
      const restored = await page.evaluate((value) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(value);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, after[key]);
      expect(restored).toEqual(after.json);
    }
  });
}

test("the ordered button reuses the selected style for a bullet item in the same editor", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "样式来源" }] },
          { type: "paragraph", content: [{ type: "text", text: "分隔" }] },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "目标" }] }] },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "分隔二" }] },
          { type: "paragraph", content: [{ type: "text", text: "目标正文" }] },
        ],
      },
    });
  });
  await page.getByText("样式来源", { exact: true }).click();
  await page.getByRole("button", { name: "有序列表样式", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "中文数字" }).click();
  await page.getByText("目标", { exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "目标",
  );
  await page.getByRole("button", { name: "有序列表", exact: true }).click();
  const result = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(result.content?.[2].attrs?.semloEditorOrderedStyle).toBe("chinese");
  await expect(page.locator(".semlo-editor-prose ol").last().locator("li")).toHaveCSS("list-style-type", '"一、 "');
  await page.getByText("目标正文", { exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent ===
      "目标正文",
  );
  await page.getByRole("button", { name: "有序列表", exact: true }).click();
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).content?.at(-1)
      ?.attrs?.semloEditorOrderedStyle,
  ).toBe("chinese");
});

for (const [start, selectedText, expectedTypes, expectedValues] of [
  [1, "丙", ["orderedList", "bulletList", "orderedList"], ["1", "1", "2", "2"]],
  [7, "甲", ["bulletList", "orderedList"], ["7", "1", "1", "2"]],
] as const) {
  test(`converts mixed-level ordered item ${selectedText} with start ${start}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate((start) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const item = (text: string, indent: number) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: indent },
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
              attrs: { start },
              content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
            },
          ],
        },
      });
    }, start);
    const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    await page.getByText(selectedText, { exact: true }).click();
    await page.waitForFunction(
      (text) =>
        window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === text,
      selectedText,
    );
    await page.getByRole("button", { name: "无序列表", exact: true }).click();
    const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    expect(after.json.content?.map((node) => node.type)).toEqual(expectedTypes);
    expect(
      await page
        .locator(".semlo-editor-prose ol > li")
        .evaluateAll((items) => items.map((item) => item.getAttribute("value"))),
    ).toEqual(expectedValues);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    for (const key of ["json", "html"] as const) {
      const restored = await page.evaluate((value) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(value);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, after[key]);
      expect(restored).toEqual(after.json);
    }
  });
}

for (const source of ["bulletList", "orderedList"] as const) {
  test(`converts only the selected ${source} item to a task`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate((source) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const item = (text: string, indent: number) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: indent },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: source,
              attrs: source === "orderedList" ? { start: 7 } : {},
              content: [item("甲", 0), item("乙", 1), item("丙", 0)],
            },
          ],
        },
      });
    }, source);
    const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    await page.getByText("乙", { exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
    );
    await page.getByRole("button", { name: "待办事项", exact: true }).click();
    const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    expect(after.json.content?.map((node) => node.type)).toEqual([source, "taskList", source]);
    expect(after.json.content?.[1].content?.[0].attrs).toMatchObject({ semloEditorListIndent: 1, checked: false });
    if (source === "orderedList") expect(after.json.content?.[2].attrs?.start).toBe(8);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    for (const key of ["json", "html"] as const) {
      const restored = await page.evaluate((value) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(value);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, after[key]);
      expect(restored).toEqual(after.json);
    }
  });
}

test("converting a decimal ordered item retains the explicit ancestor of following items", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, indent: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: indent },
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
            attrs: { start: 7, semloEditorOrderedStyle: "decimal" },
            content: [item("甲", 0), item("乙", 1), item("丙", 0), item("丁", 1), item("戊", 0)],
          },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("丙", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "丙",
  );
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "bulletList", "orderedList"]);
  expect(after.json.content?.[2].attrs?.semloEditorOrderedAncestorPath).toEqual([7]);
  expect(
    await page
      .locator(".semlo-editor-prose ol > li")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType)),
  ).toEqual(['"7. "', '"7.1. "', '"7.2. "', '"8. "']);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  for (const key of ["json", "html"] as const) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(value);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after[key]);
    expect(restored).toEqual(after.json);
  }
});

test("converts only the selected ordered item and renumbers retained siblings", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string) => ({
      type: "listItem",
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
            attrs: { start: 7, semloEditorOrderedStyle: "chinese" },
            content: [item("甲"), item("乙"), item("丙")],
          },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("乙", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
  );
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "bulletList", "orderedList"]);
  expect(after.json.content?.[2].attrs?.start).toBe(8);
  expect(after.json.content?.[2].attrs?.semloEditorOrderedStyle).toBe("chinese");
  expect(
    await page
      .locator(".semlo-editor-prose ol > li")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType)),
  ).toEqual(['"七、 "', '"八、 "']);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  for (const key of ["json", "html"] as const) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(value);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after[key]);
    expect(restored).toEqual(after.json);
  }
});

test("ordered list conversion preserves a list with unverified restart migration", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: { type: "doc", content: [{ type: "orderedList", content: [item("甲"), item("乙", true), item("丙")] }] },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("乙", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
  );
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("converts only the selected bullet item to ordered", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string, indent: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: indent },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [{ type: "bulletList", content: [item("甲", 0), item("乙", 1), item("丙", 0)] }],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("乙", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
  );
  await page.getByRole("button", { name: "有序列表", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  expect(after.json.content?.map((node) => node.type)).toEqual(["bulletList", "orderedList", "bulletList"]);
  expect(after.json.content?.[1].content?.[0].attrs?.semloEditorListIndent).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  for (const key of ["json", "html"] as const) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(value);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after[key]);
    expect(restored).toEqual(after.json);
  }
});

test("the active task button keeps its existing toggle-off behavior", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [{ type: "paragraph", content: [{ type: "text", text: "任务" }] }],
              },
            ],
          },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("任务", { exact: true }).click();
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(after.content?.map((node) => node.type)).toEqual(["paragraph"]);
  expect(after.content?.[0].content?.[0].text).toBe("任务");
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("toggling off one task leaves adjacent tasks intact", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string) => ({
      type: "taskItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [{ type: "taskList", content: [item("甲"), item("乙"), item("丙")] }],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("乙", { exact: true }).click();
  await page.waitForFunction(
    () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "乙",
  );
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(after.content?.map((node) => node.type)).toEqual(["taskList", "paragraph", "taskList"]);
  expect(after.content?.[1].content?.[0].text).toBe("乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("toggling off an indented task retains its paragraph indentation", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { semloEditorListIndent: 1 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "任务" }] }],
              },
            ],
          },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByText("任务", { exact: true }).click();
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  expect(after.json.content?.[0].type).toBe("paragraph");
  expect(after.json.content?.[0].attrs?.semloEditorIndent).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  for (const key of ["json", "html"] as const) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(content);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after[key]);
    expect(restored).toEqual(after.json);
  }
});

for (const [start, expected] of [
  [99, ['"九十九、 "', '"一百、 "', '"一百零一、 "']],
  [9999, ['"九千九百九十九、 "', '"一万、 "', '"一万零一、 "']],
] as const) {
  test(`Chinese ordered markers cross ${start + 1}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate((start) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const item = (text: string) => ({
        type: "listItem",
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
              attrs: { start, semloEditorOrderedStyle: "chinese" },
              content: [item("甲"), item("乙"), item("丙")],
            },
          ],
        },
      });
    }, start);
    expect(
      await page
        .locator(".semlo-editor-prose li")
        .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType)),
    ).toEqual(expected);
    const saved = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const restored = await page.evaluate((html) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(html);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, saved.html);
    expect(restored).toEqual(saved.json);
  });
}

for (const backwards of [false, true]) {
  test(`converts only selected task items and preserves ${backwards ? "backward" : "forward"} selection`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const item = (text: string, checked: boolean) => ({
        type: "taskItem",
        attrs: { checked },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [{ type: "taskList", content: [item("甲", false), item("乙", false), item("丙", true)] }],
        },
      });
      const editor = window.__semloRequireFixture("taskConversionEditor").editor;
      let from = 0,
        to = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "甲") from = pos + 1;
        if (node.isTextblock && node.textContent === "乙") to = pos + node.nodeSize - 1;
      });
      editor.view.focus();
      window.__semloRequireFixture("taskConversionEditor").editor.commands.setTextSelection({ from, to });
    });
    if (backwards)
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        const { from, to } = editor.state.selection;
        editor.commands.setTextSelection({ from: to, to: from });
      });
    const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    await page.getByRole("button", { name: "无序列表", exact: true }).click();
    const result = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("taskConversionEditor").editor;
      const selection = editor.state.selection;
      return {
        json: window.__semloRequireFixture("taskConversionEditor").getSnapshot().json,
        text: editor.state.doc.textBetween(selection.from, selection.to, "\n"),
        backwards: selection.anchor > selection.head,
      };
    });
    expect(result.json.content?.map((node) => node.type)).toEqual(["bulletList", "taskList"]);
    expect(result.json.content?.[1].content?.[0].attrs?.checked).toBe(true);
    expect(result.text).toBe("甲\n乙");
    expect(result.backwards).toBe(backwards);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}

test("a task selection ending at the third item's start converts that item too", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const item = (text: string) => ({
      type: "taskItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: { type: "doc", content: [{ type: "taskList", content: [item("甲"), item("乙"), item("丙")] }] },
    });
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    let from = 0,
      to = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "甲") from = pos + 1;
      if (node.isTextblock && node.textContent === "丙") to = pos + 1;
    });
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  expect(after.content?.map((node) => node.type)).toEqual(["bulletList"]);
  expect(after.content?.[0].content).toHaveLength(3);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("unsupported multi-paragraph task conversion leaves every task unchanged", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              { type: "taskItem", attrs: { checked: true }, content: [paragraph("第一段"), paragraph("第二段")] },
              { type: "taskItem", attrs: { checked: false }, content: [paragraph("另一项")] },
            ],
          },
        ],
      },
    });
  });
  await page.getByText("第二段", { exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.textContent === "第二段",
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.getByRole("button", { name: "无序列表", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.getByRole("button", { name: "有序列表", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

for (const action of ["delete", "drag"] as const) {
  test(`${action} updates a decimal list fragment without retaining a stale ancestor`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const item = (text: string, indent: number) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: indent },
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
              attrs: {
                start: 2,
                semloEditorOrderedStyle: "decimal",
                semloEditorOrderedAncestorPath: [1],
                semloEditorListLevelStarts: { 0: 2 },
              },
              content: [item("丁", 1), item("戊", 0)],
            },
          ],
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText("丁", { exact: true }).hover();
    const handle = page.locator(".semlo-editor-block-handle:visible");
    if (action === "delete") {
      await handle.click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
    } else {
      const from = await handle.boundingBox(),
        to = await page.getByText("戊", { exact: true }).boundingBox();
      if (!from || !to) throw new Error("Missing drag bounds");
      await page.mouse.move(from.x + 12, from.y + 12);
      await page.mouse.down();
      await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
      await page.mouse.move(to.x + 5, to.y + to.height - 2, { steps: 10 });
      await page.mouse.up();
    }
    const after = await snapshot();
    expect(
      await page
        .locator(".semlo-editor-prose li")
        .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType)),
    ).toEqual(action === "delete" ? ['"2. "'] : ['"2. "', '"3. "']);
    expect(after.json.content?.[0].attrs?.semloEditorOrderedAncestorPath ?? null).toBeNull();
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
  });
}
