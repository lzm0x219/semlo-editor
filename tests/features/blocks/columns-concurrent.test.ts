import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { Transaction } from "@tiptap/pm/state";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    concurrentColumnsEditor?: EditorController;
    closeColumnsHistory?: (transaction: Transaction) => Transaction;
    observedBackspaceSelection?: unknown;
  }
}

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/blocks/columns-concurrent-fixture.ts"));
});
afterAll(async () => closeServer?.());

test("Enter on an empty highlight paragraph keeps the new paragraph inside the block", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [{ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "高亮乙" }] }] }],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("高亮乙").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("concurrentColumnsEditor");
    editor.view.dispatch(window.__semloRequireFixture("closeColumnsHistory")(editor.state.tr));
  });
  await page.keyboard.press("Enter");
  await expect(block.locator("p")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(block.locator("p")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(block.locator("p")).toHaveCount(3);
  await page.keyboard.insertText("块后文字");
  await expect(block.locator("p")).toHaveCount(3);
  await expect(block.locator("p").last()).toHaveText("块后文字");
});

test("Backspace at the start of a highlight block leaves it intact", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "高亮甲" }] }] },
      ],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("高亮甲").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(block).toContainText("高亮甲");
  await expect(page.locator(".ProseMirror > p").first()).toHaveText("前文");
});

test("Backspace merges adjacent paragraphs inside a highlight", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "高亮甲" }] },
            { type: "paragraph", content: [{ type: "text", text: "高亮乙" }] },
          ],
        },
      ],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("高亮乙").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(block.locator("p")).toHaveCount(1);
  await expect(block.locator("p")).toHaveText("高亮甲高亮乙");
});

test("Backspace in an empty highlight leaves the block intact", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        { type: "callout", content: [{ type: "paragraph" }] },
      ],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.locator("p").click();
  await page.keyboard.press("Backspace");
  await expect(block).toBeVisible();
  await expect(page.locator(".ProseMirror > p").first()).toHaveText("前文");
});

test("Delete at the end of a highlight does not merge the next highlight", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            {
              type: "detailsContent",
              content: ["第一块", "第二块"].map((text) => ({
                type: "callout",
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
          ],
        },
      ],
    }),
  );
  const blocks = page.locator("aside[data-semlo-editor-callout]");
  await blocks.first().getByText("第一块").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0)).toHaveText("第一块");
  await expect(blocks.nth(1)).toHaveText("第二块");
});

test("Delete at the end of a highlight preserves a following date", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "终块" }] }] },
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-04" } }] },
      ],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("终块").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  await expect(block).toHaveText("终块");
  await expect(page.locator(".ProseMirror > p .semlo-editor-date-node")).toHaveCount(1);
});

test("Delete at the end of a highlight preserves the following text paragraph", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "边界块" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      ],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("边界块").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  await expect(block).toHaveText("边界块");
  await expect(page.locator(".ProseMirror > p")).toHaveText("正文");
});

