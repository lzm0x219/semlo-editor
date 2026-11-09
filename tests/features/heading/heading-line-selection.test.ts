import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (content: JSONContent[] = []): JSONContent => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});

async function mount(page: Page, content: JSONContent) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate((value) => window.__semloRequireFixture("mountHeadingEndBoundary")(value), content);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const selection = editor.state.selection;
    const native = window.getSelection();
    return {
      json: editor.getJSON(),
      selection: {
        anchor: selection.anchor,
        head: selection.head,
        anchorType: selection.$anchor.parent.type.name,
        anchorOffset: selection.$anchor.parentOffset,
        headType: selection.$head.parent.type.name,
        headOffset: selection.$head.parentOffset,
        text: native?.toString() ?? null,
        nativeCollapsed: native?.isCollapsed ?? null,
        focused: editor.view.hasFocus(),
      },
    };
  });
}

for (const key of ["Home", "End"] as const)
  test(`普通正文 Shift+${key} 只选择当前行`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [paragraph([text("SAFE")]), paragraph([text("ABCD")]), paragraph([text("TAIL")])],
    };
    await mount(page, content);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("ABCD", 2, 2));
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    await page.keyboard.press(`Shift+${key}`);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await inspect(page)).selection).toMatchObject({
      anchorOffset: 2,
      headOffset: key === "Home" ? 0 : 4,
      text: key === "Home" ? "AB" : "CD",
    });
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
      { type: "paragraph", content: [{ type: "text", text: key === "Home" ? "CD" : "AB" }] },
      { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

for (const key of ["Home", "End"] as const)
  test(`无法核实缩放时正文 Shift+${key} 保留选区`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [paragraph([text("SAFE")]), paragraph([text("ABCD")]), paragraph([text("TAIL")])],
    };
    await mount(page, content);
    await page.addStyleTag({ content: ".semlo-editor-prose { zoom: 1.5; }" });
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("ABCD", 1, 2));
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    await page.keyboard.press(`Shift+${key}`);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await inspect(page)).selection).toEqual(before.selection);
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
      { type: "paragraph", content: [{ type: "text", text: "ACD" }] },
      { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

for (const key of ["Home", "End"] as const)
  test(`西里尔正文 Shift+${key} 只选择当前行`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [paragraph([text("SAFE")]), paragraph([text("Привет")]), paragraph([text("TAIL")])],
    };
    await mount(page, content);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("Привет", 2, 2));
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    await page.keyboard.press(`Shift+${key}`);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await inspect(page)).selection).toMatchObject({ text: key === "Home" ? "Пр" : "ивет" });
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content?.at(-1)).toMatchObject(paragraph([text("TAIL")]));
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

for (const key of ["Home", "End"] as const)
  for (const direction of ["forward", "reverse"] as const)
    test(`正文已有 ${direction} 选区时 Shift+${key} 保留方向并扩至行端`, async ({ page }) => {
      const content: JSONContent = {
        type: "doc",
        content: [paragraph([text("SAFE")]), paragraph([text("ABCD")]), paragraph([text("TAIL")])],
      };
      await mount(page, content);
      await page.evaluate((way) => {
        const probe = window.__semloRequireFixture("headingEndBoundary");
        probe.select("ABCD", way === "forward" ? 1 : 2, way === "forward" ? 2 : 1);
      }, direction);
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const before = await inspect(page);
      await page.keyboard.press(`Shift+${key}`);
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const start = key === "Home" ? 0 : 1;
      const end = key === "Home" ? 2 : 4;
      expect((await inspect(page)).selection).toMatchObject({
        anchorOffset: direction === "forward" ? start : end,
        headOffset: direction === "forward" ? end : start,
        text: key === "Home" ? "AB" : "BCD",
      });
      await page.keyboard.press("Backspace");
      expect((await inspect(page)).json.content).toMatchObject([
        { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
        { type: "paragraph", content: [{ type: "text", text: key === "Home" ? "CD" : "A" }] },
        { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
      ]);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await inspect(page)).json).toEqual(before.json);
    });

