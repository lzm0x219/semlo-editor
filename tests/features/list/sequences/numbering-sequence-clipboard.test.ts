import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../../packages/core/src/types";
import { installFixtureGuards } from "../../../fixtures/browser/fixture-browser-runtime";
import {
  sequenceClipboardContent,
  sequenceClipboardBoundaryContent,
  sequenceClipboardCrossParentContent,
  sequenceClipboardThreeLevelsContent,
  sequenceClipboardSelectedDeepContent,
  sequenceClipboardOtherDeepContent,
  sequenceClipboardOtherParentDeepContent,
  sequenceClipboardLinkedFlatContent,
} from "../../../fixtures/list/sequences/numbering-sequence-clipboard-content";

declare global {
  interface Window {
    sequenceClipboardSource?: EditorController;
    sequenceClipboardTarget?: EditorController;
    sequenceClipboardEcho?: "json" | "html";
    sequenceClipboardChanges?: number;
  }
}
test.beforeEach(async ({ page }) => installFixtureGuards(page));
async function setup(
  page: Page,
  same = false,
  echo: "json" | "html" = "json",
  five = false,
  boundary: false | 1 | 2 = false,
) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const source = document.createElement('div'); source.id = 'clipboard-sequence-source'; document.body.prepend(source);
    const target = document.createElement('div'); target.id = 'clipboard-sequence-target'; source.after(target);
    window.sequenceClipboardChanges = 0;
    window.sequenceClipboardEcho = ${JSON.stringify(echo)};
    window.sequenceClipboardSource = createEditor({ element: source, outline: false, content: ${JSON.stringify(boundary ? sequenceClipboardBoundaryContent(boundary) : sequenceClipboardContent(same, five))}, onChange(snapshot) {
      window.sequenceClipboardChanges++;
      window.sequenceClipboardSource.setContent(window.sequenceClipboardEcho === 'html' ? snapshot.html : snapshot.json);
    }});
    window.sequenceClipboardTarget = createEditor({ element: target, outline: false, content: '<p>footer</p><p></p>' });
  `,
  });
  await page.waitForFunction(() => Boolean(window.sequenceClipboardTarget));
}
async function select(page: Page, first = "甲开头", last = "丙结尾", firstOffset = 1, lastOffset = 1) {
  await page.evaluate(
    ({ first, last, firstOffset, lastOffset }) => {
      const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (["paragraph", "heading"].includes(node.type.name) && node.textContent === first)
          from = pos + 1 + firstOffset;
        if (["paragraph", "heading"].includes(node.type.name) && node.textContent === last) to = pos + 1 + lastOffset;
      });
      if (from < 0 || to < 0) throw new Error("选区段落不存在");
      editor.commands.setTextSelection({ from, to });
      editor.commands.focus();
    },
    { first, last, firstOffset, lastOffset },
  );
}
async function payload(page: Page, action: "copy" | "cut" = "copy") {
  return page.evaluate((action) => {
    const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
    const data = new DataTransfer();
    data.setData("text/plain", "sentinel");
    data.setData("text/html", "sentinel");
    const event = new ClipboardEvent(action, { clipboardData: data, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return { text: data.getData("text/plain"), html: data.getData("text/html"), trusted: event.isTrusted };
  }, action);
}
const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").getSnapshot());

test("系统复制完整交错续接时正文来源随新关联隔离，单独复制不带来源", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html");
  const list = (link: string, start: number, names: string[]) => ({
    type: "orderedList",
    attrs: {
      semloEditorListSequenceLink: link,
      semloEditorListSequences: {
        version: 1,
        sequences: [
          { id: "A", start, origin: "initial" },
          { id: "B", start, origin: "restart" },
        ],
      },
    },
    content: names.map((text, index) => ({
      type: "listItem",
      attrs: { semloEditorListSequence: index % 2 ? "B" : "A" },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  });
  await page.evaluate((content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content), {
    type: "doc",
    content: [
      list("v1:_:edge", 1, ["甲", "乙"]),
      {
        type: "paragraph",
        attrs: { semloEditorListSequenceConversion: JSON.stringify([1, "edge", "B"]) },
        content: [{ type: "text", text: "中间乙" }],
      },
      {
        type: "paragraph",
        attrs: { semloEditorListSequenceConversion: JSON.stringify([1, "edge", "A"]) },
        content: [{ type: "text", text: "中间甲" }],
      },
      list("v1:edge:_", 2, ["丙", "丁"]),
    ],
  });
  const before = await snapshot(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
    editor.commands.focus();
    editor.commands.selectAll();
  });
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceClipboardTarget").editor;
    editor.commands.focus();
    editor.commands.selectAll();
  });
  await expect(page.locator("#clipboard-sequence-target .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+v");
  const copied = await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").getSnapshot());
  const copiedBlocks = copied.json.content!;
  const edge = String(copiedBlocks[0].attrs!.semloEditorListSequenceLink).split(":")[2];
  expect(edge).not.toBe("edge");
  expect(copiedBlocks.slice(1, 3).map((node) => JSON.parse(node.attrs!.semloEditorListSequenceConversion))).toEqual([
    [1, edge, "B"],
    [1, edge, "A"],
  ]);
  expect(copiedBlocks[3].attrs!.semloEditorListSequenceLink).toBe(`v1:${edge}:_`);
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceClipboardTarget").editor;
    let from = -1,
      to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "中间乙") from = pos + 1;
      if (node.type.name === "paragraph" && node.textContent === "中间甲") to = pos + 1 + node.content.size;
    });
    editor.commands.setTextSelection({ from, to });
    editor.commands.focus();
  });
  await expect(page.locator("#clipboard-sequence-target .semlo-editor-prose")).toBeFocused();
  const target = page.locator("#clipboard-sequence-target");
  const ordered = target.getByRole("button", { name: "有序列表", exact: true });
  if (!(await ordered.isVisible())) await target.getByRole("button", { name: "更多", exact: true }).click();
  await ordered.click();
  const restored = await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").getSnapshot());
  expect(restored.json.content![0].content!.map((item) => item.attrs!.semloEditorListSequence)).toEqual([
    "A",
    "B",
    "B",
    "A",
    "A",
    "B",
  ]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
  ).toBe(true);
  await select(page, "中间乙", "中间乙", 0, 3);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceClipboardTarget").editor;
    editor.commands.focus();
    editor.commands.selectAll();
  });
  await expect(page.locator("#clipboard-sequence-target .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+v");
  const partial = await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").getSnapshot());
  expect(partial.text).toBe("中间乙");
  expect(partial.html).not.toContain("data-semlo-editor-list-sequence-conversion");
});

test("系统剪贴板复制跨编号列表与正文的选区", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  await select(page, "甲开头", "footer", 1, 3);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 开头\n  a. 乙中段\n  b. 丙结尾\n\nfoo");
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  const items = page.locator("#clipboard-sequence-target .tiptap ol > li");
  await expect(items.locator("p")).toHaveText(["开头", "乙中段", "丙结尾"]);
  await expect(page.locator("#clipboard-sequence-target .tiptap > p").last()).toHaveText("foo");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
  ).toBe(true);
  await expect(items).toHaveCount(0);
});

test("系统剪贴板复制跨编号列表与普通标题的选区", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  const content = sequenceClipboardContent();
  content.content![1] = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "小标题" }] };
  await page.evaluate((next) => window.__semloRequireFixture("sequenceClipboardSource").setContent(next), content);
  await select(page, "甲开头", "小标题", 1, 2);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 开头\n  a. 乙中段\n  b. 丙结尾\n\n小标");
  await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("#clipboard-sequence-target .tiptap > h2")).toHaveText("小标");
  await expect(page.locator("#clipboard-sequence-target .tiptap ol > li p")).toHaveText(["开头", "乙中段", "丙结尾"]);
});

test("系统剪贴板复制跨两个独立编号列表的选区", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  const content = sequenceClipboardContent();
  content.content = [content.content![0], content.content![1], sequenceClipboardCrossParentContent().content![0]];
  await page.evaluate((next) => window.__semloRequireFixture("sequenceClipboardSource").setContent(next), content);
  await select(page, "甲开头", "子乙", 1, 1);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "  a. 开头\n  a. 乙中段\n  b. 丙结尾\n\nfooter\n\n1. 父甲\n  a. 子甲\n  b. 子",
  );
  await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  const lists = page.locator("#clipboard-sequence-target .tiptap > ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).locator("li p")).toHaveText(["开头", "乙中段", "丙结尾"]);
  await expect(lists.nth(1).locator("li p")).toHaveText(["父甲", "子甲", "子"]);
  await expect(page.locator("#clipboard-sequence-target .tiptap > p")).toHaveText(["footer", "footer"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
  ).toBe(true);
  await expect(lists).toHaveCount(0);
});

test("系统剪贴板复制平级续接列表，粘贴后保持独立续接", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  await page.evaluate(
    (next) => window.__semloRequireFixture("sequenceClipboardSource").setContent(next),
    sequenceClipboardLinkedFlatContent(),
  );
  await select(page, "甲开头", "丁后续", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  expect(
    await page.locator("#clipboard-sequence-source .semlo-editor-list-clipboard-status").allTextContents(),
  ).toEqual([]);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "1. 开头\n2. 乙中段\n\n中间\n\n3. 丙结尾\n4. 丁",
  );
  await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  const lists = page.locator("#clipboard-sequence-target .tiptap > ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).locator("li p")).toHaveText(["开头", "乙中段"]);
  await expect(lists.nth(1).locator("li p")).toHaveText(["丙结尾", "丁"]);
  const links = await lists.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-semlo-editor-list-sequence-link")),
  );
  expect(links[0]).toMatch(/^v1:_:/);
  expect(links[1]).toBe(links[0]!.replace("v1:_:", "v1:") + ":_");
  expect(links[0]).not.toContain("edge");
  await lists.nth(0).locator("li p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("新增");
  const after = await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").getSnapshot().json);
  const targetLists = after.content!.filter((block) => block.type === "orderedList");
  expect(targetLists[1].attrs!.semloEditorListSequences.sequences[0].start).toBe(4);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
  ).toBe(true);
});

for (const numbered of [false, true])
  test(`系统剪贴板跨${numbered ? "编号" : "普通"}标题复制新版续接并保持独立续号`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await setup(page);
    const content = sequenceClipboardLinkedFlatContent();
    content.content![0].attrs!.semloEditorListSequenceLink = "v3:_:edge";
    content.content![1] = {
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
      content: [{ type: "text", text: "中间" }],
    };
    content.content![2].attrs!.semloEditorListSequenceLink = "v3:edge:_";
    await page.evaluate((next) => window.__semloRequireFixture("sequenceClipboardSource").setContent(next), content);
    await select(page, "甲开头", "丁后续", 1, 1);
    const before = await snapshot(page);
    await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+c");
    expect(
      await page.locator("#clipboard-sequence-source .semlo-editor-list-clipboard-status").allTextContents(),
    ).toEqual([]);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "1. 开头\n2. 乙中段\n\n中间\n\n3. 丙结尾\n4. 丁",
    );
    if (numbered) {
      const html = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find((entry) => entry.types.includes("text/html"))!;
        return (await item.getType("text/html")).text();
      });
      expect(html).toContain('data-semlo-editor-heading-numbering="mixed"');
      expect(html).toContain('data-semlo-editor-heading-marker=""');
    }
    await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
    await page.keyboard.press("ControlOrMeta+v");
    const lists = page.locator("#clipboard-sequence-target .tiptap > ol");
    await expect(lists).toHaveCount(2);
    await expect(page.locator("#clipboard-sequence-target .tiptap > h3")).toHaveText(numbered ? "1. 中间" : "中间");
    const pasted = await page.evaluate(
      () => window.__semloRequireFixture("sequenceClipboardTarget").getSnapshot().json,
    );
    const pastedHeading = pasted.content!.find((block) => block.type === "heading")!;
    expect(pastedHeading.content?.[0].text).toBe("中间");
    expect(pastedHeading.attrs?.semloEditorHeadingNumbering).toBe(numbered ? "mixed" : null);
    const links = await lists.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-semlo-editor-list-sequence-link")),
    );
    expect(links[0]).toMatch(/^v3:_:/);
    expect(links[1]).toBe(links[0]!.replace("v3:_:", "v3:") + ":_");
    expect(links[0]).not.toContain("edge");
    await lists.nth(0).locator("li p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增");
    const after = await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").getSnapshot().json);
    const targetLists = after.content!.filter((block) => block.type === "orderedList");
    expect(targetLists[1].attrs!.semloEditorListSequences.sequences[0].start).toBe(4);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
    ).toBe(true);
  });

test("跨编号标题复制尊重宿主剪贴板序列化器", async ({ page }) => {
  await setup(page);
  const content = sequenceClipboardLinkedFlatContent();
  content.content![0].attrs!.semloEditorListSequenceLink = "v3:_:edge";
  content.content![1] = {
    type: "heading",
    attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
    content: [{ type: "text", text: "中间" }],
  };
  content.content![2].attrs!.semloEditorListSequenceLink = "v3:edge:_";
  await page.evaluate((next) => window.__semloRequireFixture("sequenceClipboardSource").setContent(next), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { Plugin, DOMSerializer } from '/dist/index.js';
      const editor = window.sequenceClipboardSource.editor;
      const serializer = DOMSerializer.fromSchema(editor.schema);
      editor.registerPlugin(new Plugin({ props: { clipboardSerializer: serializer } }));
    `,
  });
  await select(page, "甲开头", "丁后续", 1, 1);
  const before = await snapshot(page);
  const copied = await payload(page);
  expect(copied.html).toContain('data-semlo-editor-heading-numbering="mixed"');
  expect(copied.html).not.toContain("data-semlo-editor-heading-marker");
  expect(copied.text).toBe("1. 开头\n2. 乙中段\n\n中间\n\n3. 丙结尾\n4. 丁");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("系统剪贴板复制三级编号范围并保留目标层级", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardThreeLevelsContent(),
  );
  await select(page, "父甲", "孙乙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1. 甲\n  a. 子甲\n    ⅰ. 孙甲\n    ⅱ. 孙");
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  const items = page.locator("#clipboard-sequence-target .tiptap ol > li");
  await expect(items.locator("p")).toHaveText(["甲", "子甲", "孙甲", "孙"]);
  expect(
    await items.evaluateAll((entries) => entries.map((entry) => entry.getAttribute("data-semlo-editor-list-indent"))),
  ).toEqual([null, "1", "2", "2"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
  ).toBe(true);
  await expect(items).toHaveCount(0);
});