for (const nextAction of ["type", "enter", "backspace", "delete", "delete-slow"])
  test(`Backspace between highlights then ${nextAction} follows the observed behavior`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
    await page.evaluate((nextAction) => {
      const editor = window.__semloRequireFixture("concurrentColumnsEditor");
      editor.setContent({
        type: "doc",
        content: [
          {
            type: "details",
            attrs: { open: true },
            content: [
              { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
              {
                type: "detailsContent",
                content: [
                  { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "前块" }] }] },
                  { type: "paragraph" },
                  { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "后块" }] }] },
                  ...(nextAction.startsWith("delete")
                    ? [{ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "末块" }] }] }]
                    : []),
                ],
              },
            ],
          },
        ],
      });
    }, nextAction);
    await page.locator('[data-type="detailsContent"] > aside + p').click();
    const before = await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json,
    );
    await page.keyboard.press("Backspace");
    await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(nextAction.startsWith("delete") ? 3 : 2);
    const blocks = await page.evaluate(() => {
      const details = window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json.content?.[0];
      return details?.content?.[1]?.content?.map((node) => node.type);
    });
    expect(blocks).toEqual(
      nextAction.startsWith("delete") ? ["callout", "callout", "callout"] : ["callout", "callout"],
    );
    const afterFirst = await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json,
    );
    if (nextAction === "type") {
      await page.keyboard.type("X");
      await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(2);
      await expect(page.locator('[data-type="detailsContent"] > aside + p')).toHaveText("X");
    } else if (nextAction === "enter") {
      await page.keyboard.press("Enter");
      await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(2);
      await expect(page.locator('[data-type="detailsContent"] > aside + p')).toHaveText("");
    } else if (nextAction.startsWith("delete")) {
      if (nextAction === "delete-slow") await page.waitForTimeout(700);
      await page.keyboard.press("Delete");
      await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(2);
      await expect(page.locator("aside[data-semlo-editor-callout]").first()).toContainText("前块");
      await expect(page.locator("aside[data-semlo-editor-callout]").last()).toContainText("末块");
    } else {
      await page.keyboard.press("Backspace");
      await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(1);
      await expect(page.locator("aside[data-semlo-editor-callout]")).toContainText("后块");
      expect(
        await page.evaluate(() =>
          window
            .__semloRequireFixture("concurrentColumnsEditor")
            .getSnapshot()
            .json.content?.[0]?.content?.[1]?.content?.map((node) => node.type),
        ),
      ).toEqual(["paragraph", "callout"]);
    }
    await page.keyboard.press("ControlOrMeta+z");
    if (["type", "enter", "delete"].includes(nextAction)) {
      expect(
        await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json),
      ).toEqual(before);
    } else {
      expect(
        await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json),
      ).toEqual(afterFirst);
      await page.keyboard.press("ControlOrMeta+z");
      expect(
        await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json),
      ).toEqual(before);
    }
  });

test("Backspace at a following paragraph removes the preceding highlight and can be undone", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            {
              type: "detailsContent",
              content: [
                { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "边界块" }] }] },
                { type: "paragraph", content: [{ type: "text", text: "正文" }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.locator(".ProseMirror").getByText("正文", { exact: true }).click();
  await page.keyboard.press("Home");
  const before = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("concurrentColumnsEditor");
    controller.editor.view.dispatch(window.__semloRequireFixture("closeColumnsHistory")(controller.editor.state.tr));
    const view = controller.editor.view;
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (transaction) => {
      if (transaction.docChanged && window.observedBackspaceSelection === undefined)
        window.observedBackspaceSelection = view.state.selection.toJSON();
      dispatch(transaction);
    };
    return controller.getSnapshot();
  });
  await page.keyboard.press("Backspace");
  const originalSelection = await page.evaluate(() => window.observedBackspaceSelection);
  expect(originalSelection).toBeDefined();
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  await expect(page.locator(".ProseMirror").getByText("正文", { exact: true })).toBeVisible();
  const after = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveText("边界块");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.toJSON()),
  ).toEqual(originalSelection);
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before.json,
  );
  for (const snapshot of [before, after]) {
    for (const value of [snapshot.json, snapshot.html]) {
      const result = await page.evaluate((content) => {
        const editor = window.__semloRequireFixture("concurrentColumnsEditor");
        editor.setContent(content);
        return editor.getSnapshot().json;
      }, value);
      expect(result).toEqual(snapshot.json);
    }
  }
});

