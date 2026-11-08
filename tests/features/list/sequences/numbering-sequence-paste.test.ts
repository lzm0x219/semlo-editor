import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test, type Page } from "@rstest/playwright";

import type { EditorControllerWithResults } from "../../../../packages/core/src/types";
import { dragSequence } from "../../../fixtures/list/sequences/browser-helpers";
import { crossLevelPasteContent } from "../../../fixtures/list/sequences/cross-level-paste-content";
import { nestedLegacyPasteContent } from "../../../fixtures/list/sequences/nested-legacy-paste-content";
import {
  linkedTypedPasteContent,
  sequencePasteContent,
} from "../../../fixtures/list/sequences/numbering-sequence-paste-content";
import type {} from "../../../fixtures/list/sequences/numbering-sequence-paste-fixture";

let origin: string;
let stop: (() => Promise<void>) | undefined;
const browserErrors = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/list/sequences/numbering-sequence-paste-fixture.ts" } },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
test.afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.sequencePasteFixture));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.sequencePasteFixture?.destroy());
  await expect(page.locator(".semlo-editor-prose")).toHaveCount(0);
  expect(browserErrors.get(page)).toEqual([]);
});
async function select(page: Page, first: string, a: number, last = first, b = a) {
  await page.evaluate(
    ({ first, a, last, b }) => {
      const editor = window.sequencePasteFixture.get().editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === first) from = pos + 1 + a;
        if (node.type.name === "paragraph" && node.textContent === last) to = pos + 1 + b;
      });
      if (from < 0 || to < 0) throw new Error("未找到选区端点");
      editor.commands.setTextSelection({ from, to });
      editor.commands.focus();
    },
    { first, a, last, b },
  );
  await expect(page.locator("#primary .semlo-editor-prose")).toBeFocused();
}
const snapshot = (page: Page) => page.evaluate(() => window.sequencePasteFixture.get().getSnapshot());

const nativeListHTML =
  '<ne-clipboard data="ignored"></ne-clipboard><div class="lake-content"><ol start="2" class="ne-ol"><li><span class="ne-text">乙</span></li><li><span class="ne-text">父</span></li></ol></div>';

async function writeNativeList(page: Page, html: string) {
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob(["2. 乙\n3. 父"], { type: "text/plain" }),
      }),
    ]);
  }, html);
}

test("旧嵌套列表跨子项粘贴后拆分并保持续接，拖动后仍可撤销", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), nestedLegacyPasteContent());
  await select(page, "甲开头", 1, "乙中段", 1);
  const original = await snapshot(page);
  await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
  await page.keyboard.press("ControlOrMeta+v");
  const prose = page.locator("#primary .semlo-editor-prose");
  await expect(prose.locator(":scope > ol")).toHaveCount(2);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "甲一", "中段", "丙结尾", "丁后续"]);
  expect(
    await prose.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 2, 3, 4]);
  const split = await snapshot(page);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(original);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(split);
  await dragSequence(page, prose.getByText("中段", { exact: true }), prose.getByText("甲一", { exact: true }), true);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "中段", "甲一", "丙结尾", "丁后续"]);
  expect(
    await prose.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 2, 1, 2, 3]);
  const moved = await snapshot(page);
  for (const content of [moved.json, moved.html]) {
    await page.evaluate((value) => window.sequencePasteFixture.mount("peer", value), content);
    expect(await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot())).toEqual(moved);
  }
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(split);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(moved);
  await select(page, "甲一", 2);
  await page.keyboard.press("Enter");
  await page.keyboard.type("新增");
  expect(
    await prose.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 2, 1, 2, 3, 4]);
});

test("宿主拒绝旧嵌套列表粘贴时保留原始内容", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), nestedLegacyPasteContent());
  await select(page, "甲开头", 1, "乙中段", 1);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.sequencePasteFixture.setFault("filter-reject");
    return navigator.clipboard.writeText("一\n二");
  });
  await page.keyboard.press("ControlOrMeta+v");
  expect(await snapshot(page)).toEqual(before);
});

test("旧嵌套列表中间子项跨选粘贴三行后，未选项与续接拖动保留", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), nestedLegacyPasteContent());
  await select(page, "乙中段", 0, "丙结尾", 2);
  await page.evaluate(() => navigator.clipboard.writeText("一\n二\n三"));
  await page.keyboard.press("ControlOrMeta+v");
  const prose = page.locator("#primary .semlo-editor-prose");
  await expect(prose.locator("ol > li p")).toHaveText(["父", "甲开头", "一", "尾", "丁后续"]);
  const split = await snapshot(page);
  await dragSequence(page, prose.getByText("尾", { exact: true }), prose.getByText("甲开头", { exact: true }), true);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "尾", "甲开头", "一", "丁后续"]);
  expect(
    await prose.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 2, 1, 2, 3]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(split);
});

test("语雀可见列表 HTML 替换父子项选区，来源起始编号不覆盖目标编号", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), crossLevelPasteContent());
  await select(page, "父甲", 1, "子乙", 1);
  const before = await snapshot(page);
  const selection = await page.evaluate(() => window.sequencePasteFixture.get().editor.state.selection.toJSON());
  await writeNativeList(page, nativeListHTML);
  await page.keyboard.press("ControlOrMeta+v");
  const items = page.locator("#primary .semlo-editor-prose > ol > li");
  await expect(items).toHaveCount(4);
  expect(await items.locator("p").allTextContents()).toEqual(["父乙", "父乙", "父乙", "父丙"]);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value))).toEqual([1, 2, 3, 4]);
  const after = await snapshot(page);
  expect(after.text).toContain("尾段");
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.state.selection.toJSON())).toEqual(
    selection,
  );
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
});