test("系统剪贴板跨父子剪切完整三级子树并保留受控回写和撤销", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html");
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardThreeLevelsContent(),
  );
  await select(page, "父甲", "子乙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "1. 甲\n  a. 子甲\n    ⅰ. 孙甲\n    ⅱ. 孙乙\n  b. 子",
  );
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["父乙", "父乙"]);
  const after = await snapshot(page);
  await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("#clipboard-sequence-target .tiptap ol > li p")).toHaveText([
    "甲",
    "子甲",
    "孙甲",
    "孙乙",
    "子",
  ]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("系统剪贴板从根项剪切到三级子项并保留未选直接子项", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html");
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardThreeLevelsContent(),
  );
  await select(page, "父甲", "孙乙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1. 甲\n  a. 子甲\n    ⅰ. 孙甲\n    ⅱ. 孙");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["父乙", "子乙", "父乙"]);
  expect(
    await page
      .locator("#clipboard-sequence-source ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 2]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("系统剪贴板跨父子剪切保留其他分支的三级项", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardOtherDeepContent(),
  );
  await select(page, "父甲", "子乙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1. 甲\n  a. 子甲\n  b. 子");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
    "父乙",
    "父乙",
    "子丙",
    "子丁",
    "子丁续段",
    "孙丁",
  ]);
  expect(
    await page
      .locator("#clipboard-sequence-source ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 2, 1, 2, 1]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
  ).toBe(true);
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
    "父乙",
    "父乙",
    "子丙",
    "子丁",
    "子丁续段",
    "孙丁",
  ]);
});

