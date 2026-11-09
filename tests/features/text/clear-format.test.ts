import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type {} from "../../fixtures/text/clear-format-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/text/clear-format-fixture.ts" } },
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
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.clearFormatFixture));
  await page.evaluate(() => window.clearFormatFixture.mount("A"));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.clearFormatFixture?.destroyAll());
});
const host = (page: Page, id = "A") => page.locator(`#clear-format-${id}`);
const snapshot = (page: Page, id = "A") => page.evaluate((id) => window.clearFormatFixture.snapshot(id), id);
const shortcut = (page: Page) => page.keyboard.press("ControlOrMeta+\\");
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (content: JSONContent[]): JSONContent => ({ type: "paragraph", content });

const formats = [
  { name: "bold", text: "B" },
  { name: "italic", text: "I" },
  { name: "underline", text: "U" },
  { name: "strike", text: "S" },
  { name: "code", text: "C" },
  { name: "highlight", text: "H", attrs: { color: "#ffe799" } },
  { name: "subscript", text: "L" },
  { name: "superscript", text: "R" },
  {
    name: "textStyle",
    text: "T",
    attrs: {
      fontFamily: "monospace",
      fontSize: "24px",
      color: "#225588",
      semloEditorGradient: "linear-gradient(90deg, #2abcbf, #3836dd)",
    },
  },
];