test("语雀可见列表 HTML 粘贴到单个根级叶项时接续目标编号", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), crossLevelPasteContent());
  await select(page, "父乙", 1);
  const before = await snapshot(page);
  await writeNativeList(page, nativeListHTML);
  await page.keyboard.press("ControlOrMeta+v");
  const items = page.locator("#primary .semlo-editor-prose > ol > li");
  await expect(items).toHaveCount(6);
  expect(await items.locator("p").allTextContents()).toEqual(["父甲", "子甲", "子乙", "父乙", "父乙", "父丙"]);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value))).toEqual([
    1, 1, 2, 2, 3, 4,
  ]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

test("语雀可见列表 HTML 替换部分子项时保留并重新归属未选子项", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), crossLevelPasteContent());
  await select(page, "父甲", 1, "子甲", 1);
  const before = await snapshot(page);
  const selection = await page.evaluate(() => window.sequencePasteFixture.get().editor.state.selection.toJSON());
  await writeNativeList(page, nativeListHTML);
  await page.keyboard.press("ControlOrMeta+v");
  const items = page.locator("#primary .semlo-editor-prose > ol > li");
  await expect(items).toHaveCount(5);
  expect(await items.locator("p").allTextContents()).toEqual(["父乙", "父甲", "子乙", "父乙", "父丙"]);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value))).toEqual([
    1, 2, 1, 3, 4,
  ]);
  const after = await snapshot(page);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.state.selection.toJSON())).toEqual(
    selection,
  );
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
});

test("语雀包装中的嵌套列表、错位身份或异常起点仍被拒绝", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const html of [
    nativeListHTML.replace('start="2"', 'start="0"'),
    nativeListHTML.replace('<span class="ne-text">乙</span>', "<ol><li><p>嵌套</p></li></ol>"),
    nativeListHTML.replace(
      '<li><span class="ne-text">乙</span>',
      '<li data-semlo-editor-list-sequence="x"><span class="ne-text">乙</span>',
    ),
    nativeListHTML.replace(
      '<li><span class="ne-text">乙</span>',
      '<li data-host-item-setting="unexpected"><span class="ne-text">乙</span>',
    ),
  ]) {
    await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), crossLevelPasteContent());
    await select(page, "父甲", 1, "子乙", 1);
    const before = await snapshot(page);
    await writeNativeList(page, html);
    await page.keyboard.press("ControlOrMeta+v");
    expect(await snapshot(page)).toEqual(before);
    await expect(page.getByRole("status")).toContainText("当前内容已保留");
  }
});
async function copied(page: Page, first = "甲开头", a = 1, last = "丙结尾", b = 1) {
  await select(page, first, a, last, b);
  return page.evaluate(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
    window.sequencePasteFixture.get().editor.view.dom.dispatchEvent(event);
    return { html: data.getData("text/html"), text: data.getData("text/plain") };
  });
}
async function paste(page: Page, payload: { html: string; text: string }) {
  return page.evaluate(({ html, text }) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    window.sequencePasteFixture.get().editor.view.dom.dispatchEvent(event);
    return { prevented: event.defaultPrevented, trusted: event.isTrusted };
  }, payload);
}
async function history(page: Page, command: "undo" | "redo") {
  expect(await page.evaluate((command) => window.sequencePasteFixture.get().editor.commands[command](), command)).toBe(
    true,
  );
}

test("可信OS copy/paste在单个既有叶项内接续目标序列，源项与一次历史精确保留", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const before = await snapshot(page);
  await select(page, "甲开头", 1, "丙结尾", 1);
  expect(
    await page.evaluate(() => {
      const { doc, selection } = window.sequencePasteFixture.get().editor.state;
      return {
        text: doc.textBetween(selection.from, selection.to, "\n"),
        a: selection.$from.parentOffset,
        b: selection.$to.parentOffset,
      };
    }),
  ).toEqual({ text: "开头\n乙中段\n丙", a: 1, b: 1 });
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 开头\n  a. 乙中段\n  b. 丙");
  expect(await snapshot(page)).toEqual(before);
  await select(page, "丁后续", 1);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("#primary ol > li p")).toHaveText([
    "父",
    "甲开头",
    "乙中段",
    "丙结尾",
    "丁开头",
    "乙中段",
    "丙后续",
  ]);
  const after = await snapshot(page);
  expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
  expect(after.json.content![0].content!.map((item) => item.attrs!.semloEditorListSequence)).toEqual([
    "R",
    "A",
    "B",
    "B",
    "B",
    "B",
    "B",
  ]);
  expect(
    await page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 1, 2, 3, 4, 5]);
  expect(await page.evaluate(() => window.sequencePasteFixture.events)).toEqual([
    { type: "copy", trusted: true },
    { type: "paste", trusted: true },
  ]);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.commands.redo())).toBe(true);
  expect(await snapshot(page)).toEqual(after);
});

for (const [name, first, last, expected, values] of [
  ["同一序列", "乙中段", "丁后续", ["父", "甲开头", "乙开头", "乙中段", "丙后续"], [1, 1, 1, 2, 3]],
  ["跨编号边界", "甲开头", "乙中段", ["父", "甲开头", "乙中段", "丙中段", "丙结尾", "丁后续"], [1, 1, 2, 3, 1, 2]],
] as const)
  test(`可信OS跨项替换：${name}匹配语雀并可撤销重做`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const before = await snapshot(page);
    await select(page, "甲开头", 1, "丙结尾", 1);
    await page.keyboard.press("ControlOrMeta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 开头\n  a. 乙中段\n  b. 丙");
    await select(page, first, 1, last, 1);
    const selection = await page.evaluate(() => {
      const { from, to } = window.sequencePasteFixture.get().editor.state.selection;
      return { from, to };
    });
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator("#primary ol > li p")).toHaveText([...expected]);
    expect(
      await page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([...values]);
    const after = await snapshot(page);
    expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    expect(
      await page.evaluate(() => {
        const { from, to } = window.sequencePasteFixture.get().editor.state.selection;
        return { from, to };
      }),
    ).toEqual(selection);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
    await page.evaluate((html) => window.sequencePasteFixture.get().setContent(html), after.html);
    expect(await snapshot(page)).toEqual(after);
  });