for (const blockType of ["paragraph", "heading"] as const)
  for (const direction of ["forward", "reverse"] as const)
    test(`跨块选区可扩至自动换行的 ${blockType} 行尾：${direction}`, async ({ page }) => {
      const line = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
      const content: JSONContent = {
        type: "doc",
        content: [
          paragraph([text("SOURCE")]),
          blockType === "heading"
            ? { type: "heading", attrs: { level: 3 }, content: [text(line)] }
            : paragraph([text(line)]),
          paragraph([text("TAIL")]),
        ],
      };
      await mount(page, content);
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#heading-end-boundary");
        if (host) host.style.width = "240px";
      });
      const lineEnd = await page.evaluate((value) => {
        const { editor } = window.__semloRequireFixture("headingEndBoundary").controller;
        let start = -1;
        editor.state.doc.descendants((node, position) => {
          if (node.isTextblock && node.textContent === value) start = position + 1;
        });
        let top: number | undefined;
        for (let i = 0; i < value.length; i++) {
          const from = editor.view.domAtPos(start + i, 1);
          const to = editor.view.domAtPos(start + i + 1, -1);
          const range = document.createRange();
          range.setStart(from.node, from.offset);
          range.setEnd(to.node, to.offset);
          const box = range.getBoundingClientRect();
          if (top === undefined) top = box.top;
          else if (box.top !== top) return i;
        }
        return value.length;
      }, line);
      expect(lineEnd).toBeGreaterThan(2);
      expect(lineEnd).toBeLessThan(line.length);
      await page.evaluate(
        ({ value, way }) => {
          const probe = window.__semloRequireFixture("headingEndBoundary");
          if (way === "forward") probe.select("SOURCE", 2, 2);
          else probe.select(value, 2, 2);
        },
        { value: line, way: direction },
      );
      for (let i = 0; i < 7; i++)
        await page.keyboard.press(direction === "forward" ? "Shift+ArrowRight" : "Shift+ArrowLeft");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const before = await inspect(page);
      expect(before.selection).toMatchObject({ anchorOffset: 2, headOffset: 2 });
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      expect((await inspect(page)).selection).toMatchObject(
        direction === "forward" ? { anchorOffset: 2, headOffset: lineEnd } : { anchorOffset: lineEnd, headOffset: 2 },
      );
      await page.keyboard.press("Backspace");
      const after = await inspect(page);
      expect(JSON.stringify(after.json)).toContain(line.slice(lineEnd));
      expect(after.json.content?.at(-1)).toMatchObject(paragraph([text("TAIL")]));
      await page.keyboard.press("ControlOrMeta+z");
      expect((await inspect(page)).json).toEqual(before.json);
    });

