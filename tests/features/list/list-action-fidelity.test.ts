import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/list/task-item-conversion-fixture";

let origin = "";
let stop = async () => {};

test.beforeAll(async () => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/list/task-item-conversion-fixture.ts", {
    publicDir: false,
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

for (const kind of ["taskList", "bulletList"] as const) {
  test(`新版编号末项转换为 ${kind} 并保留编号与历史`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate((targetKind) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const restart = targetKind === "bulletList";
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: {
                  version: 1,
                  sequences: [
                    { id: "A", start: 1, origin: "initial" },
                    ...(restart ? [{ id: "B", start: 1, origin: "restart" }] : []),
                  ],
                },
              },
              content: ["甲", "乙", "丙"].map((text, index) => ({
                type: "listItem",
                attrs: {
                  semloEditorListIndent: 0,
                  semloEditorListSequence: restart && index === 2 ? "B" : "A",
                  semloEditorListRestart: restart && index === 2,
                },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "后文" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    }, kind);
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    if (kind === "taskList") {
      await page.getByText("丙", { exact: true }).click();
      await page.getByRole("button", { name: "待办事项", exact: true }).click();
    } else {
      await page.getByText("丙", { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      const menu = page.getByRole("menu", { name: "转化为" });
      await expect(menu.getByRole("menuitem", { name: "正文", exact: true })).toBeDisabled();
      await expect(menu.getByRole("menuitem", { name: "标题 1", exact: true })).toBeDisabled();
      await menu.getByRole("menuitem", { name: "无序列表", exact: true }).click();
    }
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", kind, "paragraph"]);
    expect(after.json.content?.[0].attrs?.semloEditorListSequences).toEqual(
      before.json.content?.[0].attrs?.semloEditorListSequences,
    );
    expect(after.json.content?.[0].content).toEqual(before.json.content?.[0].content?.slice(0, 2));
    expect(after.json.content?.[1].content?.[0].attrs?.semloEditorListSequence).toBeUndefined();
    expect(after.json.content?.[1].content?.[0].attrs?.semloEditorListRestart).not.toBe(true);
    await expect(page.locator(".semlo-editor-prose > ol > li")).toHaveText(["甲", "乙"]);
    await expect(page.locator(".semlo-editor-prose > p")).toHaveText(["后文"]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    for (const value of [after.json, after.html]) {
      const restored = await page.evaluate((content) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(content);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, value);
      expect(restored).toEqual(after.json);
    }
  });
}

test("新版编号首项转待办，剩余项从一继续并可撤销", async ({ page }) => {
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
            type: "orderedList",
            attrs: {
              semloEditorOrderedStyle: "mixed",
              semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
            },
            content: ["甲", "乙", "丙"].map((text) => ({
              type: "listItem",
              attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
          { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
        ],
      },
      onChange(snapshot) {
        window.taskConversionEditor?.setContent(snapshot.html);
      },
    });
  });
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  const before = await snapshot();
  await page.getByText("甲", { exact: true }).click();
  await page.getByRole("button", { name: "待办事项", exact: true }).click();
  const after = await snapshot();
  expect(after.json.content?.map((node) => node.type)).toEqual(["taskList", "orderedList", "paragraph"]);
  await expect(page.locator(".semlo-editor-prose > ol > li")).toHaveText(["乙", "丙"]);
  expect(
    await page
      .locator(".semlo-editor-prose > ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 2]);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(after.json);
  const restored = await page.evaluate((html) => {
    window.__semloRequireFixture("taskConversionEditor").setContent(html);
    return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
  }, after.html);
  expect(restored).toEqual(after.json);
});

for (const kind of ["taskList", "bulletList"] as const) {
  test(`新版编号中间项转 ${kind} 后前后续接`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText("乙", { exact: true }).click();
    await page.getByRole("button", { name: kind === "taskList" ? "待办事项" : "无序列表", exact: true }).click();
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", kind, "orderedList", "paragraph"]);
    const firstLink = after.json.content?.[0].attrs?.semloEditorListSequenceLink as string;
    const lastLink = after.json.content?.[2].attrs?.semloEditorListSequenceLink as string;
    expect(firstLink).toMatch(/^v2:_:/);
    expect(lastLink).toBe(firstLink.replace("v2:_:", "v2:") + ":_");
    const values = () =>
      page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value));
    expect(await values()).toEqual([1, 2]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    const restored = await page.evaluate((html) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(html);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after.html);
    expect(restored).toEqual(after.json);
    await page.getByText("乙", { exact: true }).click();
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    const rejoined = await snapshot();
    expect(rejoined.json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph"]);
    expect(await values()).toEqual([1, 2, 3]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(rejoined.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    await page.getByText("甲", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增");
    expect(await values()).toEqual([1, 2, 3]);
    expect((await snapshot()).json.content?.[2].attrs?.semloEditorListSequences.sequences[0].start).toBe(3);
  });
}

for (const kind of ["taskList", "bulletList"] as const) {
  test(`新版编号的连续中间项转 ${kind} 并可整体转回`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙", "丁"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const selectMiddle = async (backwards: boolean) => {
      await page.evaluate((reverse) => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = -1,
          to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === "乙") from = pos + 1;
          if (node.isTextblock && node.textContent === "丙") to = pos + node.nodeSize - 1;
        });
        if (from < 0 || to < 0) throw new Error("未找到中间选区");
        editor.view.focus();
        editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
      }, backwards);
    };
    const values = () =>
      page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value));
    const before = await snapshot();
    await selectMiddle(kind === "bulletList");
    await page.getByRole("button", { name: kind === "taskList" ? "待办事项" : "无序列表", exact: true }).click();
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", kind, "orderedList", "paragraph"]);
    expect(after.json.content?.[1].content?.map((node) => node.content?.[0]?.content?.[0]?.text)).toEqual(["乙", "丙"]);
    expect(await values()).toEqual([1, 2]);
    expect(
      await page.evaluate(() => {
        const { doc, selection } = window.__semloRequireFixture("taskConversionEditor").editor.state;
        return {
          text: doc.textBetween(selection.from, selection.to, "\n"),
          backwards: selection.anchor > selection.head,
        };
      }),
    ).toEqual({ text: "乙\n丙", backwards: kind === "bulletList" });
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    const restored = await page.evaluate((html) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(html);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after.html);
    expect(restored).toEqual(after.json);
    await page.getByText("乙", { exact: true }).click();
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    expect((await snapshot()).json).toEqual(after.json);
    await selectMiddle(false);
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    expect((await snapshot()).json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph"]);
    expect(await values()).toEqual([1, 2, 3, 4]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    await page.getByText("甲", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增");
    expect(await values()).toEqual([1, 2, 3]);
    expect((await snapshot()).json.content?.[2].attrs?.semloEditorListSequences.sequences[0].start).toBe(3);
  });
}

for (const [first, last, types, numbers] of [
  ["甲", "乙", ["taskList", "orderedList"], [1, 2]],
  ["丙", "丁", ["orderedList", "taskList"], [1, 2]],
  ["甲", "丁", ["taskList"], []],
] as const) {
  test(`新版编号 ${first} 至 ${last} 连续转换保留边界和撤销`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙", "丁"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
      });
    });
    const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    await page.evaluate(
      ([start, end]) => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = -1,
          to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === start) from = pos + 1;
          if (node.isTextblock && node.textContent === end) to = pos + node.nodeSize - 1;
        });
        if (from < 0 || to < 0) throw new Error("未找到列表选区");
        editor.view.focus();
        editor.commands.setTextSelection({ from, to });
      },
      [first, last],
    );
    await page.getByRole("button", { name: "待办事项", exact: true }).click();
    const after = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    expect(after.content?.map((node) => node.type)).toEqual([...types, "paragraph"]);
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([...numbers]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}