for (const [name, first, last, left, right, values] of [
  ["同一序列", "乙中段", "丁后续", ["父", "甲开头", "乙  a. 开头"], ["后续"], [1, 1, 1, 2]],
  ["跨编号边界", "甲开头", "乙中段", ["父", "甲  a. 开头"], ["中段", "丙结尾", "丁后续"], [1, 1, 2, 1, 2]],
] as const)
  test(`可信OS跨项纯文本：${name}拆分并保留编号和历史`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const before = await snapshot(page);
    await page.evaluate(() => navigator.clipboard.writeText("  a. 开头\n  a. 乙中段\n  b. 丙"));
    await select(page, first, 1, last, 1);
    const selection = await page.evaluate(() => {
      const { anchor, head } = window.sequencePasteFixture.get().editor.state.selection;
      return { anchor, head };
    });
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator("#primary .semlo-editor-prose > ol")).toHaveCount(2);
    const after = await snapshot(page);
    expect(after.json.content!.map((node) => node.type)).toEqual([
      "orderedList",
      "paragraph",
      "paragraph",
      "orderedList",
      "paragraph",
    ]);
    expect(
      after.json.content![0].content!.map((item) => item.content![0].content?.map((t) => t.text).join("") ?? ""),
    ).toEqual(left);
    expect(after.json.content![1].content![0].text).toBe("  a. 乙中段");
    expect(after.json.content![2].content![0].text).toBe("  b. 丙");
    expect(
      after.json.content![3].content!.map((item) => item.content![0].content?.map((t) => t.text).join("") ?? ""),
    ).toEqual(right);
    expect(
      await page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([...values]);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    expect(
      await page.evaluate(() => {
        const { anchor, head } = window.sequencePasteFixture.get().editor.state.selection;
        return { anchor, head };
      }),
    ).toEqual(selection);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
    await page.evaluate((html) => window.sequencePasteFixture.get().setContent(html), after.html);
    expect(await snapshot(page)).toEqual(after);
  });

test("拆分后前段新增项联动后段，JSON/HTML重载及历史保留关联", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("  a. 开头\n  a. 乙中段\n  b. 丙"));
  await select(page, "甲开头", 1, "乙中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  const split = await snapshot(page);
  await select(page, "甲  a. 开头", "甲  a. 开头".length);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    )
    .toEqual([1, 1, 2, 3, 1, 2]);
  const after = await snapshot(page);
  expect(await page.evaluate(() => window.sequencePasteFixture.changes())).toBe(2);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(split);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
  for (const content of [after.json, after.html]) {
    await page.evaluate((value) => window.sequencePasteFixture.mount("peer", value), content);
    expect(await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot())).toEqual(after);
  }
});

test("段落首尾及格式边界的连续空格和制表符可经 HTML 重载", async ({ page }) => {
  await page.evaluate(() => {
    window.sequencePasteFixture.mount("primary", {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: " 前  段 " },
            { type: "text", text: " 加粗 ", marks: [{ type: "bold" }] },
            { type: "text", text: "尾 " },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "原有\t制表符" }] },
        { type: "paragraph", content: [{ type: "text", text: "普通 单空格" }] },
      ],
    });
  });
  const before = await snapshot(page);
  expect(before.html).toContain("data-semlo-editor-preserve-tab");
  await page.evaluate((html) => window.sequencePasteFixture.mount("peer", html), before.html);
  expect(await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot())).toEqual(before);
});

test("系统剪贴板复制整条关联链时换新身份，来源和副本独立", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
  await select(page, "甲开头", 1, "乙中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  const source = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await page.evaluate(() => {
    const fixture = window.sequencePasteFixture;
    fixture.mount("peer", "<p></p>");
    fixture.get("peer").editor.commands.focus();
  });
  await expect(page.locator("#peer .semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+v");
  const copy = await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot());
  const sourceLink = source.json.content![0].attrs!.semloEditorListSequenceLink as string;
  const copyLink = copy.json.content![0].attrs!.semloEditorListSequenceLink as string;
  expect(copyLink).toMatch(/^v1:_:/);
  expect(copyLink).not.toBe(sourceLink);
  expect(copy.json.content![2].attrs!.semloEditorListSequenceLink).toBe(`v1:${copyLink.slice(5)}:_`);
  expect(await snapshot(page)).toEqual(source);
});

test("系统剪贴板单独复制一段时不携带源关联", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
  await select(page, "甲开头", 1, "乙中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  const source = await snapshot(page);
  await page.evaluate(() => {
    const editor = window.sequencePasteFixture.get().editor;
    editor.commands.setNodeSelection(0);
    editor.commands.focus();
  });
  await page.keyboard.press("ControlOrMeta+c");
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes("text/html"));
    return item ? (await item.getType("text/html")).text() : "";
  });
  expect(html).toContain("data-semlo-editor-list-sequences");
  expect(html).not.toContain("data-semlo-editor-list-sequence-link");
  expect(await snapshot(page)).toEqual(source);
});

test("HTML 关联字段放在非列表元素时拒绝替换并保留正文", async ({ page }) => {
  const before = await snapshot(page);
  const result = await page.evaluate(() =>
    (window.sequencePasteFixture.get() as EditorControllerWithResults).trySetContent(
      '<p data-semlo-editor-list-sequence-link="v1:_:bad">误放字段</p>',
    ),
  );
  expect(result.status).toBe("parse-failed");
  expect(await snapshot(page)).toEqual(before);
});

test("块菜单删除中间续接叶项后前后段仍联动，一次撤销恢复", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
  await select(page, "甲开头", 1, "乙中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  await page.evaluate(() => navigator.clipboard.writeText("三\n四"));
  await select(page, "中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  const before = await snapshot(page);
  await page.locator("#primary .semlo-editor-prose > ol").nth(1).locator("li p").hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.locator("#primary .semlo-editor-prose > ol")).toHaveCount(2);
  expect(
    await page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 2, 1, 2]);
  const after = await snapshot(page);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
  await select(page, "甲一", 2);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    )
    .toEqual([1, 1, 2, 3, 1, 2]);
});