test("系统剪贴板跨父项剪切保留其他父项的复杂子树", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page);
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardOtherParentDeepContent(),
  );
  await select(page, "子甲", "子丙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 甲\n  b. 子乙\n2. 父乙\n  a. 子");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
    "父甲",
    "子丙",
    "子丁",
    "父丙",
    "子戊",
    "子戊续段",
    "孙戊",
  ]);
  const after = await snapshot(page);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("系统剪贴板跨父项剪切完整选中的三级子树", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html");
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardSelectedDeepContent(),
  );
  await select(page, "子甲", "子丙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "  a. 甲\n    ⅰ. 孙甲\n  b. 子乙\n2. 父乙\n  a. 子",
  );
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["父甲", "子丙", "子丁"]);
  const after = await snapshot(page);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("系统剪贴板同父同级剪切完整选中的三级子树", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html");
  await page.evaluate(
    (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
    sequenceClipboardSelectedDeepContent(),
  );
  await select(page, "子甲", "子乙", 1, 1);
  const before = await snapshot(page);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 甲\n    ⅰ. 孙甲\n  b. 子");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
    "父甲",
    "子乙",
    "父乙",
    "子丙",
    "子丁",
  ]);
  const after = await snapshot(page);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

for (const sample of [
  {
    first: "父甲",
    last: "子乙",
    plain: "1. 甲\n  a. 子甲\n  b. 子",
    words: ["甲", "子甲", "子"],
    values: [1, 1, 2],
    cutWords: ["父乙", "父乙", "子丙", "子丁"],
    cutValues: [1, 2, 1, 2],
    echo: "json" as const,
  },
  {
    first: "子甲",
    last: "子丙",
    plain: "  a. 甲\n  b. 子乙\n2. 父乙\n  a. 子",
    words: ["甲", "子乙", "父乙", "子"],
    values: [1, 2, 1, 1],
    cutWords: ["父甲", "子丙", "子丁"],
    cutValues: [1, 1, 2],
    echo: "html" as const,
  },
]) {
  test(`系统剪贴板跨层复制 ${sample.first} 至 ${sample.last} 不改源并可撤销目标粘贴`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await setup(page);
    await page.evaluate(
      (content) => window.__semloRequireFixture("sequenceClipboardSource").setContent(content),
      sequenceClipboardCrossParentContent(),
    );
    await select(page, sample.first, sample.last, 1, 1);
    const before = await snapshot(page);
    await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sample.plain);
    expect((await snapshot(page)).json).toEqual(before.json);
    await page.evaluate((format) => {
      const target = window.__semloRequireFixture("sequenceClipboardTarget");
      Reflect.set(window, "mixedCopyEchoes", 0);
      target.editor.on("update", () => {
        Reflect.set(window, "mixedCopyEchoes", Reflect.get(window, "mixedCopyEchoes") + 1);
        target.setContent(target.getSnapshot()[format]);
      });
    }, sample.echo);
    await page.locator("#clipboard-sequence-target .tiptap > p").last().click();
    await page.keyboard.press("ControlOrMeta+v");
    const items = page.locator("#clipboard-sequence-target .tiptap ol > li");
    await expect(items.locator("p")).toHaveText(sample.words);
    expect(await page.evaluate(() => Reflect.get(window, "mixedCopyEchoes"))).toBeGreaterThan(0);
    expect(await items.evaluateAll((entries) => entries.map((entry) => (entry as HTMLLIElement).value))).toEqual(
      sample.values,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.undo()),
    ).toBe(true);
    await expect(items).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.redo()),
    ).toBe(true);
    await expect(items.locator("p")).toHaveText(sample.words);
    await select(page, sample.first, sample.last, 1, 1);
    await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+x");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sample.plain);
    await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(sample.cutWords);
    expect(
      await page
        .locator("#clipboard-sequence-source ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual(sample.cutValues);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
    ).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}