for (const kind of ["taskList", "bulletList"] as const) {
  test(`新版编号末尾同序列子项转 ${kind} 后可接回`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: {
                  version: 1,
                  sequences: [
                    { id: "A", start: 1, origin: "initial" },
                    { id: "B", start: 1, origin: "initial" },
                  ],
                },
              },
              content: ["甲", "乙", "丙"].map((text, index) => ({
                type: "listItem",
                attrs: { semloEditorListIndent: index === 0 ? 0 : 1, semloEditorListSequence: index === 0 ? "A" : "B" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText("乙", { exact: true }).click();
    await expect(page.getByRole("button", { name: "待办事项", exact: true })).toBeDisabled();
    if (kind === "taskList") {
      await page.getByText("丙", { exact: true }).click();
      await page.getByRole("button", { name: "待办事项", exact: true }).click();
    } else {
      await page.getByText("丙", { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "无序列表", exact: true }).click();
    }
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", kind, "paragraph"]);
    expect(after.json.content?.[1].content?.[0].attrs?.semloEditorListIndent).toBe(1);
    expect(after.json.content?.[1].content?.[0].attrs?.semloEditorListSequence).toBeUndefined();
    const previousBox = await page.getByText("乙", { exact: true }).boundingBox();
    const convertedBox = await page.getByText("丙", { exact: true }).boundingBox();
    expect(previousBox && convertedBox && Math.abs(previousBox.x - convertedBox.x)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    const restored = await page.evaluate((html) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(html);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after.html);
    expect(restored).toEqual(after.json);
    await page.getByText("丙", { exact: true }).click();
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    expect((await snapshot()).json).toEqual(before.json);
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 1, 2]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    if (kind === "taskList") {
      await page.evaluate((content) => {
        const fixture = window.__semloRequireFixture("taskConversionEditor");
        const list = content.content![0];
        list.attrs!.semloEditorListSequences.sequences.push({ id: "C", start: 1, origin: "restart" });
        list.content![list.content!.length - 1].attrs!.semloEditorListSequence = "C";
        list.content![list.content!.length - 1].attrs!.semloEditorListRestart = true;
        fixture.setContent(content);
      }, before.json);
      await page.getByText("丙", { exact: true }).click();
      await expect(page.getByRole("button", { name: "待办事项", exact: true })).toBeDisabled();
    }
  });
}

for (const entry of ["toolbar", "keyboard", "block"] as const) {
  test(`新版编号平铺末项从 ${entry} 转编号标题并保留其他内容`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙标题"].map((text, index) => ({
                type: "listItem",
                attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text,
                        ...(index === 2
                          ? {
                              marks: [
                                { type: "bold" },
                                { type: "textStyle", attrs: { color: "#f00", fontSize: "20px" } },
                              ],
                            }
                          : {}),
                      },
                    ],
                  },
                ],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText(entry === "block" ? "乙" : "丙标题", { exact: true }).click();
    if (entry === "keyboard")
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let position = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === "丙标题") position = pos + 1;
        });
        if (position < 0) throw new Error("未找到标题选区");
        editor.commands.setTextSelection({ from: position + 3, to: position + 1 });
      });
    if (entry === "toolbar") {
      await page.getByRole("button", { name: "段落样式" }).click();
      await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
    } else if (entry === "keyboard") {
      await page.keyboard.press("ControlOrMeta+Alt+3");
    } else {
      await page.getByText("丙标题", { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true }).click();
    }
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "heading", "paragraph"]);
    expect(after.json.content?.[1].attrs).toMatchObject({ level: 3, semloEditorHeadingNumbering: "mixed" });
    expect(after.json.content?.[1].content?.[0].marks?.map((mark) => mark.type)).toEqual(["textStyle"]);
    expect(after.json.content?.[1].content?.[0].marks?.[0].attrs?.color).toBe("#f00");
    expect(after.json.content?.[1].content?.[0].marks?.[0].attrs?.fontSize).not.toBeTruthy();
    await expect(page.locator(".semlo-editor-prose > ol > li")).toHaveText(["甲", "乙"]);
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 2]);
    await expect(page.locator(".semlo-editor-prose > h3")).toContainText("丙标题");
    await expect(page.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveAttribute(
      "aria-label",
      "1.",
    );
    await expect(page.locator(".semlo-editor-prose > p")).toHaveText("尾段");
    if (entry === "keyboard")
      expect(
        await page.evaluate(() => {
          const { doc, selection } = window.__semloRequireFixture("taskConversionEditor").editor.state;
          return { text: doc.textBetween(selection.from, selection.to), backwards: selection.anchor > selection.head };
        }),
      ).toEqual({ text: "标题", backwards: true });
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    if (entry === "block")
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$anchor.parent.textContent,
        ),
      ).toBe("乙");
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
  });
}