test("Backspace after a top-level highlight removes it and undo restores it", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "顶层高亮" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "顶层后文" }] },
      ],
    }),
  );
  await page.locator(".ProseMirror").getByText("顶层后文").click();
  await page.keyboard.press("Home");
  const before = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("concurrentColumnsEditor");
    const { editor } = controller;
    const view = editor.view;
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (transaction) => {
      if (transaction.docChanged && window.observedBackspaceSelection === undefined)
        window.observedBackspaceSelection = view.state.selection.toJSON();
      dispatch(transaction);
    };
    return controller.getSnapshot();
  });
  await page.keyboard.press("Backspace");
  const selection = await page.evaluate(() => window.observedBackspaceSelection);
  expect(selection).toBeDefined();
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("顶层后文");
  const after = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveText("顶层高亮");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.toJSON()),
  ).toEqual(selection);
  for (const snapshot of [before, after]) {
    for (const content of [snapshot.json, snapshot.html]) {
      const restored = await page.evaluate((value) => {
        const controller = window.__semloRequireFixture("concurrentColumnsEditor");
        controller.setContent(value);
        return controller.getSnapshot().json;
      }, content);
      expect(restored).toEqual(snapshot.json);
    }
  }
  await page.evaluate((snapshot) => {
    const controller = window.__semloRequireFixture("concurrentColumnsEditor");
    snapshot.content![0].content![0].content![0].marks = [{ type: "bold" }];
    snapshot.content![0].content!.push({ type: "paragraph", content: [{ type: "text", text: "第二段" }] });
    controller.setContent(snapshot);
  }, before.json);
  await page.locator(".ProseMirror").getByText("顶层后文").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toContainText("第二段");
  await expect(page.locator("aside[data-semlo-editor-callout] strong")).toHaveText("顶层高亮");
});

test("Backspace removes a measured mixed highlight and undo restores all content", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "斜体", marks: [{ type: "italic" }] }] },
            { type: "paragraph", content: [{ type: "text", text: "第二段", marks: [{ type: "bold" }] }] },
            { type: "paragraph", content: [{ type: "text", text: "第四段" }] },
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表项" }] }] },
              ],
            },
            { type: "paragraph" },
            { type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "测试状态", color: 0 } }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    }),
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.evaluate(() => {
    const view = window.__semloRequireFixture("concurrentColumnsEditor").editor.view;
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (transaction) => {
      if (transaction.docChanged && window.observedBackspaceSelection === undefined)
        window.observedBackspaceSelection = view.state.selection.toJSON();
      dispatch(transaction);
    };
  });
  await page.keyboard.press("Backspace");
  const selection = await page.evaluate(() => window.observedBackspaceSelection);
  expect(selection).toBeDefined();
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  const after = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+z");
  const block = page.locator("aside[data-semlo-editor-callout]");
  await expect(block.locator("strong")).toHaveCount(1);
  await expect(block.locator("em")).toHaveText("斜体");
  await expect(block).toContainText("第二段");
  await expect(block).toContainText("测试状态");
  await expect(block.locator("li")).toContainText("列表项");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.toJSON()),
  ).toEqual(selection);
  const restored = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  expect(restored.json).toEqual(before.json);
  for (const snapshot of [restored, after]) {
    for (const content of [snapshot.json, snapshot.html]) {
      const result = await page.evaluate((value) => {
        const controller = window.__semloRequireFixture("concurrentColumnsEditor");
        controller.setContent(value);
        return controller.getSnapshot().json;
      }, content);
      expect(result).toEqual(snapshot.json);
    }
  }
  await page.evaluate((value) => {
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            { type: "detailsContent", content: value.content },
          ],
        },
      ],
    });
  }, before.json);
  const foldBefore = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.evaluate(() => {
    window.observedBackspaceSelection = undefined;
  });
  await page.keyboard.press("Backspace");
  const foldSelection = await page.evaluate(() => window.observedBackspaceSelection);
  expect(foldSelection).toBeDefined();
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  const foldAfter = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+z");
  await expect(block.locator("strong")).toHaveCount(1);
  await expect(block.locator("em")).toHaveText("斜体");
  await expect(block.locator("li")).toContainText("列表项");
  await expect(block).toContainText("测试状态");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.toJSON()),
  ).toEqual(foldSelection);
  for (const snapshot of [foldBefore, foldAfter]) {
    for (const content of [snapshot.json, snapshot.html]) {
      const result = await page.evaluate((value) => {
        const controller = window.__semloRequireFixture("concurrentColumnsEditor");
        controller.setContent(value);
        return controller.getSnapshot().json;
      }, content);
      expect(result).toEqual(snapshot.json);
    }
  }
});