test("空的中间子项连续退格，先退到根级再退出列表并保留续接", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
  await select(page, "甲开头", 1, "乙中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  await page.evaluate(() => navigator.clipboard.writeText("三\n四"));
  await select(page, "中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  await select(page, "中三", 0, "中三", 2);
  await page.keyboard.press("Backspace");
  const child = await snapshot(page);
  await page.keyboard.press("Backspace");
  await expect
    .poll(() =>
      page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    )
    .toEqual([1, 1, 2, 1, 1, 2]);
  const rootItem = await snapshot(page);
  await page.keyboard.press("Backspace");
  await expect(page.locator("#primary .semlo-editor-prose > ol")).toHaveCount(2);
  expect(
    await page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 2, 1, 2]);
  const paragraph = await snapshot(page);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(rootItem);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(child);
  await history(page, "redo");
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(paragraph);
  await select(page, "甲一", 2);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.locator("#primary ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    )
    .toEqual([1, 1, 2, 3, 1, 2]);
});

test("空续接子项退格尊重组合输入、宿主拒绝和实例隔离", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => window.sequencePasteFixture.mount("peer"));
  const peer = await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot());
  await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
  await select(page, "甲开头", 1, "乙中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  await page.evaluate(() => navigator.clipboard.writeText("三\n四"));
  await select(page, "中段", 1);
  await page.keyboard.press("ControlOrMeta+v");
  await select(page, "中三", 0, "中三", 2);
  await page.keyboard.press("Backspace");
  const before = await snapshot(page);
  await page.evaluate(() => {
    const editor = window.sequencePasteFixture.get().editor;
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", isComposing: true, bubbles: true }));
  });
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => window.sequencePasteFixture.setFault("key-reject"));
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.sequencePasteFixture.observed)).toContain("key-reject");
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot())).toEqual(peer);
});

for (const [name, sourceA, sourceLast, sourceB, target, a, b, expected] of [
  ["段首", 1, "丙结尾", 1, "甲开头", 0, 0, ["父", "开头", "乙中段", "丙甲开头", "乙中段", "丙结尾", "丁后续"]],
  ["段内替换", 1, "丙结尾", 1, "丁后续", 1, 2, ["父", "甲开头", "乙中段", "丙结尾", "丁开头", "乙中段", "丙续"]],
  ["空换行", 3, "乙中段", 0, "丁后续", 1, 1, ["父", "甲开头", "乙中段", "丙结尾", "丁", "后续"]],
] as const)
  test(`合成精确载荷${name}按原生向量合首尾并单步恢复`, async ({ page }) => {
    const before = await snapshot(page);
    const payload = await copied(page, "甲开头", sourceA, sourceLast, sourceB);
    await select(page, target, a, target, b);
    expect(await paste(page, payload)).toEqual({ prevented: true, trusted: false });
    await expect(page.locator("#primary ol > li p")).toHaveText([...expected]);
    const after = await snapshot(page);
    expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 1, redo: 0 });
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
  });

for (const echo of ["json", "html"] as const)
  test(`${echo}精确受控回写、HTML/JSON重载与独立只读实例不重建身份`, async ({ page }) => {
    await page.evaluate(
      ({ content, echo }) => {
        window.sequencePasteFixture.mount("primary", content, echo);
        window.sequencePasteFixture.mount("peer", content);
        window.sequencePasteFixture.get("peer").setEditable(false);
      },
      { content: sequencePasteContent(2), echo },
    );
    const before = await snapshot(page);
    const peer = await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot());
    const payload = await copied(page);
    expect(payload.text).toBe("    ⅰ. 开头\n    ⅰ. 乙中段\n    ⅱ. 丙");
    await select(page, "丁后续", 1);
    await paste(page, payload);
    const after = await snapshot(page);
    expect(after.json.content![0].content).toHaveLength(7);
    expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
    expect(await page.evaluate(() => window.sequencePasteFixture.changes())).toBe(1);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
    await page.evaluate((html) => window.sequencePasteFixture.get().setContent(html), after.html);
    expect(await snapshot(page)).toEqual(after);
    await page.evaluate((json) => window.sequencePasteFixture.mount("primary", json), after.json);
    expect(await snapshot(page)).toEqual(after);
    expect(await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot())).toEqual(peer);
    await expect(page.locator("#peer .semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  });

test("粘贴前后输入各自撤销，粘贴本身只有一个历史事件", async ({ page }) => {
  await page.evaluate(
    (content) => window.sequencePasteFixture.mount("primary", content, "html"),
    sequencePasteContent(),
  );
  const before = await snapshot(page),
    payload = await copied(page);
  await select(page, "丁后续", 1);
  await page.keyboard.insertText("前");
  const typedBefore = await snapshot(page);
  await paste(page, payload);
  const pasted = await snapshot(page);
  expect(pasted.text).toContain("丁前开头");
  await page.keyboard.insertText("后");
  const typedAfter = await snapshot(page);
  expect(typedAfter.text).toContain("丙后后续");
  for (const expected of [pasted, typedBefore, before]) {
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(expected);
  }
  for (const expected of [typedBefore, pasted, typedAfter]) {
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(expected);
  }
});

test("raw大小写/错位/未来身份及非空PM context在解析前拒绝，旧选区不删除", async ({ page }) => {
  const payload = await copied(page);
  const variants = [
    payload.html.replace('data-semlo-editor-ordered-style="mixed"', 'data-semlo-editor-ordered-style="future"'),
    payload.html.replace("<ol", '<ol type="future"'),
    payload.html.replace("<ol", '<ol DATA-SEMLO-EDITOR-LIST-SEQUENCES=\'{"version":2,"sequences":[]}\''),
    payload.html.replace("<p", '<p DATA-SEMLO-EDITOR-LIST-SEQUENCE="foreign"'),
    payload.html.replace("<li", '<li data-semlo-editor-list-restart="false"'),
    payload.html.replace('data-pm-slice="0 0 []"', "data-pm-slice='0 0 [\"orderedList\",{}]'"),
    payload.html.replace(/ data-pm-slice="[^"]*"/, ""),
  ];
  for (const html of variants) {
    expect(html).not.toBe(payload.html);
    await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), sequencePasteContent());
    await select(page, "丁后续", 1, "丁后续", 2);
    const before = await snapshot(page);
    expect((await paste(page, { ...payload, html })).prevented).toBe(true);
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 0, redo: 0 });
    await expect(page.locator("#primary .semlo-editor-list-clipboard-status")).toHaveCount(1);
  }
});