for (const direction of ["forward", "reverse"] as const)
  test(`跨普通段落的 ${direction} 选区 Shift+Home 不越过前文`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("SAFE")]),
        paragraph([text("ABCD")]),
        paragraph([text("EFGH")]),
        paragraph([text("TAIL")]),
      ],
    };
    await mount(page, content);
    await page.evaluate((value) => {
      const probe = window.__semloRequireFixture("headingEndBoundary");
      if (value === "forward") probe.select("ABCD", 2, 2);
      else probe.select("EFGH", 2, 2);
    }, direction);
    for (let i = 0; i < 5; i++)
      await page.keyboard.press(direction === "forward" ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    expect(before.selection).toMatchObject({ anchorOffset: 2, headOffset: 2 });
    await page.keyboard.press("Shift+Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await inspect(page)).selection).toMatchObject(
      direction === "forward" ? { anchorOffset: 0, headOffset: 2 } : { anchorOffset: 2, headOffset: 0 },
    );
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
      { type: "paragraph", content: [{ type: "text", text: "GH" }] },
      { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

for (const direction of ["forward", "reverse"] as const)
  test(`跨标题与正文的 ${direction} 选区 Shift+End 不越过后文`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("before")]),
        { type: "heading", attrs: { level: 3 }, content: [text("AAAA"), { type: "hardBreak" }, text("BBBB")] },
        paragraph([text("after")]),
        paragraph([text("TAIL")]),
        paragraph([text("LAST")]),
      ],
    };
    await mount(page, content);
    await page.evaluate((value) => {
      const probe = window.__semloRequireFixture("headingEndBoundary");
      if (value === "forward") probe.select("AAAABBBB", 8, 8);
      else probe.select("after", 2, 2);
    }, direction);
    for (let i = 0; i < 4; i++)
      await page.keyboard.press(direction === "forward" ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    expect(before.selection.text).toBe("B\naf");
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const selection = (await inspect(page)).selection;
    expect(selection.text).toBe("B\nafter");
    expect(selection).toMatchObject(
      direction === "forward"
        ? { anchorType: "heading", anchorOffset: 8, headType: "paragraph", headOffset: 5 }
        : { anchorType: "paragraph", anchorOffset: 5, headType: "heading", headOffset: 8 },
    );
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      {
        type: "heading",
        content: [{ type: "text", text: "AAAA" }, { type: "hardBreak" }, { type: "text", text: "BBB" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
      { type: "paragraph", content: [{ type: "text", text: "LAST" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

test("跨普通段落的 Shift+End 不越过后文", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [paragraph([text("AAAA")]), paragraph([text("BBBB")]), paragraph([text("TAIL")])],
  };
  await mount(page, content);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("AAAA", 2, 2));
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  expect(before.selection).toMatchObject({ anchorOffset: 2, headOffset: 2 });
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toMatchObject({ anchorOffset: 2, headOffset: 4 });
  await page.keyboard.press("Backspace");
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "AA" }] },
    { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

for (const [listType, itemType] of [
  ["bulletList", "listItem"],
  ["orderedList", "listItem"],
  ["taskList", "taskItem"],
] as const)
  for (const direction of ["forward", "reverse"] as const)
    test(`跨${listType}列表项的 ${direction} 选区 Shift+End 保留后文`, async ({ page }) => {
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: listType,
            content: [
              { type: itemType, content: [paragraph([text("AAAA")])] },
              { type: itemType, content: [paragraph([text("BBBB")])] },
            ],
          },
          paragraph([text("TAIL")]),
        ],
      };
      await mount(page, content);
      await page.evaluate((value) => {
        const probe = window.__semloRequireFixture("headingEndBoundary");
        if (value === "forward") probe.select("AAAA", 2, 2);
        else probe.select("BBBB", 2, 2);
      }, direction);
      const steps = listType === "orderedList" && direction === "reverse" ? 6 : 5;
      for (let i = 0; i < steps; i++)
        await page.keyboard.press(direction === "forward" ? "Shift+ArrowRight" : "Shift+ArrowLeft");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const before = await inspect(page);
      expect(before.selection).toMatchObject({ anchorOffset: 2, headOffset: 2 });
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      expect((await inspect(page)).selection).toMatchObject(
        direction === "forward" ? { anchorOffset: 2, headOffset: 4 } : { anchorOffset: 4, headOffset: 2 },
      );
      await page.keyboard.press("Backspace");
      expect((await inspect(page)).json.content?.at(-1)).toMatchObject(paragraph([text("TAIL")]));
      await page.keyboard.press("ControlOrMeta+z");
      expect((await inspect(page)).json).toEqual(before.json);
    });

for (const mark of ["bold", "italic"])
  test(`混合${mark}格式的单行标题仍能从行内选到行首`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("前文")]),
        {
          type: "heading",
          attrs: { level: 3 },
          content: [text("标题"), { type: "text", text: "甲乙", marks: [{ type: mark }] }],
        },
        paragraph([text("后文")]),
      ],
    };
    await mount(page, content);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("标题甲乙", 3, 3));
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    await page.keyboard.press("Shift+Home");
    expect((await inspect(page)).selection).toMatchObject({ text: "标题甲", anchorOffset: 3, headOffset: 0 });
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "前文" }] },
      { type: "heading", content: [{ type: "text", text: "乙", marks: [{ type: mark }] }] },
      { type: "paragraph", content: [{ type: "text", text: "后文" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

for (const level of [1, 3, 6])
  test(`H${level} 标题内换行后的 Shift+Home 只选到当前行首`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("前文甲乙")]),
        {
          type: "heading",
          attrs: { level },
          content: [text("标题甲乙"), { type: "hardBreak" }, text("下行丙丁")],
        },
        paragraph([text("后文戊己")]),
      ],
    };
    await mount(page, content);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("标题甲乙下行丙丁", 8, 8));
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const before = await inspect(page);
    await page.keyboard.press("Shift+Home");
    expect((await inspect(page)).selection).toMatchObject({
      text: "下行丙",
      anchorType: "heading",
      anchorOffset: 8,
      headType: "heading",
      headOffset: 5,
    });
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "前文甲乙" }] },
      {
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: "标题甲乙" }, { type: "hardBreak" }, { type: "text", text: "丁" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "后文戊己" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });

test("标题换行后的光标位于字素内部时保留原选区", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: [text("A"), { type: "hardBreak" }, text("x😀y")] },
      paragraph([text("NEXT")]),
    ],
  };
  await mount(page, content);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("Ax😀y", 4, 4));
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  expect(before.selection).toMatchObject({ anchorType: "heading", anchorOffset: 4, nativeCollapsed: true });
  await page.keyboard.press("Shift+Home");
  const after = await inspect(page);
  expect(after.json).toEqual(before.json);
  expect(after.selection).toEqual(before.selection);
});

