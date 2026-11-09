import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";

let origin: string;
let stop: () => Promise<void>;

test.beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/list/task-item-conversion-fixture.ts"));
});
test.afterAll(async () => stop());
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.taskConversionEditor?.destroy());
});

const paragraph = (text: string, styled: boolean): JSONContent => ({
  type: "paragraph",
  ...(styled ? { attrs: { textAlign: "center", semloEditorIndent: 1, semloEditorLineHeight: "2" } } : {}),
  content: [{ type: "text", text, ...(styled ? { marks: [{ type: "bold" }] } : {}) }],
});
const snapshot = (page: Page) => page.evaluate(() => window.taskConversionEditor!.getSnapshot());

async function setup(page: Page, sourceStyled: boolean, targetStyled: boolean, heading = false) {
  await page.goto(origin);
  await page.evaluate(
    ({ source, target }) => {
      const host = document.createElement("div");
      host.id = "painter-paragraph";
      document.body.append(host);
      window.taskConversionEditor = window.taskConversionCreate!({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [source, target, { type: "paragraph", content: [{ type: "text", text: "NEXT" }] }],
        },
        onChange: (value) => window.taskConversionEditor!.setContent(value.html),
      });
    },
    {
      source: heading
        ? {
            ...paragraph("SOURCE", sourceStyled),
            type: "heading",
            attrs: { ...paragraph("SOURCE", sourceStyled).attrs, level: 3 },
          }
        : paragraph("SOURCE", sourceStyled),
      target: paragraph("TARGET", targetStyled),
    },
  );
  await page.evaluate(() => {
    const editor = window.taskConversionEditor!.editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 7 });
  });
  const painter = page.locator("#painter-paragraph .semlo-editor-format-painter");
  if (heading) await page.keyboard.press("ControlOrMeta+Shift+s");
  else await painter.click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
}

for (const styled of [true, false]) {
  test(`点击段落时复制${styled ? "显式" : "默认"}样式并可一次撤销`, async ({ page }) => {
    await setup(page, styled, !styled);
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap > p").nth(1).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await snapshot(page);
    const target = after.json.content![1];
    expect(target.attrs).toMatchObject({
      textAlign: styled ? "center" : null,
      semloEditorIndent: styled ? 1 : 0,
      semloEditorLineHeight: styled ? "2" : null,
    });
    expect(target.content![0].marks?.some((mark) => mark.type === "bold") ?? false).toBe(styled);
    expect(after.json.content![2]).toEqual(before.json.content![2]);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

test("拖选段落的一部分只复制文字格式", async ({ page }) => {
  await setup(page, true, false);
  const target = page.locator("#painter-paragraph .tiptap > p").nth(1);
  const points = await target.evaluate((element) => {
    const text = element.firstChild!;
    const start = document.createRange();
    const end = document.createRange();
    start.setStart(text, 0);
    start.setEnd(text, 1);
    end.setStart(text, 2);
    end.setEnd(text, 3);
    const a = start.getBoundingClientRect(),
      b = end.getBoundingClientRect();
    return { x1: a.left + 1, x2: b.right - 1, y: a.top + a.height / 2 };
  });
  await page.mouse.move(points.x1, points.y);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(
    await page.evaluate(() => ({
      text: window.getSelection()?.toString(),
      empty: window.taskConversionEditor!.editor.state.selection.empty,
    })),
  ).toEqual({
    text: "TAR",
    empty: false,
  });
  const after = await snapshot(page);
  expect(after.json.content![1].attrs).toMatchObject({
    textAlign: null,
    semloEditorIndent: 0,
    semloEditorLineHeight: null,
  });
  expect(
    after.json.content![1].content?.map((item) => [
      item.text,
      item.marks?.some((mark) => mark.type === "bold") ?? false,
    ]),
  ).toEqual([
    ["TAR", true],
    ["GET", false],
  ]);
});

for (const heading of [false, true]) {
  test(`${heading ? "标题" : "正文"}来源点击目标后保留光标并可继续输入`, async ({ page }) => {
    await setup(page, true, false, heading);
    const before = await snapshot(page);
    const target = page.locator("#painter-paragraph .tiptap > p").nth(heading ? 0 : 1);
    const point = await target.evaluate((element) => {
      const text = element.firstChild!;
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(text, 3);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      await page.evaluate(() => ({
        collapsed: window.getSelection()?.isCollapsed,
        empty: window.taskConversionEditor!.editor.state.selection.empty,
        offset: window.taskConversionEditor!.editor.state.selection.$from.parentOffset,
      })),
    ).toEqual({ collapsed: true, empty: true, offset: 2 });
    await expect(page.locator("#painter-paragraph .semlo-editor-bubble")).toBeHidden();
    const painted = await snapshot(page);
    expect(painted.json.content![1].type).toBe(heading ? "heading" : "paragraph");
    await page.keyboard.type("X");
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.state.doc.child(1).textContent)).toBe(
      "TAXRGET",
    );
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(painted.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}

test("窄屏快捷键从标题复制样式和标题级别", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await setup(page, true, false, true);
  await page.locator("#painter-paragraph .tiptap > p").first().click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.state.selection.empty)).toBe(true);
  await expect(page.locator("#painter-paragraph .semlo-editor-bubble")).toBeHidden();
  expect(after.json.content![1].type).toBe("heading");
  expect(after.json.content![1].attrs).toMatchObject({
    level: 3,
    textAlign: "center",
    semloEditorIndent: 1,
    semloEditorLineHeight: "2",
  });
  expect(after.json.content![1].content![0].marks?.some((mark) => mark.type === "bold")).toBe(true);
});

async function setupBlocks(page: Page, blocks: JSONContent[], source: string) {
  await page.goto(origin);
  await page.evaluate((content) => {
    const host = document.createElement("div");
    host.id = "painter-paragraph";
    document.body.append(host);
    window.taskConversionEditor = window.taskConversionCreate!({
      element: host,
      outline: false,
      content: { type: "doc", content },
      onChange: (value) => window.taskConversionEditor!.setContent(value.html),
    });
  }, blocks);
  await page.evaluate((sourceText) => {
    const editor = window.taskConversionEditor!.editor;
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === sourceText) from = pos;
    });
    if (from < 0) throw new Error("来源文字不存在");
    editor.commands.focus();
    editor.commands.setTextSelection({ from, to: from + sourceText.length });
  }, source);
  const painter = page.locator("#painter-paragraph .semlo-editor-format-painter");
  await painter.click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
}