for (const target of ["甲", "乙"] as const) {
  test(`新版编号平铺 ${target} 转标题后剩余编号可续接`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: "mixed",
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const values = () =>
      page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value));
    const before = await snapshot();
    await page.getByText(target, { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(
      target === "甲"
        ? ["heading", "orderedList", "paragraph"]
        : ["orderedList", "heading", "orderedList", "paragraph"],
    );
    await expect(page.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveAttribute(
      "aria-label",
      "1.",
    );
    expect(await values()).toEqual([1, 2]);
    if (target === "乙") {
      const first = after.json.content?.[0].attrs?.semloEditorListSequenceLink as string;
      const last = after.json.content?.[2].attrs?.semloEditorListSequenceLink as string;
      expect(first).toMatch(/^v3:_:/);
      expect(last).toBe(first.replace("v3:_:", "v3:") + ":_");
    }
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    const restored = await page.evaluate((html) => {
      window.__semloRequireFixture("taskConversionEditor").setContent(html);
      return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
    }, after.html);
    expect(restored).toEqual(after.json);
    if (target === "乙") {
      await page.getByText("甲", { exact: true }).click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("新增");
      expect(await values()).toEqual([1, 2, 3]);
      expect((await snapshot()).json.content?.[2].attrs?.semloEditorListSequences.sequences[0].start).toBe(3);
    }
  });
}

for (const sample of [
  { listStyle: "chinese", existing: false, expected: "chinese", marker: "一、" },
  { listStyle: "decimal", existing: false, expected: "decimal", marker: "1." },
  { listStyle: "decimal", existing: true, expected: "chinese", marker: "二、" },
] as const) {
  test(`新版 ${sample.listStyle} 列表中项转标题${sample.existing ? "继承已有标题样式" : "保留编号样式"}`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(({ listStyle, existing }) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            ...(existing
              ? [
                  {
                    type: "heading",
                    attrs: { level: 3, semloEditorHeadingNumbering: "chinese" },
                    content: [{ type: "text", text: "前标题" }],
                  },
                ]
              : []),
            {
              type: "orderedList",
              attrs: {
                semloEditorOrderedStyle: listStyle,
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    }, sample);
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.getByText("乙", { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await snapshot();
    const heading = after.json.content?.find((node) => node.type === "heading" && node.content?.[0].text === "乙");
    expect(heading?.attrs?.semloEditorHeadingNumbering).toBe(sample.expected);
    await expect(
      page.locator(".semlo-editor-prose > h3").last().locator(".semlo-editor-heading-number"),
    ).toHaveAttribute("aria-label", sample.marker);
    const lists = after.json.content?.filter((node) => node.type === "orderedList") ?? [];
    expect(lists).toHaveLength(2);
    expect(lists[0].attrs?.semloEditorOrderedStyle).toBe(sample.listStyle);
    expect(lists[1].attrs?.semloEditorOrderedStyle).toBe(sample.listStyle);
    expect(lists[1].attrs?.semloEditorListSequences.sequences[0].start).toBe(2);
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

for (const reverse of [false, true]) {
  test(`新版编号连续中间项转标题并续号（${reverse ? "反向" : "正向"}选区）`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙", "丁"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.evaluate((reverse) => {
      const editor = window.__semloRequireFixture("taskConversionEditor").editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === "乙") from = pos + 1;
        if (node.type.name === "paragraph" && node.textContent === "丙") to = pos + node.nodeSize - 1;
      });
      if (from < 0 || to < 0) throw new Error("未找到列表选区");
      editor.view.focus();
      editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
    }, reverse);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual([
      "orderedList",
      "heading",
      "heading",
      "orderedList",
      "paragraph",
    ]);
    await expect(page.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(["1.", "2."]);
    expect(after.json.content?.[3].attrs?.semloEditorListSequences.sequences[0].start).toBe(2);
    expect(
      await page.evaluate(() => {
        const { $anchor, $head } = window.__semloRequireFixture("taskConversionEditor").editor.state.selection;
        return [$anchor.parent.textContent, $anchor.parentOffset, $head.parent.textContent, $head.parentOffset];
      }),
    ).toEqual(reverse ? ["丙", 1, "乙", 0] : ["乙", 0, "丙", 1]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    await page.getByText("甲", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增");
    expect((await snapshot()).json.content?.[3].attrs?.semloEditorListSequences.sequences[0].start).toBe(3);
  });
}

test("新版编号的单项列表可转换为标题", async ({ page }) => {
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
            type: "orderedList",
            attrs: {
              semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
            },
            content: [
              {
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "单项" }] }],
              },
            ],
          },
        ],
      },
    });
  });
  await page.getByText("单项", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Alt+3");
  await expect(page.locator(".semlo-editor-prose > h3")).toHaveText("1. 单项");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json.content?.[0].type,
    ),
  ).toBe("heading");
});

for (const entry of ["keyboard", "block"] as const) {
  test(`新版编号${entry === "keyboard" ? "连续中间项" : "中间项"}通过 ${entry} 转正文并续号`, async ({ page }) => {
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
              type: "orderedList",
              attrs: {
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙", "丁"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text, ...(text === "乙" ? { marks: [{ type: "bold" }] } : {}) }],
                  },
                ],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    if (entry === "keyboard") {
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = -1,
          to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "paragraph" && node.textContent === "乙") from = pos + 1;
          if (node.type.name === "paragraph" && node.textContent === "丙") to = pos + node.nodeSize - 1;
        });
        if (from < 0 || to < 0) throw new Error("未找到列表选区");
        editor.view.focus();
        editor.commands.setTextSelection({ from, to });
      });
      await page.keyboard.press("ControlOrMeta+Alt+0");
    } else {
      await page.getByText("乙", { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();
    }
    const after = await snapshot();
    const blocks = after.json.content ?? [];
    expect(blocks.map((node) => node.type)).toEqual(
      entry === "keyboard"
        ? ["orderedList", "paragraph", "paragraph", "orderedList", "paragraph"]
        : ["orderedList", "paragraph", "orderedList", "paragraph"],
    );
    expect(blocks[1].content?.[0].marks?.some((mark) => mark.type === "bold") ?? false).toBe(entry === "block");
    const suffix = blocks[entry === "keyboard" ? 3 : 2];
    expect(suffix.attrs?.semloEditorListSequenceLink).toMatch(/^v1:.*:_$/);
    expect(suffix.attrs?.semloEditorListSequences.sequences[0].start).toBe(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    if (entry === "keyboard") {
      await page.getByText("乙", { exact: true }).click();
      await page.getByRole("button", { name: "有序列表", exact: true }).click();
      expect((await snapshot()).json).toEqual(after.json);
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = -1,
          to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "paragraph" && node.textContent === "乙") from = pos + 1;
          if (node.type.name === "paragraph" && node.textContent === "丙") to = pos + node.nodeSize - 1;
        });
        editor.commands.setTextSelection({ from, to });
        editor.view.focus();
      });
      await page.keyboard.press("ControlOrMeta+Shift+7");
      const joined = await snapshot();
      expect(joined.json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph"]);
      expect(joined.json.content?.[0].content?.map((node) => node.content?.[0].content?.[0].text)).toEqual([
        "甲",
        "乙",
        "丙",
        "丁",
      ]);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo()),
      ).toBe(true);
      expect((await snapshot()).json).toEqual(after.json);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo()),
      ).toBe(true);
      expect((await snapshot()).json).toEqual(joined.json);
    } else {
      await page.getByText("乙", { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "有序列表", exact: true }).click();
      const joined = await snapshot();
      expect(joined.json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph"]);
      expect(joined.json.content?.[0].content?.map((node) => node.content?.[0].content?.[0].text)).toEqual([
        "甲",
        "乙",
        "丙",
        "丁",
      ]);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo()),
      ).toBe(true);
      expect((await snapshot()).json).toEqual(after.json);
    }
  });
}