test("Backspace removes two- or three-paragraph highlights in a fold and undo restores them", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            {
              type: "detailsContent",
              content: [
                {
                  type: "callout",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
                    { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
                  ],
                },
                { type: "paragraph", content: [{ type: "text", text: "后文" }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("后文");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toContainText("第一段");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toContainText("第二段");
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("concurrentColumnsEditor");
    const value = controller.getSnapshot().json;
    const body = value.content![0].content![1];
    body.content![0].content![0].content![0].marks = [{ type: "bold" }];
    body.content![0].content!.push({ type: "paragraph", content: [{ type: "text", text: "第三段" }] });
    controller.setContent(value);
  });
  await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("concurrentColumnsEditor");
    editor.view.dispatch(window.__semloRequireFixture("closeColumnsHistory")(editor.state.tr));
  });
  await page.keyboard.press("Backspace");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toContainText("第三段");
  await expect(page.locator("aside[data-semlo-editor-callout] strong")).toHaveText("第一段");
});

for (const { count, marks, mixed, innerMixed = false } of [
  { count: 7, marks: [], mixed: false },
  { count: 12, marks: ["bold"], mixed: false },
  { count: 12, marks: ["italic"], mixed: false },
  { count: 12, marks: ["bold", "italic"], mixed: false },
  { count: 12, marks: ["bold", "italic"], mixed: true },
  { count: 12, marks: [], mixed: false, innerMixed: true },
  { count: 12, marks: ["underline"], mixed: false, innerMixed: true },
])
  test(`Backspace removes a ${count}-paragraph highlight before ${innerMixed ? `mixed inner formatting and ${marks.join("+") || "plain"}` : mixed ? "mixed" : marks.join("+") || "plain"} text and undo restores it`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
    await page.evaluate(
      ({ count, marks, mixed, innerMixed }) =>
        window.__semloRequireFixture("concurrentColumnsEditor").setContent({
          type: "doc",
          content: [
            {
              type: "details",
              attrs: { open: true },
              content: [
                { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
                {
                  type: "detailsContent",
                  content: [
                    {
                      type: "callout",
                      content: Array.from({ length: count }, (_, i) => i).map((i) => ({
                        type: "paragraph",
                        content:
                          innerMixed && i === 0
                            ? [
                                { type: "text", text: "段", marks: [{ type: "italic" }] },
                                { type: "text", text: "1", marks: [{ type: "bold" }, { type: "italic" }] },
                              ]
                            : [
                                {
                                  type: "text",
                                  text: `段${i + 1}`,
                                  ...(count === 12 && i === 0 ? { marks: [{ type: "bold" }, { type: "italic" }] } : {}),
                                },
                              ],
                      })),
                    },
                    {
                      type: "paragraph",
                      content: mixed
                        ? [
                            { type: "text", text: "后", marks: [{ type: "bold" }, { type: "italic" }] },
                            { type: "text", text: "文", marks: [{ type: "italic" }] },
                          ]
                        : [{ type: "text", text: "后文", marks: marks.map((type) => ({ type })) }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      { count, marks, mixed, innerMixed },
    );
    const before = await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json,
    );
    await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText("后文");
    await page.keyboard.press("ControlOrMeta+z");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json),
    ).toEqual(before);
  });

test("Backspace does not delete a highlight with an unverified structure", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            {
              type: "detailsContent",
              content: [
                {
                  type: "callout",
                  content: Array.from({ length: 13 }, (_, i) => `段${i + 1}`).map((text) => ({
                    type: "paragraph",
                    content: [{ type: "text", text }],
                  })),
                },
                { type: "paragraph", content: [{ type: "text", text: "后文" }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  for (const text of [...Array.from({ length: 13 }, (_, i) => `段${i + 1}`), "后文"])
    await expect(page.locator(".ProseMirror")).toContainText(text);
});

test("Backspace deletes a single italic highlight in a fold and undo restores its format", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            {
              type: "detailsContent",
              content: [
                {
                  type: "callout",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "斜体内容", marks: [{ type: "italic" }] }] },
                  ],
                },
                { type: "paragraph", content: [{ type: "text", text: "后文" }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.locator(".ProseMirror").getByText("后文", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(page.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("后文");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("aside[data-semlo-editor-callout] em")).toHaveText("斜体内容");
});

test("highlight keyboard handling also preserves a surrounding column", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorColumns",
          content: [
            {
              type: "semloEditorColumn",
              content: [
                { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "提示" }] }] },
              ],
            },
            {
              type: "semloEditorColumn",
              content: [{ type: "paragraph", content: [{ type: "text", text: "另一栏" }] }],
            },
          ],
        },
      ],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("提示").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(block).toContainText("提示");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(block.locator("p")).toHaveCount(3);
  await expect(page.getByText("另一栏")).toBeVisible();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  for (const content of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((value) => {
      const editor = window.__semloRequireFixture("concurrentColumnsEditor");
      editor.setContent(value);
      return editor.getSnapshot().json;
    }, content);
    expect(restored).toEqual(snapshot.json);
  }
});

test("highlight palette changes are undoable and round-trip through HTML", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() => localStorage.setItem("semlo-editor.callout-tone.v1", "green"));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [{ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "提示" }] }] }],
    }),
  );
  const block = page.locator("aside[data-semlo-editor-callout]");
  await block.getByText("提示").click();
  const palette = page.getByRole("toolbar", { name: "高亮块配色" });
  await expect(palette.getByRole("button")).toHaveCount(10);
  expect(await page.evaluate(() => localStorage.getItem("semlo-editor.callout-tone.v1"))).toBe("green");
  await palette.getByRole("button", { name: "浅蓝" }).click();
  expect(await page.evaluate(() => localStorage.getItem("semlo-editor.callout-tone.v1"))).toBe("info");
  await palette.getByRole("button", { name: "粉红" }).click();
  await expect(block).toHaveAttribute("data-tone", "pink");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+z");
  await expect(block).toHaveAttribute("data-tone", "info");
  expect(await page.evaluate(() => localStorage.getItem("semlo-editor.callout-tone.v1"))).toBe("pink");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(block).toHaveAttribute("data-tone", "pink");
  const restored = await page.evaluate((html) => {
    const editor = window.__semloRequireFixture("concurrentColumnsEditor");
    editor.setContent(html);
    return editor.getSnapshot().json;
  }, snapshot.html);
  expect(restored).toEqual(snapshot.json);
  expect(await page.evaluate(() => localStorage.getItem("semlo-editor.callout-tone.v1"))).toBe("pink");
});