for (const delay of [0, 700])
  test(`换行后输入并删除的撤销分组：停顿 ${delay}ms`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [text("first"), { type: "hardBreak" }] },
        paragraph([text("NEXT")]),
      ],
    };
    await mount(page, content);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("first", 6, 6));
    await page.keyboard.type("wxyz");
    if (delay) await page.waitForTimeout(delay);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+Home");
    expect((await inspect(page)).selection.text).toBe("wxy");
    await page.keyboard.press("Backspace");
    expect((await inspect(page)).json.content).toMatchObject([
      {
        type: "heading",
        content: [{ type: "text", text: "first" }, { type: "hardBreak" }, { type: "text", text: "z" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json.content).toMatchObject([
      {
        type: "heading",
        content: [
          { type: "text", text: "first" },
          { type: "hardBreak" },
          ...(delay ? [{ type: "text", text: "wxyz" }] : []),
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ]);
  });

for (const { transform, indent } of [
  { transform: "rotate(90deg)", indent: -10 },
  { transform: "rotate(-90deg)", indent: 0 },
  { transform: "scaleX(0.01) rotate(-90deg)", indent: 0 },
])
  test(`闭合 Shadow DOM 旋转中的换行标题不会跨视觉行扩选：${transform}`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("before")]),
        { type: "heading", attrs: { level: 3 }, content: [text("M"), { type: "hardBreak" }, text("MMMMMMMM")] },
        paragraph([text("after")]),
      ],
    };
    await mount(page, content);
    await page.evaluate((value) => {
      const host = document.querySelector("#heading-end-boundary")!;
      const shell = document.createElement("div");
      document.body.append(shell);
      const root = shell.attachShadow({ mode: "closed" });
      const wrapper = document.createElement("div");
      wrapper.style.transform = value;
      wrapper.style.transformOrigin = "0 0";
      wrapper.append(document.createElement("slot"));
      root.append(wrapper);
      shell.append(host);
    }, transform);
    await page.addStyleTag({
      content: `#heading-end-boundary h3 { width: 20px !important; font: 20px/26px Arial !important; text-indent: ${indent}px !important; overflow-wrap: anywhere !important; word-break: break-all !important; }`,
    });
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("MMMMMMMMM", 5, 5));
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const lineLefts = await page.locator("#heading-end-boundary h3").evaluate((heading) => {
      const node = Array.from(heading.childNodes)
        .reverse()
        .find((child) => child.nodeType === Node.TEXT_NODE)!;
      const range = document.createRange();
      return [0, 1, 2].map((offset) => {
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        return box.left;
      });
    });
    expect(new Set(lineLefts).size).toBeGreaterThan(1);
    const before = await inspect(page);
    await page.keyboard.press("Shift+Home");
    const after = await inspect(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection).toEqual(before.selection);
  });

test("编辑器位于闭合 Shadow DOM 时行选择不会误删前文", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("before")]),
      { type: "heading", attrs: { level: 3 }, content: [text("AAAA"), { type: "hardBreak" }, text("BBBB")] },
      paragraph([text("after")]),
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate((value) => {
    const shell = document.createElement("div");
    document.body.append(shell);
    const root = shell.attachShadow({ mode: "closed" });
    window.__semloRequireFixture("mountHeadingEndBoundary")(value, 850, false, root);
  }, content);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("AAAABBBB", 8, 8));
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  expect(before.selection).toMatchObject({ anchorType: "heading", anchorOffset: 8 });
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toEqual(before.selection);
  await page.keyboard.press("Backspace");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    {
      type: "heading",
      content: [{ type: "text", text: "AAAA" }, { type: "hardBreak" }, { type: "text", text: "BBB" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "after" }] },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

for (const mode of ["missing", "empty", "retargeted"] as const)
  test(`闭合 Shadow DOM 无法读取内部选区时保留原内容：${mode}`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("before")]),
        { type: "heading", attrs: { level: 3 }, content: [text("AAAA"), { type: "hardBreak" }, text("BBBB")] },
        paragraph([text("after")]),
      ],
    };
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
    await page.evaluate((value) => {
      const shell = document.createElement("div");
      document.body.append(shell);
      window.__semloRequireFixture("mountHeadingEndBoundary")(
        value,
        850,
        false,
        shell.attachShadow({ mode: "closed" }),
      );
      window.__semloRequireFixture("headingEndBoundary").select("AAAABBBB", 8, 8);
    }, content);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    await page.evaluate((value) => {
      const root = window.__semloRequireFixture("headingEndBoundary").controller.editor.view.dom.getRootNode();
      const result = value === "empty" ? { anchorNode: null, focusNode: null } : document.getSelection();
      Reflect.defineProperty(root, "getSelection", {
        configurable: true,
        value: value === "missing" ? undefined : () => result,
      });
    }, mode);
    const before = await inspect(page);
    await page.keyboard.press("Shift+Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const after = await inspect(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection).toEqual(before.selection);
  });