for (const entry of ["toolbar", "keyboard", "block"] as const) {
  test(`标题中的 ${entry} 有序入口切换编号并保持两侧续接`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const list = (text: string, start: number, link: string) => ({
        type: "orderedList",
        attrs: {
          semloEditorOrderedStyle: "mixed",
          semloEditorListSequenceLink: link,
          semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
        },
        content: [
          {
            type: "listItem",
            attrs: { semloEditorListSequence: "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          },
        ],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            list("甲", 1, "v3:_:edge"),
            {
              type: "heading",
              attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
              content: [{ type: "text", text: "乙" }],
            },
            list("丙", 2, "v3:edge:_"),
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    const heading = page.locator(".semlo-editor-prose > h3");
    await heading.click();
    const ordered = page.getByRole("button", { name: "有序列表", exact: true });
    await expect(ordered).toHaveAttribute("aria-pressed", "true");
    await expect(ordered).toHaveAttribute("title", "标题序号");
    if (entry === "toolbar") await ordered.click();
    else if (entry === "keyboard") await page.keyboard.press("ControlOrMeta+Shift+7");
    else {
      await heading.hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "有序列表", exact: true }).click();
    }
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual([
      "orderedList",
      "heading",
      "orderedList",
      "paragraph",
    ]);
    expect(after.json.content?.[1].attrs?.semloEditorHeadingNumbering).not.toBeTruthy();
    expect(after.json.content?.[0].attrs?.semloEditorListSequenceLink).toBe("v3:_:edge");
    expect(after.json.content?.[2].attrs?.semloEditorListSequenceLink).toBe("v3:edge:_");
    await expect(ordered).toHaveAttribute("aria-pressed", "false");
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 2]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    await heading.click();
    await ordered.click();
    expect((await snapshot()).json).toEqual(before.json);
  });
}

test("标题编号样式会启用当前标题并更新已有编号标题", async ({ page }) => {
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
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "标题甲" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "标题乙" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        ],
      },
      onChange(snapshot) {
        window.taskConversionEditor?.setContent(snapshot.html);
      },
    });
  });
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  const headings = page.locator(".semlo-editor-prose > h3");
  const arrow = page.getByRole("button", { name: "有序列表样式" });
  await headings.nth(0).click();
  await arrow.click();
  await page.getByRole("menuitemradio", { name: "中文数字" }).click();
  expect((await snapshot()).json.content?.[0].attrs?.semloEditorHeadingNumbering).toBe("chinese");
  expect((await snapshot()).json.content?.[2].attrs?.semloEditorHeadingNumbering).not.toBeTruthy();
  await headings.nth(1).click();
  await page.getByRole("button", { name: "有序列表", exact: true }).click();
  const chinese = await snapshot();
  expect(chinese.json.content?.[2].attrs?.semloEditorHeadingNumbering).toBe("chinese");
  await expect(page.locator(".semlo-editor-heading-number")).toHaveText(["一、", "二、"]);
  await arrow.click();
  await page.getByRole("menuitemradio", { name: "多级数字" }).click();
  const decimal = await snapshot();
  expect(decimal.json.content?.[0].attrs?.semloEditorHeadingNumbering).toBe("decimal");
  expect(decimal.json.content?.[2].attrs?.semloEditorHeadingNumbering).toBe("decimal");
  await expect(page.locator(".semlo-editor-heading-number")).toHaveText(["1.", "2."]);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(chinese.json);
});