test("合成ClipboardEvent精确载荷：跨序列plain保留a/a/b，HTML隔离后粘贴从1", async ({ page }) => {
  await setup(page);
  await select(page);
  const before = await snapshot(page),
    copied = await payload(page);
  expect(copied.trusted).toBe(false);
  expect(copied.text).toBe("  a. 开头\n  a. 乙中段\n  b. 丙");
  expect(copied.html).toContain('data-pm-slice="0 0');
  expect(copied.html).not.toMatch(
    /list-sequence|list-restart|level-starts|first-continue|quote-chain|task-chain|ancestor-path/,
  );
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.evaluate((html) => {
    const target = window.__semloRequireFixture("sequenceClipboardTarget").editor;
    target.commands.focus("end");
    const data = new DataTransfer();
    data.setData("text/html", html);
    target.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, copied.html);
  const items = page.locator("#clipboard-sequence-target .semlo-editor-prose ol > li");
  await expect(items.locator("p")).toHaveText(["开头", "乙中段", "丙"]);
  expect(await items.evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value))).toEqual([1, 2, 3]);
});

test("合成载荷：源b/c复制后新列表起点1且保留level/marks/行高", async ({ page }) => {
  await setup(page, true);
  await select(page, "乙中段", "丙结尾");
  const copied = await payload(page);
  expect(copied.text).toBe("  b. 中段\n  c. 丙");
  const parsed = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return {
      start: doc.querySelector("ol")?.getAttribute("start"),
      values: [...doc.querySelectorAll("li")].map((li) => li.value),
      italic: doc.querySelector("em")?.textContent,
      heights: [...doc.querySelectorAll("p")].map((p) => p.style.lineHeight),
      levels: [...doc.querySelectorAll("li")].map((li) => li.getAttribute("data-semlo-editor-list-indent")),
    };
  }, copied.html);
  expect(parsed.values).toEqual([1, 2]);
  expect(parsed.italic).toBe("中段");
  expect(parsed.heights).toEqual(["2", "2"]);
  expect(parsed.levels).toEqual(["1", "1"]);
});