test("an external width update during a drag is not overwritten by the stale gesture", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const handle = page.getByRole("separator").first();
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing resize handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("concurrentColumnsEditor");
    const node = editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, widths: [0.2, 0.3, 0.5] }));
  });
  await page.mouse.up();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  expect(snapshot.json.content?.[0].attrs?.widths).toEqual([0.2, 0.3, 0.5]);
  for (const value of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("concurrentColumnsEditor").setContent(content);
      return window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json;
    }, value);
    expect(restored).toEqual(snapshot.json);
  }
});

test("a normal resize changes adjacent columns and remains undoable", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const handle = page.getByRole("separator").first();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing resize handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const widths = await page.evaluate(
    () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json.content?.[0].attrs?.widths,
  );
  expect(widths[0]).toBeGreaterThan(1 / 3);
  expect(widths[1]).toBeLessThan(1 / 3);
  expect(widths[2]).toBeCloseTo(1 / 3);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json.content?.[0].attrs?.widths,
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json.content?.[0].attrs?.widths,
    ),
  ).toEqual(widths);
});

test("Escape cancels a column resize without persisting the preview", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const handle = page.getByRole("separator").first();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing resize handle");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json);
  const grid = page.locator(".semlo-editor-columns-node > .semlo-editor-columns");
  const original = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).not.toBe(original);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).toBe(original);
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("a fold nested in a column remains editable and retains its state in HTML and JSON", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const column = page.locator(".semlo-editor-column").first();
  const body = column.locator('[data-type="detailsContent"]');
  await expect(body).toBeVisible();
  await body.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type("ABC");
  await expect(body).toContainText("折叠正文ABC");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(body).toContainText("折叠正文");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  await column.getByRole("button", { name: "收起内容" }).click();
  await expect(body).toBeHidden();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  for (const value of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("concurrentColumnsEditor").setContent(content);
      return window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json;
    }, value);
    expect(restored).toEqual(snapshot.json);
    await expect(column.locator('[data-type="detailsContent"]')).toBeHidden();
  }
  await column.getByRole("button", { name: "展开内容" }).click();
  await expect(column.locator('[data-type="detailsContent"]')).toContainText("折叠正文ABC");
});