for (const fault of ["html-selection", "parser-selection", "slice-selection", "filter-reject", "before-reenter"])
  test(`宿主${fault}不让旧计划或Fitter写入当前正文`, async ({ page }) => {
    const before = await snapshot(page),
      payload = await copied(page);
    await select(page, "丁后续", 1, "丁后续", 2);
    await page.evaluate((fault) => window.sequencePasteFixture.setFault(fault), fault);
    await paste(page, payload);
    expect(await page.evaluate(() => window.sequencePasteFixture.observed)).toContain(fault);
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 0, redo: 0 });
    await expect(page.locator("#primary .semlo-editor-list-clipboard-status")).toHaveCount(1);
  });

test("解析hook替换为新文档时保留新文档，旧粘贴不追加也不跨实例", async ({ page }) => {
  await page.evaluate((content) => window.sequencePasteFixture.mount("peer", content), sequencePasteContent());
  const peer = await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot());
  const payload = await copied(page);
  await select(page, "丁后续", 1);
  await page.evaluate(() => window.sequencePasteFixture.setFault("html-document"));
  await paste(page, payload);
  expect(await page.evaluate(() => window.sequencePasteFixture.observed)).toContain("html-document");
  expect((await snapshot(page)).text).toBe("宿主新文档");
  expect(await page.evaluate(() => window.sequencePasteFixture.get("peer").getSnapshot())).toEqual(peer);
  await expect(page.locator("#peer .semlo-editor-list-clipboard-status")).toHaveCount(0);
});

test("初始只读和解析期切只读都保留正文与历史", async ({ page }) => {
  const payload = await copied(page);
  for (const during of [false, true]) {
    await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), sequencePasteContent());
    await select(page, "丁后续", 1, "丁后续", 2);
    const before = await snapshot(page);
    await page.evaluate((during) => {
      if (during) window.sequencePasteFixture.setFault("html-readonly");
      else window.sequencePasteFixture.get().setEditable(false);
    }, during);
    await paste(page, payload);
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 0, redo: 0 });
    await expect(page.locator("#primary .semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  }
});

for (const phase of ["html", "before"])
  test(`${phase}阶段销毁不写旧文档，旧DOM事件不影响重挂的新实例`, async ({ page }) => {
    const payload = await copied(page);
    await select(page, "丁后续", 1, "丁后续", 2);
    const before = await page.evaluate(() => window.sequencePasteFixture.get().editor.state.doc.toJSON());
    await page.evaluate((phase) => window.sequencePasteFixture.setFault(phase + "-destroy"), phase);
    await paste(page, payload);
    expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.isDestroyed)).toBe(true);
    expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.state.doc.toJSON())).toEqual(before);
    await expect(page.locator("#primary .semlo-editor-prose")).toHaveCount(0);
    await page.evaluate(
      ({ content, payload }) => {
        window.sequencePasteFixture.mount("primary", content);
        const data = new DataTransfer();
        data.setData("text/html", payload.html);
        data.setData("text/plain", payload.text);
        window.sequencePasteFixture.retiredDOM
          .at(-1)!
          .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      },
      { content: sequencePasteContent(), payload },
    );
    expect((await snapshot(page)).json.content![0].content).toHaveLength(5);
    await select(page, "丁后续", 1);
    await paste(page, payload);
    expect((await snapshot(page)).json.content![0].content).toHaveLength(7);
  });

test("DataTransfer读取异常/缺失/空数据都消费事件且不删除原选区", async ({ page }) => {
  for (const failure of ["throw", "missing", "empty"]) {
    await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), sequencePasteContent());
    await select(page, "丁后续", 1, "丁后续", 2);
    const before = await snapshot(page);
    const prevented = await page.evaluate((failure) => {
      const data = failure === "missing" ? null : new DataTransfer();
      if (failure === "throw")
        Object.defineProperty(data, "getData", {
          value: () => {
            throw new Error("读取失败");
          },
        });
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      window.sequencePasteFixture.get().editor.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    }, failure);
    expect(prevented).toBe(true);
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 0, redo: 0 });
    await expect(page.locator("#primary .semlo-editor-list-clipboard-status")).toHaveCount(1);
  }
});

test("files-only粘贴交回已有宿主文件入口，不被空列表payload保护抢占", async ({ page }) => {
  await select(page, "丁后续", 1, "丁后续", 2);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.sequencePasteFixture.setFault("file-route");
    const data = new DataTransfer();
    data.items.add(new File(["probe"], "probe.png", { type: "image/png" }));
    window.sequencePasteFixture
      .get()
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  expect(await page.evaluate(() => window.sequencePasteFixture.observed)).toContain("file-route");
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 0, redo: 0 });
});