for (const same of [false, true])
  for (const echo of ["json", "html"] as const)
    test(`合成cut：${same ? "同" : "跨"}序列 ${echo} 受控只合首prefix+末suffix，单步恢复完整身份`, async ({ page }) => {
      await setup(page, same, echo, true);
      await select(page);
      const before = await snapshot(page),
        copied = await payload(page, "cut");
      expect(copied.text).toBe(same ? "  a. 开头\n  b. 乙中段\n  c. 丙" : "  a. 开头\n  a. 乙中段\n  b. 丙");
      await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
        "父",
        "甲结尾",
        "丁后续",
        "戊最后",
      ]);
      const after = await snapshot(page);
      expect(after.json.content![0].content![1].attrs!.semloEditorListSequence).toBe("A");
      expect(after.json.content![0].attrs!.semloEditorListSequences).toEqual(
        before.json.content![0].attrs!.semloEditorListSequences,
      );
      expect(await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardChanges"))).toBe(1);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
      ).toBe(true);
      expect((await snapshot(page)).json).toEqual(before.json);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
      ).toBe(true);
      expect((await snapshot(page)).json).toEqual(after.json);
    });

for (const echo of ["json", "html"] as const)
  for (const from of [0, 1, 3])
    for (const to of [0, 1, 3])
      test(`${echo}端点组合cut ${from}/${to} 保首身份/空首项/丁a，单步undo redo`, async ({ page }) => {
        await setup(page, false, echo, false, 1);
        await select(page, "甲开头", "丙结尾", from, to);
        const before = await snapshot(page);
        expect(
          await page.evaluate(() => {
            const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
            return editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n");
          }),
        ).toBe("甲开头".slice(from) + "\n乙中段\n" + "丙结尾".slice(0, to));
        const copied = await payload(page, "cut");
        expect(copied.text).toBe(`  a. ${"甲开头".slice(from)}\n  a. 乙中段\n  b. ${"丙结尾".slice(0, to)}`);
        await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
          "父",
          "甲开头".slice(0, from) + "丙结尾".slice(to),
          "丁后续",
        ]);
        const after = await snapshot(page);
        expect(after.json.content![0].content![1].attrs).toEqual(before.json.content![0].content![1].attrs);
        expect(after.json.content![0].content![2]).toEqual(before.json.content![0].content![4]);
        expect(after.json.content![0].attrs!.semloEditorListSequences).toEqual(
          before.json.content![0].attrs!.semloEditorListSequences,
        );
        expect(
          await page
            .locator("#clipboard-sequence-source ol > li")
            .evaluateAll((items) => items.map((li) => (li as HTMLLIElement).value)),
        ).toEqual([1, 1, 1]);
        expect(await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardChanges"))).toBe(1);
        expect(
          await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
        ).toBe(true);
        expect((await snapshot(page)).json).toEqual(before.json);
        expect(
          await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
        ).toBe(true);
        expect((await snapshot(page)).json).toEqual(after.json);
      });