test("Home then ArrowRight permits typing in fold-body paragraphs and headings", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  for (const level of [0, 1, 2, 3, 4, 5, 6]) {
    await page.evaluate(
      (value) =>
        window.__semloRequireFixture("concurrentColumnsEditor").setContent({
          type: "doc",
          content: [
            {
              type: "details",
              attrs: { open: true },
              content: [
                { type: "detailsSummary" },
                {
                  type: "detailsContent",
                  content: [
                    value === 0
                      ? { type: "paragraph", content: [{ type: "text", text: "甲乙丙" }] }
                      : { type: "heading", attrs: { level: value }, content: [{ type: "text", text: "甲乙丙" }] },
                  ],
                },
              ],
            },
          ],
        }),
      level,
    );
    const heading = page.locator(`[data-type="detailsContent"] ${level === 0 ? "p" : `h${level}`}`);
    await heading.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("a");
    await expect(heading).toHaveText("甲a乙丙");
  }
});

test("fold-body selection with Shift+ArrowRight still replaces only the selected character", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary" },
            {
              type: "detailsContent",
              content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "甲乙丙" }] }],
            },
          ],
        },
      ],
    }),
  );
  const heading = page.locator('[data-type="detailsContent"] h1');
  await heading.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("a");
  await expect(heading).toHaveText("a乙丙");
});

test("undo after Enter in a closed fold restores the closed state and original body", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const column = page.locator(".semlo-editor-column").first();
  const body = column.locator('[data-type="detailsContent"]');
  await column.getByRole("button", { name: "收起内容" }).click();
  await column.locator("summary").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(body).toBeVisible();
  await expect(body.locator("p")).toHaveCount(2);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(body).toBeHidden();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  await expect(body).toBeVisible();
  await expect(body.locator("p")).toHaveCount(2);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  await column.getByRole("button", { name: "展开内容" }).click();
  await expect(body.locator("p")).toHaveCount(1);
  await expect(body).toContainText("折叠正文");
});

test("Enter replaces the selected title text and undo restores the title and closed fold", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const column = page.locator(".semlo-editor-column").first();
  const body = column.locator('[data-type="detailsContent"]');
  await column.getByRole("button", { name: "收起内容" }).click();
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("concurrentColumnsEditor");
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "detailsSummary") pos = at;
    });
    editor.commands.focus();
    editor.commands.setTextSelection({ from: pos + 1, to: pos + 1 + 4 });
  });
  await page.keyboard.press("Enter");
  await expect(column.locator("summary")).toHaveText("");
  await expect(body).toBeVisible();
  await expect(body.locator("p")).toHaveCount(2);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(column.locator("summary")).toHaveText("折叠标题");
  await expect(body).toBeHidden();
});

for (const open of [true, false]) {
  test(`Enter splits an ${open ? "open" : "closed"} fold title and moves the suffix before its body`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
    const column = page.locator(".semlo-editor-column").first();
    if (!open) await column.getByRole("button", { name: "收起内容" }).click();
    await column.locator("summary").click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.$head.parent.type.name ===
        "detailsSummary",
    );
    const before = await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json,
    );
    await page.evaluate(() => {
      const { editor } = window.__semloRequireFixture("concurrentColumnsEditor");
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "detailsSummary") pos = at;
      });
      editor.commands.setTextSelection(pos + 3);
    });
    await page.keyboard.press("Enter");
    const summary = column.locator("summary");
    const body = column.locator('[data-type="detailsContent"]');
    await expect(summary).toHaveText("折叠");
    await expect(body.locator("p")).toHaveText(["标题", "折叠正文"]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json),
    ).toEqual(before);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
    ).toBe(true);
    await expect(summary).toHaveText("折叠");
    await expect(body.locator("p")).toHaveText(["标题", "折叠正文"]);
  });
}