const item = (text: string, styled = false): JSONContent => ({ type: "listItem", content: [paragraph(text, styled)] });
const bullet = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });

for (const targetIndex of [0, 1, 2]) {
  test(`正文格式刷将二级无序列表第 ${targetIndex + 1} 个叶项变为正文并保留其余层级`, async ({ page }) => {
    const children = [item("CHILD A"), item("CHILD B"), item("CHILD C")];
    for (const child of children)
      child.content![0].content![0].marks = [
        { type: "link", attrs: { href: "https://example.com/" } },
        { type: "italic" },
      ];
    children[targetIndex] = item("TARGET");
    await setupBlocks(
      page,
      [
        paragraph("SOURCE", true),
        bullet({ type: "listItem", content: [paragraph("PARENT", false), bullet(...children)] }, item("TAIL")),
        paragraph("NEXT", false),
      ],
      "SOURCE",
    );
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator("#painter-paragraph .tiptap > p").filter({ hasText: "TARGET" })).toHaveText("TARGET");
    const after = await snapshot(page);
    expect(after.text.split(/\n+/)).toEqual(before.text.split(/\n+/));
    expect(findTextblock(after.json, "TARGET")?.attrs).toMatchObject({
      textAlign: "center",
      semloEditorIndent: 1,
      semloEditorLineHeight: "2",
    });
    expect(findTextblock(after.json, "TARGET")?.content?.[0].marks).toContainEqual({ type: "bold" });
    for (const retained of [
      "PARENT",
      "TAIL",
      "NEXT",
      ...["CHILD A", "CHILD B", "CHILD C"].filter((_, i) => i !== targetIndex),
    ])
      expect(findTextblock(after.json, retained)).toEqual(findTextblock(before.json, retained));
    await expect(page.locator('#painter-paragraph li[data-semlo-editor-list-indent="1"]')).toHaveCount(2);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.state.selection.empty)).toBe(true);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

test("连续正文格式刷可继续转换已展平的二级无序叶项，每次独立撤销", async ({ page }) => {
  await setupBlocks(
    page,
    [
      paragraph("SOURCE", true),
      bullet(
        { type: "listItem", content: [paragraph("PARENT", false), bullet(item("TARGET"), item("CHILD KEEP"))] },
        item("TAIL"),
      ),
      paragraph("NEXT", false),
    ],
    "SOURCE",
  );
  const before = await snapshot(page);
  const painter = page.locator("#painter-paragraph .semlo-editor-format-painter");
  await painter.click();
  await painter.dblclick();
  await expect(painter).toHaveAttribute("data-semlo-editor-painter-continuous", "true");
  const root = page.locator("#painter-paragraph .tiptap");
  await root.getByText("TARGET", { exact: true }).click();
  await expect(root.locator(":scope > p").filter({ hasText: "TARGET" })).toHaveText("TARGET");
  const first = await snapshot(page);
  await root.getByText("CHILD KEEP", { exact: true }).click();
  await expect(root.locator(":scope > p").filter({ hasText: "CHILD KEEP" })).toHaveText("CHILD KEEP");
  const second = await snapshot(page);
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  expect(findTextblock(second.json, "CHILD KEEP")?.content?.[0].marks).toContainEqual({ type: "bold" });
  expect(findTextblock(second.json, "TAIL")).toEqual(findTextblock(before.json, "TAIL"));
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(first.json);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(first.json);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(second.json);
});

for (const otherList of ["bulletList", "orderedList"] as const) {
  test(`正文格式刷不展开包含额外 ${otherList} 子树的列表`, async ({ page }) => {
    const nested: JSONContent = {
      type: "listItem",
      content: [paragraph("OTHER", false), { type: otherList, content: [item("DEEP KEEP")] }],
    };
    await setupBlocks(
      page,
      [
        paragraph("SOURCE", true),
        bullet({ type: "listItem", content: [paragraph("PARENT", false), bullet(item("TARGET"), nested)] }),
        paragraph("NEXT", false),
      ],
      "SOURCE",
    );
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator("#painter-paragraph .tiptap > p").filter({ hasText: "TARGET" })).toHaveCount(0);
    const after = await snapshot(page);
    const beforeChildren = before.json.content![1].content![0].content![1].content!;
    const afterChildren = after.json.content![1].content![0].content![1].content!;
    expect(afterChildren[0].type).toBe("listItem");
    expect(afterChildren[0].attrs).toEqual(beforeChildren[0].attrs);
    expect(afterChildren[1]).toEqual(beforeChildren[1]);
    expect(findTextblock(after.json, "TARGET")?.content?.[0].marks).toContainEqual({ type: "bold" });
    expect(findTextblock(after.json, "PARENT")).toEqual(findTextblock(before.json, "PARENT"));
    expect(findTextblock(after.json, "NEXT")).toEqual(findTextblock(before.json, "NEXT"));
    expect(after.text).toBe(before.text);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}

function findTextblock(node: JSONContent, text: string): JSONContent | undefined {
  if (["paragraph", "heading"].includes(node.type ?? "") && node.content?.some((child) => child.text === text))
    return node;
  for (const child of node.content ?? []) {
    const found = findTextblock(child, text);
    if (found) return found;
  }
}

const containedTargets: Array<[string, (node: JSONContent) => JSONContent]> = [
  ["引用", (node) => ({ type: "blockquote", content: [node, paragraph("RETAIN", false)] })],
  ["高亮块", (node) => ({ type: "callout", attrs: { tone: "green" }, content: [node, paragraph("RETAIN", false)] })],
  [
    "折叠正文",
    (node) => ({
      type: "details",
      attrs: { open: true },
      content: [
        { type: "detailsSummary", content: [{ type: "text", text: "SUMMARY" }] },
        { type: "detailsContent", content: [node, paragraph("RETAIN", false)] },
      ],
    }),
  ],
  [
    "分栏",
    (node) => ({
      type: "semloEditorColumns",
      content: [
        { type: "semloEditorColumn", content: [node, paragraph("RETAIN", false)] },
        { type: "semloEditorColumn", content: [paragraph("OTHER", false)] },
      ],
    }),
  ],
  [
    "表格单元格",
    (node) => ({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [node, paragraph("RETAIN", false)] },
            { type: "tableCell", content: [paragraph("OTHER", false)] },
          ],
        },
      ],
    }),
  ],
];