test("只读允许copy，cut不写不删，销毁清理本实例状态提示", async ({ page }) => {
  await setup(page);
  await select(page);
  const before = await snapshot(page);
  await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").setEditable(false));
  expect((await payload(page)).text).toBe("  a. 开头\n  a. 乙中段\n  b. 丙");
  expect((await payload(page, "cut")).text).toBe("sentinel");
  expect((await snapshot(page)).json).toEqual(before.json);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-list-clipboard-status")).toHaveText(
    "当前为只读状态，无法剪切",
  );
  await select(page, "甲开头", "丙结尾", 0, 3);
  expect((await payload(page, "cut")).text).toBe("sentinel");
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").destroy());
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-list-clipboard-status")).toHaveCount(0);
});

for (const fault of [
  "missing",
  "read",
  "write",
  "silent",
  "readback",
  "serialize",
  "reenter",
  "selection",
  "readonly",
  "destroy",
] as const)
  for (const boundary of ["write", "reenter", "destroy"].includes(fault) ? [false, true] : [false])
    test(`合成事件故障${boundary ? "段端" : "段内"} ${fault}：未完成剪贴板与状态复核时不删除`, async ({ page }) => {
      await setup(page);
      await select(page, "甲开头", "丙结尾", boundary ? 0 : 1, boundary ? 3 : 1);
      const result = await page.evaluate((fault) => {
        const controller = window.__semloRequireFixture("sequenceClipboardSource"),
          editor = controller.editor,
          view = editor.view;
        const original = view.state.doc;
        const data = new DataTransfer(),
          write = data.setData.bind(data);
        data.setData("text/plain", "sentinel");
        Object.defineProperty(data, "setData", {
          value(type: string, value: string) {
            if (fault === "write") throw new Error("测试剪贴板失败");
            if (fault === "silent") return;
            write(type, value);
            if (type !== "text/html") return;
            if (fault === "reenter") controller.setContent("<p>宿主新正文</p>");
            if (fault === "selection") editor.commands.setTextSelection(1);
            if (fault === "readonly") controller.setEditable(false);
            if (fault === "destroy") controller.destroy();
          },
        });
        if (fault === "readback")
          Object.defineProperty(data, "getData", {
            value() {
              throw new Error("测试载荷回读失败");
            },
          });
        if (fault === "serialize")
          view.setProps({
            transformCopied(slice) {
              controller.setContent("<p>宿主新正文</p>");
              return slice;
            },
          });
        const event = new ClipboardEvent("cut", {
          clipboardData: fault === "missing" ? null : data,
          bubbles: true,
          cancelable: true,
        });
        if (fault === "read")
          Object.defineProperty(event, "clipboardData", {
            get() {
              throw new Error("测试剪贴板读取失败");
            },
          });
        view.dom.dispatchEvent(event);
        return {
          unchanged: view.state.doc.eq(original),
          text: view.state.doc.textContent,
          destroyed: view.isDestroyed,
          changes: window.__semloRequireFixture("sequenceClipboardChanges"),
        };
      }, fault);
      expect(result.changes).toBe(0);
      if (fault === "reenter" || fault === "serialize") expect(result.text).toBe("宿主新正文");
      else expect(result.unchanged).toBe(true);
      expect(result.destroyed).toBe(fault === "destroy");
    });