test("跨块反向选区扩到换行标题行首时保留前文", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("before")]),
      { type: "heading", attrs: { level: 3 }, content: [text("AAAA"), { type: "hardBreak" }, text("BBBB")] },
      paragraph([text("after")]),
    ],
  };
  await mount(page, content);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("after", 2, 2));
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  expect(before.selection).toMatchObject({
    anchorType: "paragraph",
    anchorOffset: 2,
    headType: "heading",
    headOffset: 8,
  });
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toMatchObject({
    anchorType: "paragraph",
    anchorOffset: 2,
    headType: "heading",
    headOffset: 5,
    text: "BBBB\naf",
  });
  await page.keyboard.press("Backspace");
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    {
      type: "heading",
      content: [{ type: "text", text: "AAAA" }, { type: "hardBreak" }, { type: "text", text: "ter" }],
    },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

test("跨块正向选区扩到换行标题行首时保留前文", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("before")]),
      { type: "heading", attrs: { level: 3 }, content: [text("AAAA"), { type: "hardBreak" }, text("BBBB")] },
      paragraph([text("after")]),
    ],
  };
  await mount(page, content);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("AAAABBBB", 8, 8));
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  expect(before.selection).toMatchObject({
    anchorType: "heading",
    anchorOffset: 8,
    headType: "paragraph",
    headOffset: 2,
  });
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toMatchObject({
    anchorType: "heading",
    anchorOffset: 5,
    headType: "paragraph",
    headOffset: 2,
  });
  await page.keyboard.press("Backspace");
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    {
      type: "heading",
      content: [{ type: "text", text: "AAAA" }, { type: "hardBreak" }, { type: "text", text: "ter" }],
    },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

test("跨段选区中含标题且无法核实行首时不误选前文", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("SAFE")]),
      paragraph([text("AB")]),
      { type: "heading", attrs: { level: 3 }, content: [text("TITLE")] },
      { type: "heading", attrs: { level: 2 }, content: [text("NEXTTITLE")] },
      paragraph([text("CD")]),
      paragraph([text("TAIL")]),
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate((value) => {
    window.__semloRequireFixture("mountHeadingEndBoundary")(value);
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 30, to: 8 });
  }, content);
  await page.addStyleTag({ content: ".semlo-editor-prose { zoom: 1.5; }" });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  expect(before.selection).toMatchObject({ anchor: 30, head: 8 });
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toEqual(before.selection);
  await page.keyboard.press("Backspace");
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
    { type: "paragraph", content: [{ type: "text", text: "AD" }] },
    { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

test("行距重叠的自动换行标题不会把跨块选区扩到整段", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("SAFE")]),
      { type: "heading", attrs: { level: 3 }, content: [text("MMMM")] },
      paragraph([text("after")]),
    ],
  };
  await mount(page, content);
  await page.addStyleTag({
    content:
      "#heading-end-boundary h3 { width:45px !important; font:26px/13px Arial !important; word-break:break-all !important; }",
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 15, to: 10 });
  });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const tops = await page.locator("#heading-end-boundary h3").evaluate((heading) => {
    const node = Array.from(heading.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)!;
    const range = document.createRange();
    return [0, 1, 2, 3].map((offset) => {
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().top;
    });
  });
  expect(new Set(tops).size).toBeGreaterThan(1);
  const before = await inspect(page);
  expect(before.selection).toMatchObject({ anchor: 15, head: 10 });
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toEqual(before.selection);
  await page.keyboard.press("Backspace");
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
    { type: "heading", content: [{ type: "text", text: "MMMter" }] },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