for (const [name, wrap] of containedTargets) {
  test(`标题格式刷转换${name}中的正文并保留容器及历史`, async ({ page }) => {
    const source = { ...paragraph("SOURCE", true), type: "heading", attrs: { level: 3, textAlign: "center" } };
    await setupBlocks(page, [source, wrap(paragraph("TARGET", false)), paragraph("NEXT", false)], "SOURCE");
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await snapshot(page);
    const target = findTextblock(after.json, "TARGET");
    expect(target?.type).toBe("heading");
    expect(target?.attrs).toMatchObject({ level: 3, textAlign: "center" });
    expect(target?.content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(findTextblock(after.json, "RETAIN")).toEqual(findTextblock(before.json, "RETAIN"));
    expect(findTextblock(after.json, "OTHER")).toEqual(findTextblock(before.json, "OTHER"));
    expect(findTextblock(after.json, "NEXT")).toEqual(findTextblock(before.json, "NEXT"));
    expect(after.json.content?.[1].type).toBe(before.json.content?.[1].type);
    expect(after.json.content?.[1].attrs).toEqual(before.json.content?.[1].attrs);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.state.selection.empty)).toBe(true);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

test("引用中的标题可作为格式来源，正文来源可将引用内标题变回正文", async ({ page }) => {
  const heading = { ...paragraph("SOURCE", true), type: "heading", attrs: { level: 2 } };
  await setupBlocks(page, [{ type: "blockquote", content: [heading] }, paragraph("TARGET", false)], "SOURCE");
  await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(findTextblock((await snapshot(page)).json, "TARGET")?.attrs?.level).toBe(2);

  const root = page.locator("#painter-paragraph .tiptap");
  await page.evaluate(() => {
    const editor = window.taskConversionEditor!.editor;
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.text === "TARGET") pos = at;
    });
    editor.commands.focus();
    editor.commands.setTextSelection({ from: pos, to: pos + "TARGET".length });
    editor.commands.setParagraph();
  });
  await page.locator("#painter-paragraph .semlo-editor-format-painter").click();
  await root.getByText("SOURCE", { exact: true }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const result = (await snapshot(page)).json;
  expect(findTextblock(result, "SOURCE")?.type).toBe("paragraph");
  expect(result.content?.[0].type).toBe("blockquote");
});

test("正文格式刷转换折叠标题，撤销恢复折叠与正文", async ({ page }) => {
  await setupBlocks(
    page,
    [
      paragraph("SOURCE", true),
      { ...paragraph("TARGET", false), type: "heading", attrs: { level: 2, semloEditorHeadingFolded: true } },
      paragraph("NEXT", false),
    ],
    "SOURCE",
  );
  const before = await snapshot(page);
  await expect(page.getByText("NEXT", { exact: true })).toBeHidden();
  await page.locator("#painter-paragraph .tiptap > h2").click();
  await expect(page.getByText("NEXT", { exact: true })).toBeVisible();
  expect((await snapshot(page)).json.content![1].type).toBe("paragraph");
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  await expect(page.getByText("NEXT", { exact: true })).toBeHidden();
});