test("真实键盘copy和paste：可信事件、系统剪贴板、新列表从1且源历史不变", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, true);
  await select(page, "乙中段", "丙结尾");
  await page.evaluate(() => {
    const source = window.__semloRequireFixture("sequenceClipboardSource").editor;
    source.view.dom.addEventListener("copy", (event) => Reflect.set(window, "sequenceRealCopy", event.isTrusted), {
      capture: true,
    });
    window
      .__semloRequireFixture("sequenceClipboardTarget")
      .editor.view.dom.addEventListener("paste", (event) => Reflect.set(window, "sequenceRealPaste", event.isTrusted), {
        capture: true,
      });
  });
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  const before = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => Reflect.get(window, "sequenceRealCopy"))).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  b. 中段\n  c. 丙");
  await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardTarget").editor.commands.focus("end"));
  await expect(page.locator("#clipboard-sequence-target .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("#clipboard-sequence-target ol > li p")).toHaveText(["中段", "丙"]);
  expect(await page.evaluate(() => Reflect.get(window, "sequenceRealPaste"))).toBe(true);
  expect(
    await page
      .locator("#clipboard-sequence-target ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 2]);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardChanges"))).toBe(0);
});

test("真实键盘cut与一次undo恢复源restart/registry而非复现原生异常", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html", true);
  await select(page);
  const before = await snapshot(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("sequenceClipboardSource")
      .editor.view.dom.addEventListener("cut", (event) => Reflect.set(window, "sequenceRealCut", event.isTrusted), {
        capture: true,
      }),
  );
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["父", "甲结尾", "丁后续", "戊最后"]);
  expect(await page.evaluate(() => Reflect.get(window, "sequenceRealCut"))).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 开头\n  a. 乙中段\n  b. 丙");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("同层片段可粘贴，父子范围支持复制和剪切", async ({ page }) => {
  await setup(page);
  await select(page);
  const before = await snapshot(page),
    copied = await payload(page);
  await page.evaluate((html) => {
    const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
    const data = new DataTransfer();
    data.setData("text/html", html);
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, copied.html);
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["父", "甲开头", "乙中段", "丙结尾"]);
  expect(
    await page
      .locator("#clipboard-sequence-source ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 2, 3]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  await select(page, "父", "丙结尾", 0, 1);
  expect((await payload(page)).text).toBe("1. 父\n  a. 甲开头\n  a. 乙中段\n  b. 丙");
  expect((await payload(page, "cut")).text).toBe("1. 父\n  a. 甲开头\n  a. 乙中段\n  b. 丙");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["结尾"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const boundary of [false, true])
  for (const echo of ["json", "html"] as const)
    test(`${echo}${boundary ? "段端" : "段内"}剪切前后不同文字和marks输入分别undo，不并入cut历史`, async ({ page }) => {
      await setup(page, false, echo, true);
      const initial = await snapshot(page);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.can().undo()),
      ).toBe(false);
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
        let pos = -1;
        editor.state.doc.descendants((node, at) => {
          if (node.type.name === "paragraph" && node.textContent === "甲开头") pos = at + 1;
        });
        editor.chain().setTextSelection(pos).setMark("italic").insertContent("前").unsetMark("italic").run();
      });
      const typed = await snapshot(page);
      expect(
        typed.json.content![0].content![1].content![0].content![0].marks?.some((mark) => mark.type === "italic"),
      ).toBe(true);
      await select(page, "前甲开头", "丙结尾", boundary ? 0 : 2, boundary ? 3 : 1);
      await payload(page, "cut");
      const cut = await snapshot(page);
      await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
        "父",
        boundary ? "" : "前甲结尾",
        "丁后续",
        "戊最后",
      ]);
      await page.evaluate(() =>
        window
          .__semloRequireFixture("sequenceClipboardSource")
          .editor.chain()
          .setMark("strike")
          .insertContent("后")
          .unsetMark("strike")
          .run(),
      );
      const after = await snapshot(page);
      expect(
        after.json.content![0].content![1].content![0].content!.some(
          (node) => node.text === "后" && node.marks?.some((mark) => mark.type === "strike"),
        ),
      ).toBe(true);
      for (const expected of [cut.json, typed.json, initial.json]) {
        expect(
          await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
        ).toBe(true);
        expect((await snapshot(page)).json).toEqual(expected);
      }
      for (const expected of [typed.json, cut.json, after.json]) {
        expect(
          await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
        ).toBe(true);
        expect((await snapshot(page)).json).toEqual(expected);
      }
    });