for (const [label, mark, menu] of [
  ["斜体", "italic", false],
  ["下划线", "underline", false],
  ["删除线", "strike", false],
  ["上标", "superscript", true],
  ["下标", "subscript", true],
  ["行内代码", "code", true],
] as const) {
  test(`${label}默认入口应用到混合选区，保留链接、其他字形及后文并可撤销重做`, async ({ page }) => {
    await page.evaluate(() => {
      window.clearFormatFixture.mount(
        "A",
        '<p><a href="https://example.com/"><span style="color:#df2a3f;font-size:24px"><strong>甲</strong></span>乙</a>丙</p><p>TAIL</p>',
        "html",
      );
      window.clearFormatFixture.select("A", 1, 3);
    });
    const before = await snapshot(page);
    const toolbar = host(page).getByRole("toolbar", { name: "文本格式" });
    if (menu) {
      await toolbar.getByRole("button", { name: "上下标", exact: true }).click();
      await page
        .getByRole("menu", { name: "更多文本样式" })
        .getByRole("menuitem", { name: label, exact: true })
        .click();
    } else await toolbar.getByRole("button", { name: label, exact: true }).click();
    const after = await snapshot(page);
    const nodes = after.json.content![0].content!;
    for (const index of [0, 1]) {
      expect(nodes[index].marks).toContainEqual({ type: mark });
      expect(nodes[index].marks!.filter((value) => value.type !== mark)).toEqual(
        before.json.content![0].content![index].marks,
      );
    }
    expect(nodes[2]).toEqual(before.json.content![0].content![2]);
    expect(after.json.content![1]).toEqual(before.json.content![1]);
    expect(after.selection).toEqual(before.selection);
    expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.clearFormatFixture.redo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

test("九种内置文字格式清理保留宿主语义、未选内容、块属性和文档字体，HTML精确回写不破坏历史", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    attrs: { semloEditorDocumentFontFamily: "serif" },
    content: [
      {
        ...paragraph(
          formats.map((format) =>
            text(format.text, [
              { type: format.name, ...(format.attrs ? { attrs: format.attrs } : {}) },
              ...(format.name === "bold"
                ? [
                    {
                      type: "link",
                      attrs: { href: "https://example.com/#semantic", target: "_blank", rel: "nofollow noopener" },
                    },
                    { type: "domainToken", attrs: { token: "keep" } },
                  ]
                : []),
            ]),
          ),
        ),
        attrs: { textAlign: "center", semloEditorIndent: 1, semloEditorLineHeight: "2" },
      },
      paragraph([text("UNTOUCHED", [{ type: "bold" }, { type: "textStyle", attrs: { color: "#334455" } }])]),
    ],
  };
  await page.evaluate((content) => {
    window.clearFormatFixture.mount("A", content, "html");
    window.clearFormatFixture.select("A", 1, 10);
  }, content);
  const before = await snapshot(page);
  const original = before.json as JSONContent;
  expect(original.attrs!.semloEditorDocumentFontFamily).toBe("serif");
  expect(original.content![0].attrs).toMatchObject({ semloEditorIndent: 1, semloEditorLineHeight: "2" });
  const names = new Set(original.content![0].content!.flatMap((node) => node.marks?.map((mark) => mark.type) ?? []));
  for (const format of formats) expect(names.has(format.name), format.name).toBe(true);
  await host(page).getByRole("button", { name: "清除文字格式", exact: true }).click();
  const after = await snapshot(page);
  const result = after.json as JSONContent;
  expect(result.attrs).toEqual(original.attrs);
  expect(result.content![0].attrs).toEqual(original.content![0].attrs);
  expect(result.content![1]).toEqual(original.content![1]);
  expect(result.content![0].content!.map((node) => node.text).join("")).toBe("BIUSCHLRT");
  expect(result.content![0].content![0].marks).toEqual(
    original.content![0].content![0].marks!.filter((mark) => mark.type !== "bold"),
  );
  expect(result.content![0].content!.slice(1).every((node) => !node.marks?.length)).toBe(true);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes).toHaveLength(1);
  expect(after.changes[0].json).toEqual(after.json);
  expect(after.undo).toBe(1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.clearFormatFixture.redo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("真实Mod+反斜杠只清理部分链接文字，保留完整链接目标和选区，JSON回写可撤销重做", async ({ page }) => {
  await page.evaluate(() => {
    window.clearFormatFixture.mount(
      "A",
      '<p><a href="https://example.com/" target="_blank" rel="nofollow noopener"><strong>abcd</strong></a><em>outside</em></p>',
      "json",
    );
    window.clearFormatFixture.selectText("A", "abcd", 1, 3);
  });
  const before = await snapshot(page);
  await shortcut(page);
  const after = await snapshot(page);
  const original = before.json as JSONContent,
    result = after.json as JSONContent;
  const link = original.content![0].content![0].marks!.find((mark) => mark.type === "link");
  expect(result.content![0].content!.map((node) => node.text)).toEqual(["a", "bc", "d", "outside"]);
  for (const node of result.content![0].content!.slice(0, 3)) {
    expect(node.marks!.find((mark) => mark.type === "link")).toEqual(link);
    expect(node.marks!.some((mark) => mark.type === "bold")).toBe(node.text !== "bc");
  }
  expect(result.content![0].content!.at(-1)).toEqual(original.content![0].content!.at(-1));
  expect(after.selection).toEqual(before.selection);
  expect(after.selected).toBe("bc");
  expect(after.changes).toHaveLength(1);
  expect(after.undo).toBe(1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.clearFormatFixture.redo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("空光标清理后续输入格式，存储链接及宿主语义保留且不改已有文字", async ({ page }) => {
  await page.evaluate(() => {
    window.clearFormatFixture.mount(
      "A",
      '<p><a href="https://example.com/"><strong><span data-domain-token="keep">abcd</span></strong></a></p>',
    );
    window.clearFormatFixture.selectText("A", "abcd", 2, 2);
  });
  const before = await snapshot(page);
  await shortcut(page);
  const cleared = await snapshot(page);
  expect(cleared.json).toEqual(before.json);
  expect(cleared.selection).toEqual(before.selection);
  expect(cleared.storedMarks!.map((mark) => mark.type).sort()).toEqual(["domainToken", "link"]);
  expect(cleared.undo).toBe(before.undo);
  expect(cleared.changes).toHaveLength(0);
  await page.keyboard.insertText("X");
  const typed = await snapshot(page);
  const nodes = (typed.json as JSONContent).content![0].content!;
  expect(nodes.map((node) => node.text).join("")).toBe("abXcd");
  expect(
    nodes
      .find((node) => node.text === "X")!
      .marks!.map((mark) => mark.type)
      .sort(),
  ).toEqual(["domainToken", "link"]);
  expect(typed.undo).toBe(1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("宿主拒绝清理不改变文字、链接、选区或历史，解除拒绝后快捷键正常", async ({ page }) => {
  await page.evaluate(() => {
    window.clearFormatFixture.selectText("A", "正文加粗");
    window.clearFormatFixture.reject("A", true);
  });
  const before = await snapshot(page);
  await host(page).getByRole("button", { name: "清除文字格式", exact: true }).click();
  const rejected = await snapshot(page);
  expect(rejected.rejected).toBe(1);
  expect(rejected.json).toEqual(before.json);
  expect(rejected.selection).toEqual(before.selection);
  expect([rejected.undo, rejected.redo]).toEqual([before.undo, before.redo]);
  expect(rejected.changes).toHaveLength(0);
  await page.evaluate(() => window.clearFormatFixture.reject("A", false));
  await shortcut(page);
  const after = await snapshot(page);
  await expect(host(page).locator(".semlo-editor-prose strong")).toHaveCount(1);
  await expect(host(page).locator('.semlo-editor-prose a[href="https://example.com/"]')).toHaveCount(1);
  expect(after.undo).toBe(1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("只读与销毁不会把快捷键作用到其他实例", async ({ page }) => {
  await page.evaluate(() => {
    window.clearFormatFixture.mount("B");
    window.clearFormatFixture.selectText("A", "正文加粗");
    window.clearFormatFixture.editable("A", false);
  });
  const beforeA = await snapshot(page),
    beforeB = await snapshot(page, "B");
  // 只读会隐藏主工具栏，仍检查其保留按钮的禁用状态，避免 role 查询等待一个不可见控件。
  expect(await host(page).locator('button[aria-label="清除文字格式"]').isDisabled()).toBe(true);
  const readonly = host(page).locator(".semlo-editor-prose");
  // 宿主使只读区域可聚焦，确认快捷键真实发送到该实例，而不是落在页面其他位置。
  await readonly.evaluate((element) => {
    element.tabIndex = 0;
    element.focus();
  });
  await expect(readonly).toBeFocused();
  await readonly.press("ControlOrMeta+\\");
  expect((await snapshot(page)).json).toEqual(beforeA.json);
  expect((await snapshot(page, "B")).json).toEqual(beforeB.json);
  await page.evaluate(() => {
    window.clearFormatFixture.destroy("A");
    window.clearFormatFixture.selectText("B", "正文加粗");
  });
  await shortcut(page);
  await expect(host(page, "B").locator(".semlo-editor-prose strong")).toHaveCount(1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("B"))).toBe(true);
  expect((await snapshot(page, "B")).json).toEqual(beforeB.json);
});

test("单元格选区按独立范围清理，保留未选列的格式及全部链接", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [0, 1].map((row) => ({
          type: "tableRow",
          content: [0, 1].map((column) => ({
            type: "tableCell",
            content: [
              paragraph([
                text(`r${row}c${column}`, [
                  { type: "bold" },
                  { type: "link", attrs: { href: `https://example.com/r${row}c${column}` } },
                ]),
              ]),
            ],
          })),
        })),
      },
    ],
  };
  await page.evaluate((content) => {
    window.clearFormatFixture.mount("A", content);
    window.clearFormatFixture.selectColumn("A", 0);
  }, content);
  const before = await snapshot(page);
  expect(before.selection.type).toBe("cell");
  await shortcut(page);
  const after = await snapshot(page);
  const rows = (after.json as JSONContent).content![0].content!;
  rows.forEach((row, rowIndex) =>
    row.content!.forEach((cell, column) => {
      const node = cell.content![0].content![0];
      expect(node.text).toBe(`r${rowIndex}c${column}`);
      expect(node.marks!.some((mark) => mark.type === "bold")).toBe(column === 1);
      expect(node.marks!.find((mark) => mark.type === "link")!.attrs!.href).toBe(
        `https://example.com/r${rowIndex}c${column}`,
      );
    }),
  );
  expect(after.selection).toEqual(before.selection);
  expect(after.undo).toBe(1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.clearFormatFixture.redo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("清除混合标题和正文的文字格式，保留链接、选区及一次撤销重做", async ({ page }) => {
  const editor = page.locator("#clear-format-A");
  const prose = editor.locator(".semlo-editor-prose");
  await prose.click();
  await page.keyboard.press("ControlOrMeta+a");
  const before = await page.evaluate(() => window.clearFormatFixture.snapshot("A"));
  await expect(prose.locator("strong")).toHaveCount(2);
  expect(await prose.locator('a[href="https://example.com/"]').count()).toBe(1);
  await editor.getByRole("button", { name: "清除文字格式", exact: true }).click();
  const after = await page.evaluate(() => window.clearFormatFixture.snapshot("A"));
  await expect(prose.locator('a[href="https://example.com/"]')).toHaveCount(1);
  await expect(prose.locator("strong")).toHaveCount(0);
  expect(after.selection).toEqual(before.selection);
  expect(after.selected).toBe(before.selected);
  await expect(prose.locator("h3")).toHaveText("标题样本");
  await expect(prose.locator("p")).toHaveText("正文加粗与示例链接后文");
  expect(after.undo).toBe(before.undo + 1);
  expect(await page.evaluate(() => window.clearFormatFixture.undo("A"))).toBe(true);
  expect((await page.evaluate(() => window.clearFormatFixture.snapshot("A"))).json).toEqual(before.json);
  expect(await page.evaluate(() => window.clearFormatFixture.redo("A"))).toBe(true);
  expect((await page.evaluate(() => window.clearFormatFixture.snapshot("A"))).json).toEqual(after.json);
});