test("custom MIME-only交回宿主内联入口，不能因没有HTML/plain而拦截", async ({ page }) => {
  await select(page, "丁后续", 1, "丁后续", 2);
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.sequencePasteFixture.setFault("custom-route");
    const data = new DataTransfer();
    data.setData("application/x-semlo-host-inline", "host");
    window.sequencePasteFixture
      .get()
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  expect(await page.evaluate(() => window.sequencePasteFixture.observed)).toContain("custom-route");
  await expect(page.locator("#primary ol > li p").last()).toHaveText("丁宿主内联续");
  expect((await snapshot(page)).json.content![0].attrs).toEqual(before.json.content![0].attrs);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

test("公开pasteText的普通单行文字保持原路径和一次撤销", async ({ page }) => {
  await select(page, "丁后续", 1, "丁后续", 2);
  const before = await snapshot(page);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("纯文本"))).toBe(true);
  await expect(page.locator("#primary ol > li p").last()).toHaveText("丁纯文本续");
  expect((await snapshot(page)).json.content![0].attrs).toEqual(before.json.content![0].attrs);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

for (const sample of [
  { gap: "bulletList", target: "甲开头", expected: [1, 1, 2, 3, 1, 2] },
  { gap: "taskList", target: "丙结尾", expected: [1, 1, 2, 1, 2, 3] },
  { gap: "heading", target: "甲开头", expected: [1, 1, 2, 3, 1, 2] },
  { gap: "heading", target: "丙结尾", expected: [1, 1, 2, 1, 2, 3] },
] as const) {
  test(`跨类型续接：${sample.gap} 间隔的 ${sample.target} 可粘贴多行纯文本`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(
      (content) => window.sequencePasteFixture.mount("primary", content),
      linkedTypedPasteContent(sample.gap),
    );
    const before = await snapshot(page);
    await page.evaluate(() => navigator.clipboard.writeText("新\n行"));
    await select(page, sample.target, 1);
    await page.keyboard.press("ControlOrMeta+v");
    const after = await snapshot(page);
    const lists = after.json.content!.filter((node) => node.type === "orderedList");
    expect(lists).toHaveLength(3);
    const version = sample.gap === "heading" ? 3 : 2;
    expect(lists.every((list) => String(list.attrs!.semloEditorListSequenceLink).startsWith(`v${version}:`))).toBe(
      true,
    );
    expect(after.json.content!.some((node) => node.type === sample.gap)).toBe(true);
    expect(await page.evaluate(() => window.sequencePasteFixture.events.at(-1))).toEqual({
      type: "paste",
      trusted: true,
    });
    const numbers = () =>
      page
        .locator("#primary .semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value));
    expect(await numbers()).toEqual([...sample.expected]);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
    const restored = await page.evaluate(({ json, html }) => {
      const fixture = window.sequencePasteFixture;
      fixture.mount("peer", json);
      const fromJson = fixture.get("peer").getSnapshot().json;
      fixture.mount("peer", html);
      return { fromJson, fromHtml: fixture.get("peer").getSnapshot().json };
    }, after);
    expect(restored.fromJson).toEqual(after.json);
    expect(restored.fromHtml).toEqual(after.json);
    if (sample.target === "甲开头") {
      await page.evaluate(() => navigator.clipboard.writeText("再\n续"));
      await select(page, "开头", 1);
      await page.keyboard.press("ControlOrMeta+v");
      const repeated = await snapshot(page);
      const repeatedLists = repeated.json.content!.filter((node) => node.type === "orderedList");
      expect(repeatedLists).toHaveLength(4);
      expect(
        repeatedLists.every((list) => String(list.attrs!.semloEditorListSequenceLink).startsWith(`v${version}:`)),
      ).toBe(true);
      expect(await numbers()).toEqual([1, 1, 2, 3, 4, 1, 2]);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(after);
    }
    const first = sample.target === "甲开头" ? "甲新" : "甲开头";
    await select(page, first, first.length);
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增");
    expect(await numbers()).toEqual(sample.target === "甲开头" ? [1, 1, 2, 3, 4, 1, 2] : [1, 1, 2, 3, 1, 2, 3]);
  });
}

test("可信多行纯文本粘贴拆出正文并接续目标编号，一次撤销恢复", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const before = await snapshot(page);
  const text = "  a. 开头\n  a. 乙中段\n  b. 丙";
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await select(page, "丁后续", 1);
  await page.keyboard.press("ControlOrMeta+v");
  const observed = await page.evaluate(() => ({
    event: window.sequencePasteFixture.events.at(-1),
    parsed: window.sequencePasteFixture.parsedPastes.at(-1),
  }));
  expect(observed.event).toEqual({ type: "paste", trusted: true });
  expect(observed.parsed).toMatchObject({ plain: true, first: "paragraph" });
  const after = await snapshot(page);
  const nodes = after.json.content!;
  expect(nodes.map((node) => node.type)).toEqual(["orderedList", "paragraph", "paragraph", "orderedList", "paragraph"]);
  expect(nodes[0].content!.map((item) => item.content![0].content?.map((part) => part.text).join(""))).toEqual([
    "父",
    "甲开头",
    "乙中段",
    "丙结尾",
    "丁  a. 开头",
  ]);
  expect(nodes[1].content![0].text).toBe("  a. 乙中段");
  expect(nodes[2].content![0].text).toBe("  b. 丙");
  expect(nodes[3].content![0].content![0].content![0].text).toBe("后续");
  expect(nodes[3].content![0].attrs!.semloEditorListSequence).toBe("B");
  expect(
    await page
      .locator("#primary .semlo-editor-prose > ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 1, 2, 3, 4]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
});

test("公开多行pasteText替换目标文字，保留后续独立序列及JSON/HTML往返", async ({ page }) => {
  const before = await snapshot(page);
  await select(page, "甲开头", 1, "甲开头", 2);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("甲一\n乙二\n丙三"))).toBe(
    true,
  );
  const after = await snapshot(page),
    nodes = after.json.content!;
  expect(nodes.map((node) => node.type)).toEqual(["orderedList", "paragraph", "paragraph", "orderedList", "paragraph"]);
  expect(nodes[0].content!.map((item) => item.content![0].content?.map((part) => part.text).join(""))).toEqual([
    "父",
    "甲甲一",
  ]);
  expect(nodes[1].content![0].text).toBe("乙二");
  expect(nodes[2].content![0].text).toBe("丙三");
  expect(nodes[3].content!.map((item) => item.content![0].content?.map((part) => part.text).join(""))).toEqual([
    "头",
    "乙中段",
    "丙结尾",
    "丁后续",
  ]);
  const { semloEditorListSequenceLink: link, ...unchangedAttrs } = nodes[0].attrs!;
  expect(unchangedAttrs).toEqual(before.json.content![0].attrs);
  expect(link).toMatch(/^v1:_:/);
  expect(
    await page
      .locator("#primary .semlo-editor-prose > ol > li")
      .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
  ).toEqual([1, 1, 2, 1, 2, 3]);
  expect(
    await page.evaluate(() => {
      const selection = window.sequencePasteFixture.get().editor.state.selection;
      return { text: selection.$from.parent.textContent, offset: selection.$from.parentOffset };
    }),
  ).toEqual({ text: "丙三", offset: 2 });
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
  const restored = await page.evaluate(({ json, html }) => {
    const fixture = window.sequencePasteFixture;
    fixture.mount("peer", json);
    const fromJson = fixture.get("peer").getSnapshot().json;
    fixture.mount("peer", html);
    return { fromJson, fromHtml: fixture.get("peer").getSnapshot().json };
  }, after);
  expect(restored.fromJson).toEqual(after.json);
  expect(restored.fromHtml).toEqual(after.json);
});

test("带富文本的剪贴板按纯文本模式粘贴时保留每行文字", async ({ page }) => {
  const payload = await copied(page),
    before = await snapshot(page);
  await select(page, "丁后续", 1);
  await page.keyboard.down("Shift");
  await paste(page, payload);
  await page.keyboard.up("Shift");
  expect(await page.evaluate(() => window.sequencePasteFixture.parsedPastes.at(-1)?.plain)).toBe(true);
  const after = await snapshot(page);
  expect(after.json.content!.map((node) => node.type)).toEqual([
    "orderedList",
    "paragraph",
    "paragraph",
    "orderedList",
    "paragraph",
  ]);
  expect(
    after.json
      .content![0].content!.at(-1)!
      .content![0].content!.map((part) => part.text)
      .join(""),
  ).toBe("丁  a. 开头");
  expect(after.json.content![1].content![0].text).toBe("  a. 乙中段");
  expect(after.json.content![2].content![0].text).toBe("  b. 丙");
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

test("多行纯文本解析期间宿主改变选区时保留正文", async ({ page }) => {
  const before = await snapshot(page);
  await select(page, "丁后续", 1);
  await page.evaluate(() => {
    window.sequencePasteFixture.setFault("slice-selection");
    const data = new DataTransfer();
    data.setData("text/plain", "甲\n乙");
    window.sequencePasteFixture
      .get()
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  expect(await page.evaluate(() => window.sequencePasteFixture.observed)).toContain("slice-selection");
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator("#primary .semlo-editor-list-clipboard-status")).toHaveCount(1);
});

test("普通正文粘贴多行纯文本保留空段落及一次历史", async ({ page }) => {
  await page.evaluate(() =>
    window.sequencePasteFixture.mount("primary", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "起终" }] }],
    }),
  );
  const before = await snapshot(page);
  await select(page, "起终", 1);
  expect(
    await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("首行\n\n中行\n\n末行")),
  ).toBe(true);
  const after = await snapshot(page);
  expect(after.json.content!.map((node) => node.content?.map((part) => part.text).join("") ?? "")).toEqual([
    "起首行",
    "",
    "中行",
    "",
    "末行终",
  ]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  await history(page, "redo");
  expect(await snapshot(page)).toEqual(after);
});