test("新增全端点：完整三项cut保留空首项身份、丁归原序列首位", async ({ page }) => {
  await setup(page, false, "json", false, 1);
  await select(page, "甲开头", "丙结尾", 0, 3);
  const before = await snapshot(page);
  await payload(page, "cut");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText(["父", "", "丁后续"]);
  const after = await snapshot(page);
  expect(after.json.content![0].content![1].attrs!.semloEditorListSequence).toBe("A");
  expect(after.json.content![0].content![2].attrs!.semloEditorListSequence).toBe("B");
  expect(after.json.content![0].attrs!.semloEditorListSequences).toEqual(
    before.json.content![0].attrs!.semloEditorListSequences,
  );
  expect(
    await page
      .locator("#clipboard-sequence-source ol > li")
      .evaluateAll((items) => items.map((li) => (li as HTMLLIElement).value)),
  ).toEqual([1, 1, 1]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const echo of ["json", "html"] as const)
  test(`${echo}仅换行cut合并甲乙，保首身份及丙a丁b`, async ({ page }) => {
    await setup(page, false, echo, false, 1);
    await select(page, "甲开头", "乙中段", 3, 0);
    const before = await snapshot(page);
    expect(
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("sequenceClipboardSource").editor;
        return editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n");
      }),
    ).toBe("\n");
    expect((await payload(page, "cut")).text).toBe("  a. \n  a. ");
    await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
      "父",
      "甲开头乙中段",
      "丙结尾",
      "丁后续",
    ]);
    const after = await snapshot(page);
    const nodes = after.json.content![0].content![1].content![0].content!;
    expect(nodes.some((node) => node.text === "甲开头" && node.marks?.some((mark) => mark.type === "bold"))).toBe(true);
    expect(nodes.some((node) => node.text === "乙中段" && node.marks?.some((mark) => mark.type === "italic"))).toBe(
      true,
    );
    expect(after.json.content![0].content![1].attrs!.semloEditorListSequence).toBe("A");
    expect(after.json.content![0].attrs!.semloEditorListSequences).toEqual(
      before.json.content![0].attrs!.semloEditorListSequences,
    );
    expect(
      await page
        .locator("#clipboard-sequence-source ol > li")
        .evaluateAll((items) => items.map((li) => (li as HTMLLIElement).value)),
    ).toEqual([1, 1, 1, 2]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.undo()),
    ).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
    ).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
  });

test("level2 plain每行四空格且Unicode Roman与HTML层级保持", async ({ page }) => {
  await setup(page, false, "json", false, 2);
  await select(page);
  const before = await snapshot(page);
  const copied = await payload(page);
  expect(copied.text).toBe("    ⅰ. 开头\n    ⅰ. 乙中段\n    ⅱ. 丙");
  expect(copied.text.split("\n").every((line) => /^ {4}\S/.test(line))).toBe(true);
  expect(copied.text.split("\n").map((line) => line.slice(line.indexOf(". ") + 2))).toEqual(["开头", "乙中段", "丙"]);
  expect(
    await page.evaluate((html) => {
      const dom = new DOMParser().parseFromString(html, "text/html");
      return [...dom.querySelectorAll("li")].map((li) => li.getAttribute("data-semlo-editor-list-indent"));
    }, copied.html),
  ).toEqual(["2", "2", "2"]);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("真实键盘纯换行边界cut：精确DOM选区、两格plain、一次undo和redo", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, false, "html", false, 1);
  await select(page, "甲开头", "乙中段", 3, 0);
  await expect(page.locator("#clipboard-sequence-source .semlo-editor-prose")).toBeFocused();
  const selected = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceClipboardSource").editor,
      native = window.getSelection()!;
    const selection = editor.state.selection;
    return {
      dom: native.toString().replace(/\r\n?/g, "\n"),
      logical: editor.state.doc.textBetween(selection.from, selection.to, "\n"),
      aligned:
        editor.view.posAtDOM(native.anchorNode!, native.anchorOffset) === selection.from &&
        editor.view.posAtDOM(native.focusNode!, native.focusOffset) === selection.to,
      offsets: [selection.$from.parentOffset, selection.$to.parentOffset],
      paragraphs: [selection.$from.parent.textContent, selection.$to.parent.textContent],
    };
  });
  // DOM 段落呈现包含两个换行；回映端点保证实际仍是甲末到乙首的一个逻辑段分隔。
  expect(selected).toEqual({
    dom: "\n\n",
    logical: "\n",
    aligned: true,
    offsets: [3, 0],
    paragraphs: ["甲开头", "乙中段"],
  });
  const before = await snapshot(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("sequenceClipboardSource")
      .editor.view.dom.addEventListener("cut", (event) => Reflect.set(window, "boundaryRealCut", event.isTrusted), {
        capture: true,
      }),
  );
  await page.keyboard.press("ControlOrMeta+x");
  await expect(page.locator("#clipboard-sequence-source ol > li p")).toHaveText([
    "父",
    "甲开头乙中段",
    "丙结尾",
    "丁后续",
  ]);
  expect(await page.evaluate(() => Reflect.get(window, "boundaryRealCut"))).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. \n  a. ");
  const after = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceClipboardSource").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});