test("splitting a fold title reuses an existing empty body paragraph", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("concurrentColumnsEditor")
      .setContent('<details open><summary>标题内容</summary><div data-type="detailsContent"><p></p></div></details>'),
  );
  const summary = page.locator("summary");
  await summary.click();
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.$head.parent.type.name ===
      "detailsSummary",
  );
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("concurrentColumnsEditor");
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "detailsSummary") pos = at;
    });
    editor.commands.setTextSelection(pos + 3);
  });
  await page.keyboard.press("Enter");
  await expect(summary).toHaveText("标题");
  await expect(page.locator('[data-type="detailsContent"] p')).toHaveText(["内容"]);
});

test("Shift+Enter inserts a line break in a closed fold title without opening its body", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  const column = page.locator(".semlo-editor-column").first();
  const body = column.locator('[data-type="detailsContent"]');
  await column.getByRole("button", { name: "收起内容" }).click();
  const summary = column.locator("summary");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  await summary.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  const withBreak = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  expect(withBreak.json).not.toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot())).json,
  ).toEqual(before.json);
  await expect(body).toBeHidden();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot())).json,
  ).toEqual(withBreak.json);
  await page.keyboard.type("换行");
  await expect(body).toBeHidden();
  await expect(summary.locator("br")).toHaveCount(1);
  await expect(summary).toHaveText("折叠标题换行");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  for (const value of [snapshot.json, snapshot.html, before.json, before.html]) {
    const result = await page.evaluate((content) => {
      const controller = window.__semloRequireFixture("concurrentColumnsEditor");
      controller.setContent("<p>临时</p>");
      controller.setContent(content);
      return controller.getSnapshot().json;
    }, value);
    expect(result).toEqual(value === snapshot.json || value === snapshot.html ? snapshot.json : before.json);
    await expect(page.locator('[data-type="detailsContent"]')).toBeHidden();
  }
});

test("Backspace removes a whole emoji or combining sequence from a fold title", async ({ page }) => {
  for (const character of ["🦊", "👨‍👩‍👧‍👦", "e\u0301"]) {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
    const summary = page.locator(".semlo-editor-column").first().locator("summary");
    await summary.click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.$head.parent.type.name ===
        "detailsSummary",
    );
    await page.keyboard.press("End");
    await page.evaluate((text) => {
      const editor = window.__semloRequireFixture("concurrentColumnsEditor").editor;
      editor.commands.insertContent(text);
    }, character);
    expect(
      await page.evaluate(() => {
        const { $head } = window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection;
        return { parent: $head.parent.type.name, offset: $head.parentOffset, content: $head.parent.textContent };
      }),
    ).toEqual({ parent: "detailsSummary", offset: 4 + character.length, content: `折叠标题${character}` });
    await page.keyboard.press("Backspace");
    await expect(summary).toHaveText("折叠标题");
    const text = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().text);
    expect(text).not.toContain("�");
  }
});

for (const open of [true, false]) {
  test(`Backspace at the start of an ${open ? "open" : "closed"} fold title leaves the card intact`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
    const column = page.locator(".semlo-editor-column").first();
    if (!open) await column.getByRole("button", { name: "收起内容" }).click();
    await column.locator("summary").click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("concurrentColumnsEditor").editor.state.selection.$head.parent.type.name ===
        "detailsSummary",
    );
    await page.keyboard.press("Home");
    const before = await page.evaluate(
      () => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json,
    );
    await page.keyboard.press("Backspace");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json),
    ).toEqual(before);
    await expect(column.locator('[data-type="details"]')).toHaveCount(1);
  });
}