test("编号项粘贴多行纯文本保留空段落和目标后缀", async ({ page }) => {
  const before = await snapshot(page);
  await select(page, "丁后续", 1);
  expect(
    await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("首行\n\n中行\n\n末行")),
  ).toBe(true);
  const after = await snapshot(page),
    nodes = after.json.content!;
  expect(nodes.map((node) => node.type)).toEqual([
    "orderedList",
    "paragraph",
    "paragraph",
    "paragraph",
    "paragraph",
    "orderedList",
    "paragraph",
  ]);
  expect(nodes.slice(1, 5).map((node) => node.content?.map((part) => part.text).join("") ?? "")).toEqual([
    "",
    "中行",
    "",
    "末行",
  ]);
  expect(nodes[5].content![0].content![0].content![0].text).toBe("后续");
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

test("宿主自定义纯文本解析器优先，连续空行不触发重复调用", async ({ page }) => {
  await page.evaluate(() =>
    window.sequencePasteFixture.mount(
      "primary",
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "起终" }] }] },
      null,
      true,
    ),
  );
  const before = await snapshot(page);
  await select(page, "起终", 1);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("首行\n\n末行"))).toBe(true);
  expect((await snapshot(page)).text).toBe("起宿主处理终");
  expect(
    await page.evaluate(() => window.sequencePasteFixture.observed.filter((value) => value === "host-text-parser")),
  ).toEqual(["host-text-parser"]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

test("宿主纯文本解析器不接管时，默认流程仍保留空段落", async ({ page }) => {
  await page.evaluate(() =>
    window.sequencePasteFixture.mount(
      "primary",
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "起终" }] }] },
      null,
      "decline",
    ),
  );
  await select(page, "起终", 1);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("首行\n\n末行"))).toBe(true);
  const nodes = (await snapshot(page)).json.content!;
  expect(nodes.map((node) => node.content?.map((part) => part.text).join("") ?? "")).toEqual(["起首行", "", "末行终"]);
  expect(
    await page.evaluate(() => window.sequencePasteFixture.observed.filter((value) => value === "host-text-parser")),
  ).toEqual(["host-text-parser"]);
});