test("行距重叠的自动换行标题不会把行内光标扩到整段", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("SAFE")]),
      { type: "heading", attrs: { level: 3 }, content: [text("MMMM")] },
      paragraph([text("after")]),
    ],
  };
  await mount(page, content);
  await page.addStyleTag({
    content:
      "#heading-end-boundary h3 { width:45px !important; font:26px/13px Arial !important; word-break:break-all !important; }",
  });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("MMMM", 3, 3));
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toEqual(before.selection);
  await page.keyboard.press("Backspace");
  expect((await inspect(page)).json.content).toMatchObject([
    { type: "paragraph", content: [{ type: "text", text: "SAFE" }] },
    { type: "heading", content: [{ type: "text", text: "MMM" }] },
    { type: "paragraph", content: [{ type: "text", text: "after" }] },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await inspect(page)).json).toEqual(before.json);
});

test("隐含缩放下的换行边界不推断视觉光标归属", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      paragraph([text("SAFE")]),
      { type: "heading", attrs: { level: 3 }, content: [text("MMMM")] },
      paragraph([text("after")]),
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate((value) => {
    window.__semloRequireFixture("mountHeadingEndBoundary")(value);
    const host = document.querySelector("#heading-end-boundary")!;
    const shell = document.createElement("div");
    document.body.append(shell);
    const root = shell.attachShadow({ mode: "closed" });
    const wrapper = document.createElement("div");
    wrapper.style.transform = "scaleY(0.5)";
    wrapper.style.transformOrigin = "0 0";
    wrapper.append(document.createElement("slot"));
    root.append(wrapper);
    shell.append(host);
  }, content);
  await page.addStyleTag({
    content:
      "#heading-end-boundary h3 { width:45px !important; font:26px/13px Arial !important; word-break:break-all !important; }",
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 15, to: 9 });
  });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const affinity = await page.evaluate(() => {
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    return { before: view.coordsAtPos(9, -1).top, after: view.coordsAtPos(9, 1).top };
  });
  expect(affinity.before).not.toBe(affinity.after);
  const before = await inspect(page);
  expect(before.selection).toMatchObject({ anchor: 15, head: 9 });
  await page.keyboard.press("Shift+Home");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  expect((await inspect(page)).selection).toEqual(before.selection);
});

for (const head of [9, 10])
  test(`闭合 Shadow DOM 分栏中的标题不会跨列扩选：${head}`, async ({ page }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        paragraph([text("SAFE")]),
        { type: "heading", attrs: { level: 3 }, content: [text("MMMMMMMM")] },
        paragraph([text("after")]),
      ],
    };
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
    await page.evaluate((value) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(value);
      const host = document.querySelector("#heading-end-boundary")!;
      const shell = document.createElement("div");
      document.body.append(shell);
      const root = shell.attachShadow({ mode: "closed" });
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "columns:8;column-gap:0;width:320px;height:26px;column-fill:auto";
      wrapper.append(document.createElement("slot"));
      root.append(wrapper);
      shell.append(host);
    }, content);
    await page.addStyleTag({
      content:
        "#heading-end-boundary{width:100%!important;border:0!important} #heading-end-boundary .semlo-editor-content{padding:0!important} #heading-end-boundary .semlo-editor-prose{min-height:0!important} #heading-end-boundary p{padding:0!important;margin:0!important;font:20px/26px Arial!important} #heading-end-boundary h3{width:40px!important;padding:0!important;margin:0!important;font:20px/26px Arial!important;overflow-wrap:anywhere!important;word-break:break-all!important}",
    });
    await page.evaluate((position) => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 19, to: position });
    }, head);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect(
      await page.locator("#heading-end-boundary h3").evaluate((heading) => heading.getClientRects().length),
    ).toBeGreaterThan(1);
    const before = await inspect(page);
    expect(before.selection).toMatchObject({ anchor: 19, head });
    await page.keyboard.press("Shift+Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await inspect(page)).selection).toEqual(before.selection);
  });

test("跨标题选区的 AltGraph 组合不被 Shift+Home 处理", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [{ type: "heading", attrs: { level: 3 }, content: [text("TITLE")] }, paragraph([text("after")])],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate((value) => {
    window.__semloRequireFixture("mountHeadingEndBoundary")(value);
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 3, to: 9 });
  }, content);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  const eventResult = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "Home",
      shiftKey: true,
      modifierAltGraph: true,
      bubbles: true,
      cancelable: true,
    });
    window.__semloRequireFixture("headingEndBoundary").controller.editor.view.dom.dispatchEvent(event);
    return { altGraph: event.getModifierState("AltGraph"), prevented: event.defaultPrevented };
  });
  expect(eventResult).toEqual({ altGraph: true, prevented: false });
  expect((await inspect(page)).selection).toEqual(before.selection);
});
