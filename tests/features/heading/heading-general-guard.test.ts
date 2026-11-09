import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-general-guard-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-general-guard-fixture.ts"));
});
afterAll(async () => stop?.());
const doc = (title = "test"): JSONContent => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: title }] },
    { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
  ],
});
async function mount(page: Page, native = false, widget = false, title = "test", nowrap = false) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingGeneralGuard === "function");
  await page.evaluate(
    ({ content, native, widget }) => window.__semloRequireFixture("mountHeadingGeneralGuard")(content, native, widget),
    {
      content: doc(title),
      native,
      widget,
    },
  );
  if (nowrap) await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").setNoWrap());
  await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
}
async function selection(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingGeneralGuard").controller.editor;
    const dom = document.getSelection()!;
    return {
      text: dom.toString(),
      collapsed: dom.isCollapsed,
      anchor: editor.state.selection.anchor,
      head: editor.state.selection.head,
      json: editor.getJSON(),
    };
  });
}
async function drag(page: Page, reverse: boolean) {
  const points = await page.evaluate(() => {
    const root = window.__semloRequireFixture("headingGeneralGuard").controller.editor.view.dom;
    const first = root.querySelector("h3")!.lastChild!;
    const second = root.querySelector("p")!.firstChild!;
    const point = (node: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
    };
    return { start: point(first, 1), end: point(second, 3) };
  });
  const from = reverse ? points.end : points.start;
  const to = reverse ? points.start : points.end;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
  await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
}
for (const reverse of [false, true]) {
  test(`real ${reverse ? "reverse" : "forward"} cross-block selection stops at the paragraph line end`, async ({
    page,
  }) => {
    async function run(native: boolean) {
      await mount(page, native);
      await drag(page, reverse);
      const before = await selection(page);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
      return {
        before,
        after: await selection(page),
        timing: await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").keyTime()),
      };
    }
    const expected = await run(true);
    const candidate = await run(false);
    expect(candidate.before.text).toContain("est");
    expect(candidate.before.text).toContain("NEX");
    expect(candidate.before.collapsed).toBe(false);
    expect(
      reverse ? candidate.before.anchor > candidate.before.head : candidate.before.anchor < candidate.before.head,
    ).toBe(true);
    expect(candidate.before).toEqual(expected.before);
    expect(candidate.after).toEqual({
      ...candidate.before,
      text: `${candidate.before.text}T`,
      anchor: reverse ? candidate.before.anchor + 1 : candidate.before.anchor,
      head: reverse ? candidate.before.head : candidate.before.head + 1,
    });
    expect(candidate.timing).toMatchObject({ prevented: true, trusted: true });
  });
}
test("无法验证的宿主控件保留原选区并停止原生行扩选", async ({ page }) => {
  async function run(native: boolean) {
    await mount(page, native, true);
    await page.locator("#heading-general-guard .semlo-editor-prose h3").click();
    await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
    const before = await selection(page);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
    return {
      before,
      selection: await selection(page),
      timing: await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").keyTime()),
    };
  }
  const baseline = await run(true);
  const candidate = await run(false);
  expect(candidate.before).toEqual(baseline.before);
  expect(candidate.selection).toEqual(candidate.before);
  expect(candidate.timing?.prevented).toBe(true);
});
test("标题行保护不以旧 DOM 光标覆盖宿主已提交的非空选区", async ({ page }) => {
  await mount(page);
  await page.locator("#heading-general-guard .semlo-editor-prose h3").click();
  await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
  await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").installMismatch());
  await page.keyboard.press("Shift+End");
  const result = await page.evaluate(() => ({
    before: window.__semloRequireFixture("headingGeneralGuard").mismatchBefore,
    after: window.__semloRequireFixture("headingGeneralGuard").mismatchAfter,
    timing: window.__semloRequireFixture("headingGeneralGuard").keyTime(),
  }));
  expect(result.before).toEqual({ anchor: 1, head: 11, domCollapsed: true });
  expect(result.after).toEqual(result.before);
  expect(result.timing?.prevented).toBe(true);
});
for (const reverse of [false, true]) {
  test(`real multiline ${reverse ? "reverse" : "forward"} cross-block selection stops at the paragraph line end`, async ({
    page,
  }) => {
    async function run(native: boolean) {
      await mount(page, native, false, "test ".repeat(25));
      await drag(page, reverse);
      const before = await selection(page);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
      return {
        before,
        after: await selection(page),
        timing: await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").keyTime()),
      };
    }
    const expected = await run(true);
    const candidate = await run(false);
    expect(candidate.before.text).toContain("est");
    expect(candidate.before.text).toContain("NEX");
    expect(candidate.before.collapsed).toBe(false);
    expect(
      reverse ? candidate.before.anchor > candidate.before.head : candidate.before.anchor < candidate.before.head,
    ).toBe(true);
    expect(candidate.before).toEqual(expected.before);
    expect(candidate.after).toEqual({
      ...candidate.before,
      text: `${candidate.before.text}T`,
      anchor: reverse ? candidate.before.anchor + 1 : candidate.before.anchor,
      head: reverse ? candidate.before.head : candidate.before.head + 1,
    });
    expect(candidate.timing).toMatchObject({ prevented: true, trusted: true });
  });
}
test("多行标题中的未验证宿主控件保留原选区", async ({ page }) => {
  async function run(native: boolean) {
    await mount(page, native, true, "test ".repeat(25));
    await page.locator("#heading-general-guard .semlo-editor-prose h3").click();
    await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
    const before = await selection(page);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
    return {
      before,
      selection: await selection(page),
      timing: await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").keyTime()),
    };
  }
  const baseline = await run(true);
  const candidate = await run(false);
  expect(candidate.before).toEqual(baseline.before);
  expect(candidate.selection).toEqual(candidate.before);
  expect(candidate.timing?.prevented).toBe(true);
});
for (const length of [4096, 4097]) {
  test(`long single-line title of ${length} chars is bounded`, async ({ page }) => {
    async function run(native: boolean) {
      await mount(page, native, false, "A".repeat(length), true);
      await page.locator("#heading-general-guard .semlo-editor-prose h3").click({ position: { x: 50, y: 8 } });
      await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
      const before = await selection(page);
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").settle());
      const geometry = await page.evaluate(() => {
        const editor = window.__semloRequireFixture("headingGeneralGuard").controller.editor;
        const heading = editor.view.dom.querySelector("h3")!;
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) =>
            node.parentElement?.closest('[contenteditable="false"]')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        const node = walker.nextNode()!;
        const range = document.createRange();
        range.selectNodeContents(node);
        const boxes = Array.from(range.getClientRects());
        const dom = document.getSelection()!;
        const style = getComputedStyle(heading);
        return {
          pmSize: editor.state.doc.firstChild?.content.size,
          pmAnchor: editor.state.selection.anchor,
          pmHead: editor.state.selection.head,
          domAnchorOffset: dom.anchorOffset,
          domFocusOffset: dom.focusOffset,
          selectedLength: dom.toString().length,
          includesFollowing: dom.toString().includes("NEXT"),
          children: [...heading.childNodes].map((child) => ({
            name: child.nodeName,
            classes: child instanceof Element ? child.className : null,
            length: child.textContent?.length,
          })),
          rectCount: boxes.length,
          rectTops: [...new Set(boxes.map((rect) => rect.top))],
          rectHeights: [...new Set(boxes.map((rect) => rect.height))],
          width: heading.getBoundingClientRect().width,
          height: heading.getBoundingClientRect().height,
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          writingMode: style.writingMode,
          direction: style.direction,
          transform: style.transform,
          columnCount: style.columnCount,
        };
      });
      return {
        before,
        selection: await selection(page),
        timing: await page.evaluate(() => window.__semloRequireFixture("headingGeneralGuard").keyTime()),
        geometry,
      };
    }
    const candidate = await run(false);
    expect(candidate.timing?.trusted).toBe(true);
    expect(candidate.geometry.whiteSpace).toBe("nowrap");
    expect(candidate.geometry.rectCount).toBe(1);
    if (length === 4096) {
      expect(candidate.timing?.prevented).toBe(true);
      expect(candidate.selection.text).toBe("A".repeat(length));
      expect(candidate.selection.json).toEqual((await run(true)).selection.json);
    } else {
      expect(candidate.selection).toEqual(candidate.before);
      expect(candidate.timing?.prevented).toBe(true);
    }
  });
}