for (const mode of ["late-accept", "late-decline"] as const)
  test(`后置宿主解析器${mode}只运行一次，未接管时保留空段落`, async ({ page }) => {
    await page.evaluate(
      (mode) =>
        window.sequencePasteFixture.mount(
          "primary",
          { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "起终" }] }] },
          null,
          mode,
        ),
      mode,
    );
    const order = await page.evaluate(() => {
      const plugins = window.sequencePasteFixture.get().editor.state.plugins;
      return {
        fallback: plugins.findIndex((plugin) => plugin.props.clipboardTextParser && !plugin.props.transformPasted),
        host: plugins.findIndex((plugin) => plugin.props.clipboardTextParser && plugin.props.transformPasted),
      };
    });
    expect(order.fallback).toBeGreaterThanOrEqual(0);
    expect(order.host).toBeGreaterThan(order.fallback);
    const before = await snapshot(page);
    await select(page, "起终", 1);
    expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("首行\n\n末行"))).toBe(
      true,
    );
    const nodes = (await snapshot(page)).json.content!;
    expect(nodes.map((node) => node.content?.map((part) => part.text).join("") ?? "")).toEqual(
      mode === "late-accept" ? ["起宿主处理终"] : ["起首行", "", "末行终"],
    );
    expect(
      await page.evaluate(() => window.sequencePasteFixture.observed.filter((value) => value === "host-text-parser")),
    ).toEqual(["host-text-parser"]);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
  });

test("纯文本的首尾空行及不同换行符均保留为空段落", async ({ page }) => {
  for (const [text, expected] of [
    ["\n\n首行", ["起", "", "首行终"]],
    ["首行\r\n\r\n末行", ["起首行", "", "末行终"]],
    ["首行\r\r末行", ["起首行", "", "末行终"]],
    ["首行\n\n", ["起首行", "", "终"]],
  ] as const) {
    await page.evaluate(() =>
      window.sequencePasteFixture.mount("primary", {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "起终" }] }],
      }),
    );
    await select(page, "起终", 1);
    expect(await page.evaluate((value) => window.sequencePasteFixture.get().editor.view.pasteText(value), text)).toBe(
      true,
    );
    const nodes = (await snapshot(page)).json.content!;
    expect(nodes.map((node) => node.content?.map((part) => part.text).join("") ?? "")).toEqual([...expected]);
  }
});

test("宿主DOM剪贴板解析器处理多行文字时保留空段落", async ({ page }) => {
  await page.evaluate(() =>
    window.sequencePasteFixture.mount(
      "primary",
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "起终" }] }] },
      null,
      "dom",
    ),
  );
  const before = await snapshot(page);
  await select(page, "起终", 1);
  expect(await page.evaluate(() => window.sequencePasteFixture.get().editor.view.pasteText("首行\n\n末行"))).toBe(true);
  const nodes = (await snapshot(page)).json.content!;
  expect(nodes.map((node) => node.content?.map((part) => part.text).join("") ?? "")).toEqual(["起首行", "", "末行终"]);
  expect(
    await page.evaluate(() => window.sequencePasteFixture.observed.filter((value) => value === "host-dom-parser")),
  ).toEqual(["host-dom-parser"]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
});

test("raw非法或未来indent不能被parse规整后冒充0/8层", async ({ page }) => {
  for (const [level, raw] of [
    [0, "future"],
    [8, "9"],
  ] as const) {
    await page.evaluate(
      (content) => window.sequencePasteFixture.mount("primary", content),
      sequencePasteContent(level),
    );
    const payload = await copied(page);
    const html =
      level === 0
        ? payload.html.replace(/<li/g, `<li data-semlo-editor-list-indent="${raw}"`)
        : payload.html.replace(/data-semlo-editor-list-indent="8"/g, `data-semlo-editor-list-indent="${raw}"`);
    expect(html).not.toBe(payload.html);
    await select(page, "丁后续", 1, "丁后续", 2);
    const before = await snapshot(page);
    await paste(page, { ...payload, html });
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual({ undo: 0, redo: 0 });
  }
});

test("宿主已声明列表/成员属性同值往返保留，源冲突不替换目标属性或删除选区", async ({ page }) => {
  const content = sequencePasteContent();
  content.content![0].attrs!.hostListSetting = "shared";
  content.content![0].content!.forEach((item) => {
    item.attrs!.hostItemSetting = "shared";
  });
  await page.evaluate((content) => window.sequencePasteFixture.mount("primary", content), content);
  const before = await snapshot(page),
    payload = await copied(page);
  await select(page, "丁后续", 1);
  await paste(page, payload);
  const after = await snapshot(page);
  expect(after.json.content![0].content).toHaveLength(7);
  expect(after.json.content![0].attrs!.hostListSetting).toBe("shared");
  expect(after.json.content![0].content!.slice(-3).map((item) => item.attrs!.hostItemSetting)).toEqual([
    "shared",
    "shared",
    "shared",
  ]);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  for (const attribute of ["data-host-list-setting", "data-host-item-setting"]) {
    const html = payload.html.replace(`${attribute}="shared"`, `${attribute}="foreign"`);
    expect(html).not.toBe(payload.html);
    await select(page, "丁后续", 1, "丁后续", 2);
    const historyBefore = await page.evaluate(() => window.sequencePasteFixture.history());
    await paste(page, { ...payload, html });
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.sequencePasteFixture.history())).toEqual(historyBefore);
  }
});

test("普通inline/text和独立空段列表仍走原路径，现有序列完整保留", async ({ page }) => {
  const before = await snapshot(page);
  await select(page, "丁后续", 1, "丁后续", 2);
  await paste(page, { html: "<strong>新</strong>", text: "新" });
  await expect(page.locator("#primary ol > li p").last()).toHaveText("丁新续");
  expect((await snapshot(page)).json.content![0].attrs).toEqual(before.json.content![0].attrs);
  await history(page, "undo");
  expect(await snapshot(page)).toEqual(before);
  const payload = await copied(page);
  await select(page, "footer", 0, "footer", 6);
  await paste(page, payload);
  const after = await snapshot(page);
  expect(after.json.content![0]).toEqual(before.json.content![0]);
  expect(after.json.content!.filter((node) => node.type === "orderedList")).toHaveLength(2);
  expect(
    after.json.content!.filter((node) => node.type === "orderedList")[1].attrs!.semloEditorListSequences,
  ).toBeUndefined();
});