for (const kind of ["taskList", "bulletList"] as const) {
  test(`普通正文可使用快捷键切换 ${kind}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: "<p>普通正文</p><p>后文</p>",
      });
    });
    const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
    await page.getByText("普通正文", { exact: true }).click();
    if (kind === "taskList") {
      const prevented = await page.evaluate(() => {
        const event = new KeyboardEvent("keydown", {
          key: "t",
          code: "KeyT",
          metaKey: /Mac|iPhone|iPad|iPod/i.test(navigator.platform),
          ctrlKey: !/Mac|iPhone|iPad|iPod/i.test(navigator.platform),
          altKey: true,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        });
        window.__semloRequireFixture("taskConversionEditor").editor.view.dom.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(prevented).toBe(false);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json),
      ).toEqual(before);
    }
    await page.keyboard.press(kind === "taskList" ? "ControlOrMeta+Alt+t" : "ControlOrMeta+Shift+8");
    expect(
      await page.evaluate(() =>
        window
          .__semloRequireFixture("taskConversionEditor")
          .getSnapshot()
          .json.content?.map((node) => node.type),
      ),
    ).toEqual([kind, "paragraph"]);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
      before,
    );
  });
}

test("宿主拒绝同步选区时列表快捷键不会改动旧位置", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: "<p>第一段</p><p>第二段</p>",
    });
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    editor.commands.setTextSelection(1);
    editor.view.focus();
    window.__semloRequireFixture("taskConversionRejectSelection")();
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  const prevented = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    const text = editor.view.dom.querySelectorAll("p")[1].firstChild!;
    document.getSelection()!.setBaseAndExtent(text, 0, text, 0);
    const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      key: "8",
      code: "Digit8",
      metaKey: mac,
      ctrlKey: !mac,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("宿主拒绝混合选区列表转换时保留内容和选区", async ({ page }) => {
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
            type: "orderedList",
            attrs: { semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] } },
            content: ["甲", "乙"].map((text) => ({
              type: "listItem",
              attrs: { semloEditorListSequence: "A" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
          { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
        ],
      },
    });
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    let from = -1,
      to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "乙") from = pos + 1;
      if (node.isTextblock && node.textContent === "尾段") to = pos + node.nodeSize - 1;
    });
    editor.commands.setTextSelection({ from, to });
    editor.view.focus();
    window.__semloRequireFixture("taskConversionRejectConvertedList")();
  });
  const before = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor");
    return {
      json: editor.getSnapshot().json,
      anchor: editor.editor.state.selection.anchor,
      head: editor.editor.state.selection.head,
    };
  });
  await page.keyboard.press("ControlOrMeta+Alt+t");
  const after = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor");
    return {
      json: editor.getSnapshot().json,
      anchor: editor.editor.state.selection.anchor,
      head: editor.editor.state.selection.head,
    };
  });
  expect(after).toEqual(before);
});

for (const sample of [
  { kind: "taskList", first: "前文", last: "甲", reverse: true, interleaved: false, entry: "toolbar" },
  { kind: "bulletList", first: "乙", last: "尾段", reverse: false, interleaved: false, entry: "toolbar" },
  { kind: "taskList", first: "前文", last: "尾段", reverse: false, interleaved: false, entry: "keyboard" },
  { kind: "bulletList", first: "前文", last: "甲", reverse: true, interleaved: true, entry: "keyboard" },
] as const) {
  test(`新版编号与正文混合选区转换为 ${sample.kind}（${sample.first} 至 ${sample.last}${sample.interleaved ? "，交错序列" : ""}）`, async ({
    page,
  }) => {
    if (!sample.reverse) await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(({ interleaved }) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "前文" }] },
            {
              type: "orderedList",
              attrs: {
                semloEditorListSequences: {
                  version: 1,
                  sequences: [
                    { id: "A", start: 1, origin: "initial" },
                    ...(interleaved ? [{ id: "B", start: 1, origin: "restart" }] : []),
                  ],
                },
              },
              content: ["甲", "乙", "丙"].map((text) => ({
                type: "listItem",
                attrs: {
                  semloEditorListSequence: interleaved && text === "乙" ? "B" : "A",
                  semloEditorListRestart: interleaved && text === "乙",
                },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text, ...(text === "乙" ? { marks: [{ type: "bold" }] } : {}) }],
                  },
                ],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    }, sample);
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.evaluate(({ first, last, reverse }) => {
      const editor = window.__semloRequireFixture("taskConversionEditor").editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === first) from = pos + 1;
        if (node.isTextblock && node.textContent === last) to = pos + node.nodeSize - 1;
      });
      if (from < 0 || to < 0) throw new Error("未找到混合选区");
      editor.view.focus();
      editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
    }, sample);
    if (sample.entry === "toolbar") {
      if (!sample.reverse) await page.getByRole("button", { name: "更多", exact: true }).click();
      const button = page.getByRole("button", {
        name: sample.kind === "taskList" ? "待办事项" : "无序列表",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
    } else await page.keyboard.press(sample.kind === "taskList" ? "ControlOrMeta+Alt+t" : "ControlOrMeta+Shift+8");
    const after = await snapshot();
    const converted = after.json.content?.find((node) => node.type === sample.kind);
    const ordered = after.json.content?.find((node) => node.type === "orderedList");
    const expected =
      sample.first === "乙"
        ? ["乙", "丙", "尾段"]
        : sample.last === "甲"
          ? ["前文", "甲"]
          : ["前文", "甲", "乙", "丙", "尾段"];
    expect(converted?.content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(expected);
    expect(ordered?.content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(
      sample.first === "乙" ? ["甲"] : sample.last === "甲" ? ["乙", "丙"] : undefined,
    );
    const bold = (sample.first === "乙" || sample.last === "尾段" ? converted : ordered)?.content?.find(
      (node) => node.content?.[0].content?.[0].text === "乙",
    );
    expect(bold?.content?.[0].content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual(sample.first === "乙" ? [1] : sample.last === "甲" ? (sample.interleaved ? [1, 1] : [1, 2]) : []);
    expect(
      await page.evaluate(() => {
        const { $anchor, $head } = window.__semloRequireFixture("taskConversionEditor").editor.state.selection;
        return [$anchor.parent.textContent, $anchor.parentOffset, $head.parent.textContent, $head.parentOffset];
      }),
    ).toEqual(
      sample.reverse
        ? [sample.last, sample.last.length, sample.first, 0]
        : [sample.first, 0, sample.last, sample.last.length],
    );
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

for (const sample of [
  { name: "前正文", first: "前文", last: "甲", reverse: true, entry: "toolbar" },
  { name: "后正文", first: "乙", last: "尾段", reverse: false, entry: "keyboard" },
  { name: "两侧正文", first: "前文", last: "尾段", reverse: false, entry: "keyboard" },
] as const) {
  test(`新版编号列表与${sample.name}一起转标题`, async ({ page }) => {
    if (sample.entry === "keyboard") await page.setViewportSize({ width: 375, height: 800 });
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
            { type: "paragraph", content: [{ type: "text", text: "前文" }] },
            {
              type: "orderedList",
              attrs: {
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.evaluate(({ first, last, reverse }) => {
      const editor = window.__semloRequireFixture("taskConversionEditor").editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === first) from = pos + 1;
        if (node.isTextblock && node.textContent === last) to = pos + node.nodeSize - 1;
      });
      if (from < 0 || to < 0) throw new Error("未找到跨块选区");
      editor.view.focus();
      editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
    }, sample);
    if (sample.entry === "toolbar") {
      await page.getByRole("button", { name: "段落样式" }).click();
      await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
    } else await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await snapshot();
    const headings = after.json.content?.filter((node) => node.type === "heading") ?? [];
    expect(headings.map((node) => [node.content?.[0].text, node.attrs?.semloEditorHeadingNumbering])).toEqual(
      sample.name === "前正文"
        ? [
            ["前文", null],
            ["甲", "mixed"],
          ]
        : sample.name === "后正文"
          ? [
              ["乙", "mixed"],
              ["丙", "mixed"],
              ["尾段", "mixed"],
            ]
          : [
              ["前文", null],
              ["甲", "mixed"],
              ["乙", "mixed"],
              ["丙", "mixed"],
              ["尾段", "mixed"],
            ],
    );
    const list = after.json.content?.find((node) => node.type === "orderedList");
    expect(list?.content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(
      sample.name === "前正文" ? ["乙", "丙"] : sample.name === "后正文" ? ["甲"] : undefined,
    );
    await expect(page.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText(
      sample.name === "前正文" ? ["1."] : sample.name === "后正文" ? ["1.", "2.", "3."] : ["1.", "2.", "3.", "4."],
    );
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual(sample.name === "前正文" ? [1, 2] : sample.name === "后正文" ? [1] : []);
    expect(
      await page.evaluate(() => {
        const { $anchor, $head } = window.__semloRequireFixture("taskConversionEditor").editor.state.selection;
        return [$anchor.parent.textContent, $anchor.parentOffset, $head.parent.textContent, $head.parentOffset];
      }),
    ).toEqual(
      sample.reverse
        ? [sample.last, sample.last.length, sample.first, 0]
        : [sample.first, 0, sample.last, sample.last.length],
    );
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

for (const sample of [
  { first: "前文", last: "甲", reverse: true },
  { first: "乙", last: "尾段", reverse: false },
] as const) {
  test(`新版编号列表与${sample.first === "前文" ? "前" : "后"}正文一起转正文`, async ({ page }) => {
    if (!sample.reverse) await page.setViewportSize({ width: 375, height: 800 });
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
            { type: "paragraph", content: [{ type: "text", text: "前文" }] },
            {
              type: "orderedList",
              attrs: {
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["甲", "乙", "丙"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text, ...(text === "乙" ? { marks: [{ type: "bold" }] } : {}) }],
                  },
                ],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    });
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.evaluate(({ first, last, reverse }) => {
      const editor = window.__semloRequireFixture("taskConversionEditor").editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === first) from = pos + 1;
        if (node.isTextblock && node.textContent === last) to = pos + node.nodeSize - 1;
      });
      if (from < 0 || to < 0) throw new Error("未找到跨块选区");
      editor.view.focus();
      editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
    }, sample);
    await page.keyboard.press("ControlOrMeta+Alt+0");
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual(
      sample.reverse
        ? ["paragraph", "paragraph", "orderedList", "paragraph"]
        : ["paragraph", "orderedList", "paragraph", "paragraph", "paragraph"],
    );
    const list = after.json.content?.find((node) => node.type === "orderedList");
    expect(list?.content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(
      sample.reverse ? ["乙", "丙"] : ["甲"],
    );
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual(sample.reverse ? [1, 2] : [1]);
    const bold = sample.reverse ? list?.content?.[0].content?.[0].content?.[0] : after.json.content?.[2].content?.[0];
    expect(bold?.marks?.some((mark) => mark.type === "bold") ?? false).toBe(sample.reverse);
    expect(
      await page.evaluate(() => {
        const { $anchor, $head } = window.__semloRequireFixture("taskConversionEditor").editor.state.selection;
        return [$anchor.parent.textContent, $anchor.parentOffset, $head.parent.textContent, $head.parentOffset];
      }),
    ).toEqual(
      sample.reverse
        ? [sample.last, sample.last.length, sample.first, 0]
        : [sample.first, 0, sample.last, sample.last.length],
    );
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

test("宿主拒绝新版编号的标题转换时保留原文", async ({ page }) => {
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
            type: "orderedList",
            attrs: {
              semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
            },
            content: ["甲", "乙", "丙"].map((text) => ({
              type: "listItem",
              attrs: { semloEditorListSequence: "A" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
          { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
        ],
      },
    });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  await page.evaluate(() => window.__semloRequireFixture("taskConversionRejectHeading")());
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    let from = -1,
      to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "乙") from = pos + 1;
      if (node.isTextblock && node.textContent === "尾段") to = pos + node.nodeSize - 1;
    });
    if (from < 0 || to < 0) throw new Error("未找到跨块选区");
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  });
  await page.keyboard.press("ControlOrMeta+Alt+3");
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.getByText("丙", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Alt+3");
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$anchor.parent.textContent,
    ),
  ).toBe("丙");
});

for (const sample of [
  { version: 1, text: "丁", end: "丁", kind: "无序列表", rejoin: false, block: false },
  { version: 1, text: "丙", end: "丙", kind: "待办事项", rejoin: false, block: false },
  { version: 1, text: "丙", end: "戊", kind: "待办事项", rejoin: true, block: false },
  { version: 1, text: "甲", end: "乙", kind: "无序列表", rejoin: false, block: false },
  { version: 1, text: "独", end: "独", kind: "无序列表", rejoin: true, block: false },
  { version: 2, text: "丁", end: "丁", kind: "无序列表", rejoin: true, block: false },
  { version: 2, text: "丙", end: "丙", kind: "待办事项", rejoin: false, block: false },
  { version: 2, text: "丁", end: "戊", kind: "待办事项", rejoin: false, block: false },
  { version: 2, text: "丙", end: "戊", kind: "无序列表", rejoin: true, block: false },
  { version: 2, text: "己", end: "庚", kind: "待办事项", rejoin: false, block: false },
  { version: 2, text: "独", end: "独", kind: "待办事项", rejoin: true, block: false },
  { version: 3, text: "戊", end: "戊", kind: "无序列表", rejoin: false, block: true },
  { version: 3, text: "独", end: "独", kind: "待办事项", rejoin: true, block: false },
] as const) {
  test(`已有 v${sample.version} 续接的${sample.text}至${sample.end}转${sample.kind}后保留编号与历史`, async ({
    page,
  }) => {
    if (sample.version === 1 && sample.text === "独") await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(({ version, text }) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const list = (names: string[], start: number, link: string) => ({
        type: "orderedList",
        attrs: {
          semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
          semloEditorListSequenceLink: link,
        },
        content: names.map((text) => ({
          type: "listItem",
          attrs: { semloEditorListSequence: "A" },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      });
      const middle = text === "独" ? ["独"] : ["丙", "丁", "戊"];
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            list(["甲", "乙"], 1, `v${version}:_:left`),
            { type: "paragraph", content: [{ type: "text", text: "间隔一" }] },
            list(middle, 3, `v${version}:left:right`),
            { type: version === 3 ? "heading" : "paragraph", content: [{ type: "text", text: "间隔二" }] },
            list(["己", "庚"], 3 + middle.length, `v${version}:right:_`),
          ],
        },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    }, sample);
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    if (sample.block) {
      await page.getByText(sample.text, { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page
        .getByRole("menu", { name: "转化为" })
        .getByRole("menuitem", { name: sample.kind, exact: true })
        .click();
    } else {
      await page.getByText(sample.text, { exact: true }).click();
      if (sample.end !== sample.text)
        await page.evaluate(({ text, end }) => {
          const editor = window.__semloRequireFixture("taskConversionEditor").editor;
          let from = -1,
            to = -1;
          editor.state.doc.descendants((node, pos) => {
            if (node.isTextblock && node.textContent === text) from = pos + 1;
            if (node.isTextblock && node.textContent === end) to = pos + node.nodeSize - 1;
          });
          if (from < 0 || to < 0) throw new Error("未找到列表选区");
          editor.view.focus();
          editor.commands.setTextSelection({ from, to });
        }, sample);
      const button = page.getByRole("button", { name: sample.kind, exact: true });
      if (!(await button.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
      await expect(button).toBeEnabled();
      await button.click();
    }
    const after = await snapshot();
    expect(
      after.json.content?.find((node) => node.type === (sample.kind === "待办事项" ? "taskList" : "bulletList")),
    ).toBeDefined();
    if (sample.version === 1) {
      const links = after.json.content
        ?.filter((node) => node.type === "orderedList")
        .map((node) => node.attrs?.semloEditorListSequenceLink);
      expect(links?.every((link) => typeof link === "string" && link.startsWith("v2:"))).toBe(true);
    }
    const all = sample.text === "独" ? ["甲", "乙", "独", "己", "庚"] : ["甲", "乙", "丙", "丁", "戊", "己", "庚"];
    expect(
      await page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) =>
          items.map((item) => [(item as HTMLLIElement).innerText, (item as HTMLLIElement).value]),
        ),
    ).toEqual(
      all
        .filter((_, index) => index < all.indexOf(sample.text) || index > all.indexOf(sample.end))
        .map((text, index) => [text, index + 1]),
    );
    if (sample.version === 1 && sample.text === "丁") {
      await page.getByText("甲", { exact: true }).click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      expect(
        await page
          .locator(".semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual(all.map((_, index) => index + 1));
      expect(
        await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo()),
      ).toBe(true);
      expect((await snapshot()).json).toEqual(after.json);
    }
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    if (sample.rejoin) {
      await page.getByText(sample.text, { exact: true }).click();
      if (sample.end !== sample.text)
        await page.evaluate(({ text, end }) => {
          const editor = window.__semloRequireFixture("taskConversionEditor").editor;
          let from = -1,
            to = -1;
          editor.state.doc.descendants((node, pos) => {
            if (node.isTextblock && node.textContent === text) from = pos + 1;
            if (node.isTextblock && node.textContent === end) to = pos + node.nodeSize - 1;
          });
          if (from < 0 || to < 0) throw new Error("未找到转回选区");
          editor.view.focus();
          editor.commands.setTextSelection({ from, to });
        }, sample);
      const ordered = page.getByRole("button", { name: "有序列表", exact: true });
      if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
      await ordered.click();
      const rejoined = await snapshot();
      expect(rejoined.text).toBe(before.text);
      expect(rejoined.json.content?.map((node) => node.type)).toEqual(before.json.content?.map((node) => node.type));
      expect(
        await page
          .locator(".semlo-editor-prose > ol > li")
          .evaluateAll((items) =>
            items.map((item) => [(item as HTMLLIElement).innerText, (item as HTMLLIElement).value]),
          ),
      ).toEqual(all.map((text, index) => [text, index + 1]));
      expect(
        await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo()),
      ).toBe(true);
      expect((await snapshot()).json).toEqual(after.json);
    }
    for (const value of [after.json, after.html]) {
      const restored = await page.evaluate((content) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(content);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, value);
      expect(restored).toEqual(after.json);
    }
  });
}

for (const sample of [
  { version: 0, kind: "taskList", first: "乙", last: "乙", reverse: false, block: false },
  { version: 0, kind: "bulletList", first: "乙", last: "丙", reverse: true, block: false },
  { version: 1, kind: "taskList", first: "乙", last: "丙", reverse: false, block: false },
  { version: 3, kind: "bulletList", first: "乙", last: "乙", reverse: false, block: true },
] as const) {
  test(`交错序列 v${sample.version} 中间项转 ${sample.kind} 并恢复身份`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate(({ version }) => {
      const host = document.createElement("div");
      document.body.replaceChildren(host);
      const list = (names: string[], startA: number, startB: number, link: string | null) => ({
        type: "orderedList",
        attrs: {
          semloEditorListSequences: {
            version: 1,
            sequences: [
              { id: "A", start: startA, origin: "initial" },
              { id: "B", start: startB, origin: "restart" },
            ],
          },
          ...(link ? { semloEditorListSequenceLink: link } : {}),
        },
        content: names.map((text, index) => ({
          type: "listItem",
          attrs: { semloEditorListIndent: 0, semloEditorListSequence: index % 2 ? "B" : "A" },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      });
      const middle = list(
        ["甲", "乙", "丙", "丁", "戊"],
        version ? 2 : 1,
        version ? 2 : 1,
        version ? `v${version}:left:right` : null,
      );
      const content = version
        ? [
            list(["前甲", "前乙"], 1, 1, `v${version}:_:left`),
            { type: "paragraph", content: [{ type: "text", text: "间隔一" }] },
            middle,
            version === 3
              ? { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "间隔二" }] }
              : { type: "paragraph", content: [{ type: "text", text: "间隔二" }] },
            list(["后甲", "后乙"], 5, 4, `v${version}:right:_`),
          ]
        : [middle, { type: "paragraph", content: [{ type: "text", text: "尾段" }] }];
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: { type: "doc", content },
        onChange(snapshot) {
          window.taskConversionEditor?.setContent(snapshot.html);
        },
      });
    }, sample);
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const select = async () => {
      await page.evaluate(({ first, last, reverse }) => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = -1,
          to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === first) from = pos + 1;
          if (node.isTextblock && node.textContent === last) to = pos + node.nodeSize - 1;
        });
        if (from < 0 || to < 0) throw new Error("未找到交错序列目标");
        editor.view.focus();
        editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
      }, sample);
    };
    const values = () =>
      page
        .locator(".semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value));
    const before = await snapshot();
    if (sample.block) {
      await page.getByText(sample.first, { exact: true }).hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
      await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "无序列表", exact: true }).click();
    } else {
      await select();
      const button = page.getByRole("button", {
        name: sample.kind === "taskList" ? "待办事项" : "无序列表",
        exact: true,
      });
      if (!(await button.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
      await expect(button).toBeEnabled();
      await button.click();
    }
    const after = await snapshot();
    const converted = after.json.content!.find((node) => node.type === sample.kind)!;
    const hints = converted.content!.map((node) => JSON.parse(node.attrs!.semloEditorListSequenceConversion));
    const selectedIds = sample.last === "乙" ? ["B"] : ["B", "A"];
    expect(hints.map((hint) => hint[2])).toEqual(selectedIds);
    expect(new Set(hints.map((hint) => hint[1])).size).toBe(1);
    expect(await values()).toEqual(
      sample.version
        ? sample.last === "乙"
          ? [1, 1, 2, 3, 2, 4, 5, 3]
          : [1, 1, 2, 2, 3, 4, 3]
        : sample.last === "乙"
          ? [1, 2, 1, 3]
          : [1, 1, 2],
    );
    for (const value of [after.json, after.html]) {
      const loaded = await page.evaluate((content) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(content);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, value);
      expect(loaded).toEqual(after.json);
    }
    await select();
    const ordered = page.getByRole("button", { name: "有序列表", exact: true });
    if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await ordered.click();
    const restored = await snapshot();
    expect(restored.text).toBe(before.text);
    expect(restored.json.content?.map((node) => node.type)).toEqual(before.json.content?.map((node) => node.type));
    expect(await values()).toEqual(sample.version ? [1, 1, 2, 2, 3, 3, 4, 5, 4] : [1, 1, 2, 2, 3]);
    expect(JSON.stringify(restored.json)).not.toContain("semloEditorListSequenceConversion");
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
  });
}

test("交错转换项拆分后保留身份并接回编号", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const content = ["甲", "乙", "丙", "丁", "戊"].map((text, index) => ({
      type: "listItem",
      attrs: { semloEditorListSequence: index % 2 ? "B" : "A" },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    }));
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: {
              semloEditorListSequences: {
                version: 1,
                sequences: [
                  { id: "A", start: 1, origin: "initial" },
                  { id: "B", start: 1, origin: "restart" },
                ],
              },
            },
            content,
          },
        ],
      },
      onChange(snapshot) {
        window.taskConversionEditor?.setContent(snapshot.html);
      },
    });
  });
  const select = (first: string, last: string, end = false) =>
    page.evaluate(
      ({ first, last, end }) => {
        const editor = window.__semloRequireFixture("taskConversionEditor").editor;
        let from = -1,
          to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === first) from = pos + 1 + (end ? node.content.size : 0);
          if (node.isTextblock && node.textContent === last) to = pos + 1 + node.content.size;
        });
        if (from < 0 || to < 0) throw new Error("未找到转换项");
        editor.commands.setTextSelection({ from, to });
        editor.view.focus();
      },
      { first, last, end },
    );
  const clickButton = async (name: string) => {
    const button = page.getByRole("button", { name, exact: true });
    if (!(await button.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await button.click();
  };
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
  await select("乙", "乙");
  await clickButton("待办事项");
  await select("乙", "乙", true);
  await page.keyboard.press("Enter");
  await page.keyboard.type("续乙");
  const split = await snapshot();
  const items = split.json.content!.find((node) => node.type === "taskList")!.content!;
  expect(items.map((item) => JSON.parse(item.attrs!.semloEditorListSequenceConversion)[2])).toEqual(["B", "B"]);
  await select("乙", "续乙");
  await clickButton("有序列表");
  const restored = await snapshot();
  expect(restored.json.content![0].content!.map((item) => item.attrs!.semloEditorListSequence)).toEqual([
    "A",
    "B",
    "B",
    "A",
    "B",
    "A",
  ]);
  expect(
    await page
      .locator(".semlo-editor-prose > ol > li")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value)),
  ).toEqual([1, 1, 2, 2, 3, 3]);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(split.json);
});

test("交错转换间隔随完整续接跨编辑器复制并换新身份", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(origin);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const list = (start: number, link: string, names: string[]) => ({
      type: "orderedList",
      attrs: {
        semloEditorListSequences: {
          version: 1,
          sequences: [
            { id: "A", start, origin: "initial" },
            { id: "B", start, origin: "restart" },
          ],
        },
        semloEditorListSequenceLink: link,
      },
      content: names.map((text, index) => ({
        type: "listItem",
        attrs: { semloEditorListSequence: index ? "B" : "A" },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    });
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: {
        type: "doc",
        content: [
          list(1, "v2:_:edge", ["甲", "乙"]),
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false, semloEditorListSequenceConversion: JSON.stringify([1, "edge", "B"]) },
                content: [{ type: "paragraph", content: [{ type: "text", text: "间隔" }] }],
              },
            ],
          },
          list(2, "v2:edge:_", ["丙", "丁"]),
        ],
      },
    });
    window.taskConversionEditor.editor.commands.focus();
    window.taskConversionEditor.editor.commands.selectAll();
  });
  await page.keyboard.press("ControlOrMeta+c");
  await page.evaluate(() => {
    window.__semloRequireFixture("taskConversionEditor").destroy();
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
    });
    window.taskConversionEditor.editor.commands.focus();
  });
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot().json);
  const left = pasted.content!.find((node) => node.type === "orderedList")!;
  const right = pasted.content!.filter((node) => node.type === "orderedList")[1];
  const task = pasted.content!.find((node) => node.type === "taskList")!;
  const hint = JSON.parse(task.content![0].attrs!.semloEditorListSequenceConversion);
  expect(hint[2]).toBe("B");
  expect(hint[1]).not.toBe("edge");
  expect(left.attrs!.semloEditorListSequenceLink).toBe(`v2:_:${hint[1]}`);
  expect(right.attrs!.semloEditorListSequenceLink).toBe(`v2:${hint[1]}:_`);
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