test("正文格式刷将标题变为正文，撤销恢复标题", async ({ page }) => {
  await setupBlocks(
    page,
    [paragraph("SOURCE", true), { ...paragraph("TARGET", false), type: "heading", attrs: { level: 3 } }],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > h3").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content![1].type).toBe("paragraph");
  expect(after.json.content![1].content![0].marks?.some((mark) => mark.type === "bold")).toBe(true);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("列表来源将相邻正文变为列表项并支持回写和撤销", async ({ page }) => {
  await setupBlocks(page, [bullet(item("SOURCE", true), item("OTHER")), paragraph("TARGET", false)], "SOURCE");
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > p").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content).toHaveLength(1);
  expect(after.json.content![0].content?.map((entry) => entry.content![0].content![0].text)).toEqual([
    "SOURCE",
    "OTHER",
    "TARGET",
  ]);
  expect(after.json.content![0].content![2].content![0].content![0].marks?.some((mark) => mark.type === "bold")).toBe(
    true,
  );
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("正文来源将无序列表中间项变为正文并保留其他项", async ({ page }) => {
  await setupBlocks(page, [paragraph("SOURCE", true), bullet(item("BEFORE"), item("TARGET"), item("AFTER"))], "SOURCE");
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap li p").filter({ hasText: "TARGET" }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content?.map((entry) => entry.type)).toEqual([
    "paragraph",
    "bulletList",
    "paragraph",
    "bulletList",
  ]);
  expect(after.json.content![2].content![0].text).toBe("TARGET");
  expect(after.json.content![2].content![0].marks?.some((mark) => mark.type === "bold")).toBe(true);
  expect(after.json.content![1].content![0].content![0].content![0].text).toBe("BEFORE");
  expect(after.json.content![3].content![0].content![0].content![0].text).toBe("AFTER");
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("标题来源刷向空段落后，输入继承文字格式", async ({ page }) => {
  await setupBlocks(
    page,
    [{ ...paragraph("SOURCE", true), type: "heading", attrs: { level: 3 } }, { type: "paragraph" }],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > p").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect((await snapshot(page)).json.content![1].type).toBe("heading");
  await page.keyboard.type("NEW");
  const after = await snapshot(page);
  expect(after.json.content![1].content![0].marks?.some((mark) => mark.type === "bold")).toBe(true);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json.content![1].content).toBeUndefined();
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

const taskItem = (text: string, checked = false, styled = false): JSONContent => ({
  type: "taskItem",
  attrs: { checked },
  content: [paragraph(text, styled)],
});
const taskList = (...items: JSONContent[]): JSONContent => ({ type: "taskList", content: items });
const orderedList = (versioned: boolean, ...items: JSONContent[]): JSONContent => ({
  type: "orderedList",
  ...(versioned
    ? { attrs: { semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] } } }
    : {}),
  content: versioned
    ? items.map((entry) => ({ ...entry, attrs: { ...entry.attrs, semloEditorListSequence: "A" } }))
    : items,
});

function startedList(versioned: boolean, ...items: JSONContent[]): JSONContent {
  const list = orderedList(versioned, ...items);
  list.attrs = {
    ...list.attrs,
    start: 7,
    ...(versioned
      ? { semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 7, origin: "initial" }] } }
      : {}),
  };
  return list;
}

function textblockParent(node: JSONContent, text: string): string | undefined {
  for (const child of node.content ?? []) {
    if (["paragraph", "heading"].includes(child.type ?? "") && child.content?.some((part) => part.text === text))
      return node.type;
    const found = textblockParent(child, text);
    if (found) return found;
  }
}

for (const [name, wrap] of containedTargets) {
  test(`正文格式刷转换${name}内的平铺列表项`, async ({ page }) => {
    await setupBlocks(
      page,
      [
        paragraph("SOURCE", true),
        wrap(bullet(item("BEFORE"), item("TARGET"), item("AFTER"))),
        paragraph("NEXT", false),
      ],
      "SOURCE",
    );
    const before = await snapshot(page);
    expect(textblockParent(before.json, "TARGET")).toBe("listItem");
    const painter = page.locator("#painter-paragraph .semlo-editor-format-painter");
    await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    const after = await snapshot(page);
    expect(textblockParent(after.json, "TARGET")).not.toBe("listItem");
    expect(findTextblock(after.json, "TARGET")?.content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
    for (const text of ["BEFORE", "AFTER", "RETAIN", "NEXT"])
      expect(findTextblock(after.json, text)).toEqual(findTextblock(before.json, text));
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

test("引用内列表来源可将相邻正文接入列表", async ({ page }) => {
  await setupBlocks(
    page,
    [{ type: "blockquote", content: [bullet(item("SOURCE", true), item("BEFORE")), paragraph("TARGET", false)] }],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  const quote = after.json.content![0];
  expect(quote.content?.map((node) => node.type)).toEqual(["bulletList"]);
  expect(quote.content?.[0].content?.map((node) => node.content?.[0].content?.[0].text)).toEqual([
    "SOURCE",
    "BEFORE",
    "TARGET",
  ]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("容器内待办互刷时复制完成状态", async ({ page }) => {
  await setupBlocks(
    page,
    [taskList(taskItem("SOURCE", true, true)), { type: "blockquote", content: [taskList(taskItem("TARGET"))] }],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content![1].content?.[0].content?.[0].attrs?.checked).toBe(true);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("容器内新版编号列表可接入相邻正文", async ({ page }) => {
  await setupBlocks(
    page,
    [
      {
        type: "blockquote",
        content: [orderedList(true, item("SOURCE", true), item("BEFORE")), paragraph("TARGET", false)],
      },
    ],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  const list = after.json.content![0].content?.[0];
  expect(list?.type).toBe("orderedList");
  expect(list?.content?.map((node) => node.attrs?.semloEditorListSequence)).toEqual(["A", "A", "A"]);
  expect(list?.content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(["SOURCE", "BEFORE", "TARGET"]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const versioned of [false, true]) {
  for (const first of [false, true])
    test(`正文格式刷转换容器内${versioned ? "新版" : "旧版"}编号列表的${first ? "首项" : "末项"}`, async ({ page }) => {
      await setupBlocks(
        page,
        [
          paragraph("SOURCE", true),
          {
            type: "blockquote",
            content: [
              orderedList(versioned, ...(first ? [item("TARGET"), item("BEFORE")] : [item("BEFORE"), item("TARGET")])),
            ],
          },
        ],
        "SOURCE",
      );
      const before = await snapshot(page);
      await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
      await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const after = await snapshot(page);
      const content = after.json.content![1].content!;
      expect(content.map((node) => node.type)).toEqual(
        first ? ["paragraph", "orderedList"] : ["orderedList", "paragraph"],
      );
      const list = content[first ? 1 : 0];
      const converted = content[first ? 0 : 1];
      expect(list.content?.[0].content?.[0].content?.[0].text).toBe("BEFORE");
      expect(converted.content?.[0].text).toBe("TARGET");
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(before.json);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(after.json);
    });
}

test("容器内编号列表中间项不安全拆分时保留原文", async ({ page }) => {
  await setupBlocks(
    page,
    [
      paragraph("SOURCE", true),
      { type: "blockquote", content: [orderedList(true, item("BEFORE"), item("TARGET"), item("AFTER"))] },
    ],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect((await snapshot(page)).json).toEqual(before.json);
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
});

test("有序列表来源将相邻正文接入编号列表", async ({ page }) => {
  await setupBlocks(
    page,
    [orderedList(false, item("SOURCE", true), item("OTHER")), paragraph("TARGET", false)],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > p").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content).toHaveLength(1);
  expect(after.json.content![0].type).toBe("orderedList");
  expect(after.json.content![0].content?.map((entry) => entry.content![0].content![0].text)).toEqual([
    "SOURCE",
    "OTHER",
    "TARGET",
  ]);
  expect(after.json.content![0].content![2].content![0].content![0].marks?.some((mark) => mark.type === "bold")).toBe(
    true,
  );
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("新版编号列表来源刷向相邻正文时保留序列身份", async ({ page }) => {
  await setupBlocks(page, [orderedList(true, item("SOURCE"), item("OTHER")), paragraph("TARGET", false)], "SOURCE");
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > p").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content).toHaveLength(1);
  expect(after.json.content![0].content?.map((entry) => entry.attrs?.semloEditorListSequence)).toEqual(["A", "A", "A"]);
  expect(
    await page
      .locator("#painter-paragraph .tiptap ol > li")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
  ).toEqual(["1", "2", "3"]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const versioned of [false, true]) {
  for (const beforeSource of [false, true]) {
    test(`${versioned ? "新版" : "旧版"}自定义起点列表将${beforeSource ? "前方" : "后方"}正文接入`, async ({
      page,
    }) => {
      const list = startedList(versioned, item("SOURCE", true), item("OTHER"));
      const target = paragraph("TARGET", false);
      await setupBlocks(page, beforeSource ? [target, list] : [list, target], "SOURCE");
      const before = await snapshot(page);
      await page.locator("#painter-paragraph .tiptap > p").click();
      await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const after = await snapshot(page);
      expect(after.json.content).toHaveLength(1);
      expect(after.json.content![0].attrs?.start).toBe(7);
      expect(after.json.content![0].content?.map((entry) => entry.content![0].content![0].text)).toEqual(
        beforeSource ? ["TARGET", "SOURCE", "OTHER"] : ["SOURCE", "OTHER", "TARGET"],
      );
      expect(
        await page.locator("#painter-paragraph .tiptap ol").evaluate((node: HTMLOListElement) => {
          let current = node.start;
          return Array.from(node.children, (child) => {
            const value = child.getAttribute("value");
            if (value !== null) current = Number(value);
            return String(current++);
          });
        }),
      ).toEqual(["7", "8", "9"]);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(before.json);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(after.json);
      await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
      expect((await snapshot(page)).json).toEqual(after.json);
    });
  }

  test(`${versioned ? "新版" : "旧版"}自定义起点列表的中间项转换后保持续接`, async ({ page }) => {
    await setupBlocks(
      page,
      [paragraph("SOURCE", true), startedList(versioned, item("BEFORE"), item("TARGET"), item("AFTER"))],
      "SOURCE",
    );
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await snapshot(page);
    expect(after.json.content?.map((entry) => entry.type)).toEqual([
      "paragraph",
      "orderedList",
      "paragraph",
      "orderedList",
    ]);
    expect(after.json.content![2].content![0].text).toBe("TARGET");
    expect(
      await page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
    ).toEqual(["7", "8"]);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.locator("#painter-paragraph .tiptap ol li p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("NEW");
    expect(
      await page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
    ).toEqual(["7", "8", "9"]);
  });

  for (const first of [false, true]) {
    test(`引用内${versioned ? "新版" : "旧版"}自定义起点列表的${first ? "首项" : "末项"}可转换`, async ({ page }) => {
      const items = first ? [item("TARGET"), item("OTHER")] : [item("OTHER"), item("TARGET")];
      await setupBlocks(
        page,
        [paragraph("SOURCE", true), { type: "blockquote", content: [startedList(versioned, ...items)] }],
        "SOURCE",
      );
      const before = await snapshot(page);
      await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
      await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const after = await snapshot(page);
      expect(after.json.content![1].content?.map((entry) => entry.type)).toEqual(
        first ? ["paragraph", "orderedList"] : ["orderedList", "paragraph"],
      );
      expect(await page.locator("#painter-paragraph .tiptap ol").evaluate((node: HTMLOListElement) => node.start)).toBe(
        7,
      );
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(before.json);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(after.json);
    });
  }
}

for (const versioned of [false, true]) {
  test(`${versioned ? "新版" : "旧版"}编号列表中间项刷成正文后，前后编号保持续接`, async ({ page }) => {
    await setupBlocks(
      page,
      [paragraph("SOURCE", true), orderedList(versioned, item("BEFORE"), item("TARGET"), item("AFTER"))],
      "SOURCE",
    );
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await snapshot(page);
    expect(after.json.content?.map((entry) => entry.type)).toEqual([
      "paragraph",
      "orderedList",
      "paragraph",
      "orderedList",
    ]);
    expect(after.json.content![2].content![0].text).toBe("TARGET");
    expect(after.json.content![2].content![0].marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(
      await page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
    ).toEqual(["1", "2"]);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.state.selection.empty)).toBe(true);
    await page.locator("#painter-paragraph .tiptap ol li p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("NEW");
    expect(
      await page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
    ).toEqual(["1", "2", "3"]);
  });
}

test("待办来源复制勾选状态及文字格式", async ({ page }) => {
  await setupBlocks(page, [taskList(taskItem("SOURCE", true, true)), paragraph("TARGET", false)], "SOURCE");
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > p").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content).toHaveLength(1);
  expect(after.json.content![0].content![1].attrs?.checked).toBe(true);
  expect(after.json.content![0].content![1].content![0].content![0].marks?.some((mark) => mark.type === "bold")).toBe(
    true,
  );
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("正文来源将待办列表中的目标项变为正文", async ({ page }) => {
  await setupBlocks(
    page,
    [paragraph("SOURCE", true), taskList(taskItem("BEFORE"), taskItem("TARGET", true), taskItem("AFTER"))],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap li p").filter({ hasText: "TARGET" }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content?.map((entry) => entry.type)).toEqual(["paragraph", "taskList", "paragraph", "taskList"]);
  expect(after.json.content![2].content![0].text).toBe("TARGET");
  expect(after.json.content![2].content![0].marks?.some((mark) => mark.type === "bold")).toBe(true);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("待办之间刷格式时同步完成状态", async ({ page }) => {
  await setupBlocks(page, [taskList(taskItem("SOURCE", true, true), taskItem("TARGET"))], "SOURCE");
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap li p").filter({ hasText: "TARGET" }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content![0].content![1].attrs?.checked).toBe(true);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("待办刷向新版编号列表中间项时保留两侧续接", async ({ page }) => {
  await setupBlocks(
    page,
    [taskList(taskItem("SOURCE", true)), orderedList(true, item("BEFORE"), item("TARGET"), item("AFTER"))],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content?.map((entry) => entry.type)).toEqual([
    "taskList",
    "orderedList",
    "taskList",
    "orderedList",
  ]);
  expect(after.json.content![2].content![0].attrs?.checked).toBe(true);
  expect(after.json.content![1].attrs?.semloEditorListSequenceLink).toMatch(/^v2:/);
  expect(after.json.content![3].attrs?.semloEditorListSequenceLink).toMatch(/^v2:/);
  expect(
    await page
      .locator("#painter-paragraph .tiptap ol > li")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
  ).toEqual(["1", "2"]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("标题刷向新版编号列表中间项时保留两侧续接", async ({ page }) => {
  await setupBlocks(
    page,
    [
      { ...paragraph("SOURCE", false), type: "heading", attrs: { level: 2 } },
      orderedList(true, item("BEFORE"), item("TARGET"), item("AFTER")),
    ],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content?.map((entry) => entry.type)).toEqual(["heading", "orderedList", "heading", "orderedList"]);
  expect(after.json.content![2].attrs?.level).toBe(2);
  expect(after.json.content![1].attrs?.semloEditorListSequenceLink).toMatch(/^v3:/);
  expect(after.json.content![3].attrs?.semloEditorListSequenceLink).toMatch(/^v3:/);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

function continuedList(
  version: 1 | 2 | 3,
  start: number,
  previous: string | null,
  next: string | null,
  ...names: string[]
) {
  const list = orderedList(true, ...names.map((name) => item(name)));
  return {
    ...list,
    attrs: {
      ...list.attrs,
      semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
      semloEditorListSequenceLink: `v${version}:${previous ?? "_"}:${next ?? "_"}`,
    },
  };
}

for (const sample of [
  { version: 1, targetVersion: 1, source: "paragraph", gap: "paragraph" },
  { version: 1, targetVersion: 2, source: "taskList", gap: "paragraph" },
  { version: 1, targetVersion: 3, source: "heading", gap: "paragraph" },
  { version: 2, targetVersion: 2, source: "bulletList", gap: "taskList" },
  { version: 2, targetVersion: 3, source: "heading", gap: "taskList" },
  { version: 3, targetVersion: 3, source: "paragraph", gap: "heading" },
  { version: 3, targetVersion: 3, source: "taskList", gap: "heading" },
] as const) {
  test(`格式刷处理已有 v${sample.version} 续接：${sample.source} 转换中间项`, async ({ page }) => {
    const source =
      sample.source === "paragraph"
        ? paragraph("SOURCE", true)
        : sample.source === "heading"
          ? { ...paragraph("SOURCE", true), type: "heading", attrs: { level: 2 } }
          : sample.source === "taskList"
            ? taskList(taskItem("SOURCE", true, true))
            : bullet(item("SOURCE", true));
    const gap =
      sample.gap === "paragraph"
        ? paragraph("GAP", false)
        : sample.gap === "heading"
          ? { ...paragraph("GAP", false), type: "heading", attrs: { level: 3 } }
          : taskList(taskItem("GAP"));
    await setupBlocks(
      page,
      [
        source,
        continuedList(sample.version, 1, null, "edge", "BEFORE", "TARGET", "AFTER"),
        gap,
        continuedList(sample.version, 4, "edge", null, "TAIL", "LAST"),
        paragraph("END", false),
      ],
      "SOURCE",
    );
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await snapshot(page);
    const lists = after.json.content!.filter((node) => node.type === "orderedList");
    expect(lists).toHaveLength(3);
    const links = lists.map((list) => String(list.attrs!.semloEditorListSequenceLink).split(":"));
    expect(links.map((link) => link[0])).toEqual(Array(3).fill(`v${sample.targetVersion}`));
    expect(links[0][2]).toBe(links[1][1]);
    expect(links[1][2]).toBe(links[2][1]);
    expect(findTextblock(after.json, "TARGET")?.type).toBe(sample.source === "heading" ? "heading" : "paragraph");
    expect(textblockParent(after.json, "TARGET")).toBe(
      sample.source === "taskList" ? "taskItem" : sample.source === "bulletList" ? "listItem" : "doc",
    );
    expect(findTextblock(after.json, "GAP")).toEqual(findTextblock(before.json, "GAP"));
    const values = () =>
      page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value")));
    expect(await values()).toEqual(["1", "2", "3", "4"]);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
    await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "BEFORE" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("NEW");
    expect(await values()).toEqual(["1", "2", "3", "4", "5"]);
  });
}

test("格式刷保留交错转换项的来源并接回编号", async ({ page }) => {
  const target = taskItem("TARGET");
  target.attrs!.semloEditorListSequenceConversion = JSON.stringify([1, "edge", "B"]);
  await setupBlocks(
    page,
    [
      bullet(item("SOURCE")),
      interleavedList("v2:_:edge", 1, 1, ["A0", "B0"]),
      taskList(target),
      interleavedList("v2:edge:_", 2, 2, ["A1", "B1"]),
    ],
    "SOURCE",
  );
  const before = await snapshot(page);
  const painter = page.locator("#painter-paragraph .semlo-editor-format-painter");
  await page.getByText("TARGET", { exact: true }).click();
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  const converted = await snapshot(page);
  const convertedList = converted.json.content!.find(
    (node) => node.type === "bulletList" && node !== converted.json.content![0],
  );
  expect(convertedList?.content?.[0].attrs?.semloEditorListSequenceConversion).toBe(JSON.stringify([1, "edge", "B"]));
  await page.evaluate(() => {
    const editor = window.taskConversionEditor!.editor;
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "A0") from = pos;
    });
    editor.commands.focus();
    editor.commands.setTextSelection({ from, to: from + 2 });
  });
  await painter.click();
  await page.getByText("TARGET", { exact: true }).click();
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  const restored = await snapshot(page);
  const list = restored.json.content!.find((node) => node.type === "orderedList")!;
  expect(list.content!.map((node) => node.attrs!.semloEditorListSequence)).toEqual(["A", "B", "B", "A", "B"]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(converted.json);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const sourceKind of ["paragraph", "taskList", "heading"] as const) {
  test(`格式刷将续接中的单项片段转为${sourceKind}并连接两侧`, async ({ page }) => {
    const source =
      sourceKind === "paragraph"
        ? paragraph("SOURCE", true)
        : sourceKind === "heading"
          ? { ...paragraph("SOURCE", true), type: "heading", attrs: { level: 2 } }
          : taskList(taskItem("SOURCE", true, true));
    await setupBlocks(
      page,
      [
        source,
        continuedList(1, 1, null, "left", "BEFORE"),
        paragraph("GAP1", false),
        continuedList(1, 2, "left", "right", "TARGET"),
        paragraph("GAP2", false),
        continuedList(1, 3, "right", null, "AFTER"),
      ],
      "SOURCE",
    );
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
    await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await snapshot(page);
    const lists = after.json.content!.filter((node) => node.type === "orderedList");
    expect(lists).toHaveLength(2);
    const version = sourceKind === "paragraph" ? 1 : sourceKind === "taskList" ? 2 : 3;
    expect(lists.map((node) => node.attrs!.semloEditorListSequenceLink)).toEqual([
      `v${version}:_:left`,
      `v${version}:left:_`,
    ]);
    expect(
      await page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
    ).toEqual(["1", "2"]);
    expect(findTextblock(after.json, "GAP1")).toEqual(findTextblock(before.json, "GAP1"));
    expect(findTextblock(after.json, "GAP2")).toEqual(findTextblock(before.json, "GAP2"));
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

for (const side of ["left", "right"] as const) {
  for (const version of [1, 3] as const) {
    test(`v${version} 续接列表${side}来源格式刷接入相邻块`, async ({ page }) => {
      const gap =
        version === 1
          ? paragraph("TARGET", false)
          : { ...paragraph("TARGET", false), type: "heading", attrs: { level: 3 } };
      await setupBlocks(
        page,
        [
          continuedList(version, 1, null, "edge", side === "left" ? "SOURCE" : "LEFT1", "LEFT2"),
          gap,
          continuedList(version, 3, "edge", null, side === "right" ? "SOURCE" : "RIGHT1", "RIGHT2"),
          paragraph("END", false),
        ],
        "SOURCE",
      );
      const before = await snapshot(page);
      await page.locator("#painter-paragraph .tiptap").getByText("TARGET", { exact: true }).click();
      await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const after = await snapshot(page);
      const lists = after.json.content!.filter((node) => node.type === "orderedList");
      expect(lists).toHaveLength(2);
      expect(lists.map((node) => node.attrs!.semloEditorListSequenceLink)).toEqual([
        `v${version}:_:edge`,
        `v${version}:edge:_`,
      ]);
      expect(lists.map((node) => node.content!.length)).toEqual(side === "left" ? [3, 2] : [2, 3]);
      expect(
        await page
          .locator("#painter-paragraph .tiptap ol > li")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
      ).toEqual(["1", "2", "3", "4", "5"]);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(before.json);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(after.json);
    });
  }
}

test("续接项保留旧重启标记时格式刷按版本化序列处理", async ({ page }) => {
  const left = continuedList(1, 1, null, "edge", "BEFORE", "TARGET", "AFTER");
  left.content![1].attrs!.semloEditorListRestart = true;
  await setupBlocks(
    page,
    [paragraph("SOURCE", true), left, paragraph("GAP", false), continuedList(1, 4, "edge", null, "TAIL")],
    "SOURCE",
  );
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: "TARGET" }).click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(findTextblock(after.json, "TARGET")?.type).toBe("paragraph");
  expect(
    await page
      .locator("#painter-paragraph .tiptap ol > li")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
  ).toEqual(["1", "2", "3"]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

function interleavedList(link: string | null, first: number, second: number, names: [string, string]) {
  const list = orderedList(true, item(names[0]), item(names[1]));
  list.content![1].attrs!.semloEditorListSequence = "B";
  list.attrs = {
    ...list.attrs,
    semloEditorListSequences: {
      version: 1,
      sequences: [
        { id: "A", start: first, origin: "initial" },
        { id: "B", start: second, origin: "restart" },
      ],
    },
    ...(link ? { semloEditorListSequenceLink: link } : {}),
  };
  return list;
}

for (const side of ["left", "right"] as const) {
  for (const version of [2, 3] as const) {
    test(`格式刷从 v${version} 交错序列的 ${side} 项接入相邻正文`, async ({ page }) => {
      await setupBlocks(
        page,
        [
          interleavedList(`v${version}:_:edge`, 1, 1, [side === "left" ? "SOURCE" : "LEFTA", "LEFTB"]),
          paragraph("TARGET", false),
          interleavedList(`v${version}:edge:_`, 2, 2, ["RIGHTA", side === "right" ? "SOURCE" : "RIGHTB"]),
        ],
        "SOURCE",
      );
      const before = await snapshot(page);
      await page.locator("#painter-paragraph .tiptap > p").click();
      await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const after = await snapshot(page);
      const lists = after.json.content!.filter((node) => node.type === "orderedList");
      expect(lists.map((list) => list.content!.map((child) => child.attrs!.semloEditorListSequence))).toEqual(
        side === "left"
          ? [
              ["A", "B", "A"],
              ["A", "B"],
            ]
          : [
              ["A", "B"],
              ["B", "A", "B"],
            ],
      );
      expect(
        await page
          .locator("#painter-paragraph .tiptap ol > li")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
      ).toEqual(side === "left" ? ["1", "1", "2", "3", "2"] : ["1", "1", "2", "2", "3"]);
      await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
      expect((await snapshot(page)).json).toEqual(after.json);
      expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
      expect((await snapshot(page)).json).toEqual(before.json);
    });
  }
}

test("格式刷从无续接的交错编号项接入相邻正文时沿用来源序列", async ({ page }) => {
  await setupBlocks(page, [interleavedList(null, 1, 1, ["SOURCE", "OTHER"]), paragraph("TARGET", false)], "SOURCE");
  const before = await snapshot(page);
  await page.locator("#painter-paragraph .tiptap > p").click();
  await expect(page.locator("#painter-paragraph .semlo-editor-format-painter")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const after = await snapshot(page);
  expect(after.json.content![0].content!.map((child) => child.attrs!.semloEditorListSequence)).toEqual(["A", "B", "A"]);
  expect(
    await page
      .locator("#painter-paragraph .tiptap ol > li")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value"))),
  ).toEqual(["1", "1", "2"]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const sample of [
  { version: 0, target: "TARGET-B", source: "B1", expected: ["1", "2", "1", "3"] },
  { version: 0, target: "TARGET-B", source: "A0", expected: ["1", "2", "1", "3"] },
  { version: 2, target: "TARGET-B", source: "B1", expected: ["1", "2", "1", "3", "4", "2"] },
  { version: 3, target: "TARGET-A", source: "A0", expected: ["1", "1", "2", "2", "3", "3"] },
] as const) {
  test(`格式刷从 ${sample.source} 转换并接回 v${sample.version} 交错序列的 ${sample.target}`, async ({ page }) => {
    const left = interleavedList(sample.version ? `v${sample.version}:_:edge` : null, 1, 1, [
      "A0",
      sample.target === "TARGET-B" ? "TARGET-B" : "B0",
    ]);
    left.content!.push(
      { ...item(sample.target === "TARGET-A" ? "TARGET-A" : "A1"), attrs: { semloEditorListSequence: "A" } },
      { ...item("B1"), attrs: { semloEditorListSequence: "B" } },
      { ...item("A2"), attrs: { semloEditorListSequence: "A" } },
    );
    const blocks: JSONContent[] = [paragraph("SOURCE", true), left];
    if (sample.version) {
      blocks.push(
        sample.version === 2
          ? taskList(taskItem("GAP"))
          : { ...paragraph("GAP", false), type: "heading", attrs: { level: 3 } },
        interleavedList(`v${sample.version}:edge:_`, 4, 3, ["TAILA", "TAILB"]),
      );
    }
    await setupBlocks(page, blocks, "SOURCE");
    const before = await snapshot(page);
    await page.locator("#painter-paragraph .tiptap ol li p").filter({ hasText: sample.target }).click();
    const painter = page.locator("#painter-paragraph .semlo-editor-format-painter");
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    const converted = await snapshot(page);
    expect(findTextblock(converted.json, sample.target)?.type).toBe("paragraph");
    const values = () =>
      page
        .locator("#painter-paragraph .tiptap ol > li")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value")));
    expect(await values()).toEqual([...sample.expected]);
    await page.evaluate((source) => {
      const editor = window.taskConversionEditor!.editor;
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === source) from = pos;
      });
      if (from < 0) throw new Error("来源编号项不存在");
      editor.commands.focus();
      editor.commands.setTextSelection({ from, to: from + source.length });
    }, sample.source);
    await painter.click();
    await expect(painter).toHaveAttribute("aria-pressed", "true");
    await page.locator("#painter-paragraph .tiptap > p").filter({ hasText: sample.target }).click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    const restored = await snapshot(page);
    const lists = restored.json.content!.filter((node) => node.type === "orderedList");
    const selected = lists
      .flatMap((list) => list.content ?? [])
      .find((entry) => entry.content?.[0].content?.some((part) => part.text === sample.target));
    expect(selected?.attrs?.semloEditorListSequence).toBe(sample.target === "TARGET-B" ? "B" : "A");
    expect(await values()).toEqual(sample.version ? ["1", "1", "2", "2", "3", "4", "3"] : ["1", "1", "2", "2", "3"]);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), restored.html);
    expect((await snapshot(page)).json).toEqual(restored.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(converted.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}