test("Backspace at the first body paragraph merges it into the fold title", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("concurrentColumnsEditor")
      .setContent(
        '<details open><summary>标题</summary><div data-type="detailsContent"><p>正文</p><p>后续</p></div></details>',
      ),
  );
  const summary = page.locator("summary");
  const body = page.locator('[data-type="detailsContent"]');
  await body.locator("p").first().click();
  await page.keyboard.press("Home");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json);
  await page.keyboard.press("Backspace");
  await expect(summary).toHaveText("标题正文");
  await expect(body.locator("p")).toHaveCount(1);
  await expect(body).toContainText("后续");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("Delete at the end of an open fold title merges the first body paragraph", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("concurrentColumnsEditor")
      .setContent(
        '<details open><summary>标题</summary><div data-type="detailsContent"><p>正文</p><p>后续</p></div></details>',
      ),
  );
  const summary = page.locator("summary");
  const body = page.locator('[data-type="detailsContent"]');
  await summary.click();
  await page.keyboard.press("End");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json);
  await page.keyboard.press("Delete");
  await expect(summary).toHaveText("标题正文");
  await expect(body.locator("p")).toHaveCount(1);
  await expect(body).toContainText("后续");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("Delete at the end of a closed fold title merges hidden text without opening the fold", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("concurrentColumnsEditor")
      .setContent(
        '<details><summary>标题</summary><div data-type="detailsContent"><p>正文</p><p>后续</p></div></details>',
      ),
  );
  const summary = page.locator("summary");
  const body = page.locator('[data-type="detailsContent"]');
  await summary.click();
  await page.keyboard.press("End");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json);
  await page.keyboard.press("Delete");
  await expect(summary).toHaveText("标题正文");
  await expect(body).toBeHidden();
  await expect(body.locator("p")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("a body paragraph containing a status is not lost when it cannot merge into the title", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("concurrentColumnsEditor").setContent({
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
            {
              type: "detailsContent",
              content: [
                { type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "状态", color: 0 } }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.locator("summary").click();
  await page.keyboard.press("End");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json);
  await page.keyboard.press("Delete");
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before,
  );
  await expect(page.getByRole("button", { name: "状态：状态" })).toBeVisible();
});

test("merging the only body paragraph leaves an empty body that Enter can reopen", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("concurrentColumnsEditor")
      .setContent('<details open><summary>标题</summary><div data-type="detailsContent"><p>正文</p></div></details>'),
  );
  const body = page.locator('[data-type="detailsContent"]');
  await body.locator("p").click();
  await page.keyboard.press("Home");
  const before = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json);
  await page.keyboard.press("Backspace");
  await expect(page.locator("summary")).toHaveText("标题正文");
  await expect(body.locator("p")).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").getSnapshot().json)).toEqual(
    before,
  );
  expect(
    await page.evaluate(() => window.__semloRequireFixture("concurrentColumnsEditor").editor.commands.redo()),
  ).toBe(true);
  for (const value of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((content) => {
      const controller = window.__semloRequireFixture("concurrentColumnsEditor");
      controller.setContent("<p>临时</p>");
      controller.setContent(content);
      return controller.getSnapshot().json;
    }, value);
    expect(restored).toEqual(snapshot.json);
  }
  await page.locator("summary").click();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-type="detailsContent"] p')).toHaveCount(1);
  await page.keyboard.type("新正文");
  await expect(page.locator('[data-type="detailsContent"] p')).toHaveText("新正文");
});

for (const open of [true, false]) {
  test(`Enter reuses an empty ${open ? "open" : "closed"} fold body`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.concurrentColumnsEditor));
    await page.evaluate(
      (isOpen) =>
        window
          .__semloRequireFixture("concurrentColumnsEditor")
          .setContent(
            `<details ${isOpen ? "open" : ""}><summary>标题</summary><div data-type="detailsContent"><p></p></div></details>`,
          ),
      open,
    );
    const body = page.locator('[data-type="detailsContent"]');
    await page.locator("summary").click();
    await page.keyboard.press("Enter");
    await expect(body).toBeVisible();
    await expect(body.locator("p")).toHaveCount(1);
    await page.keyboard.type("内容");
    await expect(body.locator("p")).toHaveText("内容");
  });
}
