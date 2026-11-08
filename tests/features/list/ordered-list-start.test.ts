import { expect, test, type Page } from "@rstest/playwright";

import {
  deriveOrderedListValues,
  normalizeOrderedListLevelStarts,
} from "../../../packages/core/src/features/list/ordinals";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    listStartEditor?: EditorController;
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent: number) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text)],
});

async function mount(page: Page, content: unknown) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'list-start-test'
      document.body.append(host)
      window.listStartEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.listStartEditor));
  return page.locator("#list-start-test");
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("listStartEditor").getSnapshot());
const htmlValues = (page: Page, html: string) =>
  page.evaluate((value) => {
    const template = document.createElement("template");
    template.innerHTML = value;
    return Array.from(template.content.querySelectorAll("ol"), (list) =>
      Array.from(list.children, (item) => item.getAttribute("value")),
    );
  }, html);

test("flat-list value derivation uses the first level and handles invalid inputs", () => {
  expect(deriveOrderedListValues([], 7)).toEqual([]);
  expect(deriveOrderedListValues([1, 2, 1], "7")).toEqual([7, 1, 8]);
  expect(deriveOrderedListValues([1, 0, 1], 7)).toEqual([7, 1, 1]);
  expect(deriveOrderedListValues([0, 0], null)).toEqual([1, 2]);
  expect(deriveOrderedListValues([1, 1], Symbol("invalid"))).toEqual([1, 2]);
  expect(deriveOrderedListValues([1, 1], 2147483648)).toEqual([1, 2]);
  expect(deriveOrderedListValues([1, 1], 2147483647)).toEqual([2147483647, 2147483647]);
  expect(deriveOrderedListValues([1, 0], 2, { 0: 2, 1: 99 })).toEqual([2, 2]);
  expect(deriveOrderedListValues([0, 1, 0, 1], 1, { 1: 2 })).toEqual([1, 2, 2, 1]);
  expect(deriveOrderedListValues([1, 0, 1], 2, { 0: 2, 1: 99 })).toEqual([2, 2, 1]);
});

test("sparse level starts reject malformed values without invoking getters", () => {
  expect(normalizeOrderedListLevelStarts({ 0: 2, 8: -2147483648 })).toEqual({ 0: 2, 8: -2147483648 });
  for (const value of [null, {}, [], { 9: 2 }, { "01": 2 }, { 0: "2" }, { 0: 1.5 }, { 0: 2147483648 }])
    expect(normalizeOrderedListLevelStarts(value)).toBeNull();
  expect(normalizeOrderedListLevelStarts(JSON.parse('{"__proto__":{"0":2},"1":2}'))).toBeNull();
  const accessor = Object.defineProperty({}, "0", {
    enumerable: true,
    get() {
      throw new Error("A metadata getter must not be read");
    },
  });
  expect(normalizeOrderedListLevelStarts(accessor)).toBeNull();
});

async function listMarkers(page: Page, selector = "#list-start-test"): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { node: host } = await session.send("DOM.describeNode", { nodeId });
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const first = nodes.find((node) => node.backendDOMNodeId === host.backendNodeId);
    if (!first) throw new Error("List editor is absent from the accessibility tree");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const markers: string[] = [];
    const visit = (id: string) => {
      const node = byId.get(id);
      if (!node) return;
      if (node.role?.value === "ListMarker") markers.push(String(node.name?.value ?? "").trim());
      node.childIds?.forEach(visit);
    };
    visit(first.nodeId);
    return markers;
  } finally {
    await session.detach();
  }
}

test("sparse level starts survive editing, undo, redo and an HTML round trip", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 2, semloEditorListLevelStarts: { 0: 2, 1: 99 } },
        content: [item("丁", 1), item("戊", 0)],
      },
    ],
  });
  const before = await snapshot(page);
  expect(before.json.content?.[0].attrs?.semloEditorListLevelStarts).toEqual({ 0: 2, 1: 99 });
  expect(await listMarkers(page)).toEqual(["b.", "2."]);
  expect(await htmlValues(page, before.html)).toEqual([["2", "2"]]);
  expect(before.html).toContain("data-semlo-editor-list-level-starts=");

  await host.getByText("丁", { exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__semloRequireFixture("listStartEditor").editor.state.selection.$from.parent.textContent,
      ),
    )
    .toBe("丁");
  await page.keyboard.press("End");
  await page.keyboard.type("变");
  await expect(host.getByText("丁变", { exact: true })).toBeVisible();
  const edited = await snapshot(page);
  expect(edited.json.content?.[0].attrs?.semloEditorListLevelStarts).toEqual({ 0: 2, 1: 99 });
  expect(await listMarkers(page)).toEqual(["b.", "2."]);
  expect(await page.evaluate(() => window.__semloRequireFixture("listStartEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await listMarkers(page)).toEqual(["b.", "2."]);
  expect(await page.evaluate(() => window.__semloRequireFixture("listStartEditor").editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(edited.json);
  await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), edited.html);
  expect((await snapshot(page)).json).toEqual(edited.json);
  expect(await listMarkers(page)).toEqual(["b.", "2."]);
});

test("invalid level-start HTML is ignored and never rendered as metadata", async ({ page }) => {
  await mount(page, "<p>初始</p>");
  const invalid = [
    "not-json",
    "[]",
    '{"9":2}',
    '{"0":"2"}',
    '{"0":1.5}',
    '{"0":2147483648}',
    '{"__proto__":{"0":2},"1":2}',
    " ".repeat(257),
  ];
  for (const value of invalid) {
    await page.evaluate((metadata) => {
      const list = document.createElement("ol");
      list.setAttribute("start", "2");
      list.setAttribute("data-semlo-editor-list-level-starts", metadata);
      list.innerHTML = '<li data-semlo-editor-list-indent="1"><p>丁</p></li><li><p>戊</p></li>';
      window.__semloRequireFixture("listStartEditor").setContent(list.outerHTML);
    }, value);
    const current = await snapshot(page);
    expect(Object.hasOwn(current.json.content?.[0].attrs ?? {}, "semloEditorListLevelStarts")).toBe(false);
    expect(current.html).not.toContain("data-semlo-editor-list-level-starts");
    expect(await htmlValues(page, current.html)).toEqual([["2", "1"]]);
  }
});

test("converting a bullet parent keeps a nested ordered list's non-default start", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const host = await mount(
    page,
    '<ul><li><p>父列表</p><ol start="7"><li><p><strong>甲</strong></p></li><li><p>乙</p></li><li><p>丙</p></li></ol></li></ul>',
  );
  const before = await snapshot(page);
  await expect(host.locator(".semlo-editor-prose ul ol")).toHaveAttribute("start", "7");
  expect((await listMarkers(page)).slice(-3)).toEqual(["g.", "h.", "i."]);
  await page.evaluate((html) => {
    const reader = document.createElement("article");
    reader.id = "list-start-reader";
    reader.innerHTML = html;
    document.body.append(reader);
  }, before.html);
  expect((await listMarkers(page, "#list-start-reader")).slice(-3)).toEqual(["g.", "h.", "i."]);

  await host.getByText("父列表", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Alt+3");
  await expect(host.locator(".semlo-editor-prose > h3")).toContainText("父列表");
  const flat = host.locator(".semlo-editor-prose > ol");
  await expect(flat).toHaveAttribute("start", "7");
  await expect(flat.locator(':scope > li[data-semlo-editor-list-indent="1"]')).toHaveCount(3);
  await expect(flat.locator(":scope > li")).toHaveText(["甲", "乙", "丙"]);
  expect(
    await flat.locator(":scope > li").evaluateAll((items) => items.map((node) => node.getAttribute("value"))),
  ).toEqual(["7", "8", "9"]);
  expect(await listMarkers(page)).toEqual(["g.", "h.", "i."]);
  const after = await snapshot(page);
  expect(await htmlValues(page, after.html)).toEqual([["7", "8", "9"]]);
  expect(JSON.stringify(after.json)).not.toContain("semloEditorListOrdinal");

  expect(await page.evaluate(() => window.__semloRequireFixture("listStartEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("listStartEditor").editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
  expect(await listMarkers(page)).toEqual(["g.", "h.", "i."]);
  await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), after.html);
  expect((await snapshot(page)).json).toEqual(after.json);
  expect(await listMarkers(page)).toEqual(["g.", "h.", "i."]);
  expect(errors).toEqual([]);
});

test("lifting an ordered parent reveals its nested list's stored start", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const host = await mount(
    page,
    '<ol><li><p>父列表</p><ol start="7"><li><p>甲</p></li><li><p>乙</p></li><li><p>丙</p></li></ol></li></ol>',
  );
  const before = await snapshot(page);
  expect(await listMarkers(page)).toEqual(["1.", "a.", "b.", "c."]);
  expect(await htmlValues(page, before.html)).toEqual([[null], ["1", "2", "3"]]);
  await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), before.html);
  expect((await snapshot(page)).json).toEqual(before.json);

  await host.getByText("父列表", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Alt+3");
  await expect(host.locator(".semlo-editor-prose > h3")).toContainText("父列表");
  const flat = host.locator(".semlo-editor-prose > ol");
  await expect(flat).toHaveAttribute("start", "7");
  await expect(flat.locator(':scope > li[data-semlo-editor-list-indent="1"]')).toHaveCount(3);
  expect(await listMarkers(page)).toEqual(["g.", "h.", "i."]);
  const after = await snapshot(page);
  expect(await htmlValues(page, after.html)).toEqual([["7", "8", "9"]]);

  expect(await page.evaluate(() => window.__semloRequireFixture("listStartEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await listMarkers(page)).toEqual(["1.", "a.", "b.", "c."]);
  expect(await page.evaluate(() => window.__semloRequireFixture("listStartEditor").editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
  expect(await listMarkers(page)).toEqual(["g.", "h.", "i."]);
  await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), after.html);
  expect((await snapshot(page)).json).toEqual(after.json);
  expect(await listMarkers(page)).toEqual(["g.", "h.", "i."]);
  expect(errors).toEqual([]);
});

// These are HTML and Semlo numbering invariants; only the start=7 case above
// has been compared with the reference editor.
for (const start of [7, 0, -3, -1000000, 1000000, -2147483648, 2147483645]) {
  test(`a flat list starting at indent 1 retains start ${start} through level resets`, async ({ page }) => {
    const levels = [1, 1, 2, 2, 1, 2];
    const content = {
      type: "doc",
      content: [
        { type: "orderedList", attrs: { start }, content: levels.map((level, index) => item(`项${index}`, level)) },
      ],
    };
    const host = await mount(page, content);
    const expected = [start, start + 1, 1, 2, start + 2, 1].map(String);
    const rendered = host.locator(".semlo-editor-prose > ol > li");
    expect(await rendered.evaluateAll((items) => items.map((node) => node.getAttribute("value")))).toEqual(expected);
    const before = await snapshot(page);
    expect(await htmlValues(page, before.html)).toEqual([expected]);
    await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), before.html);
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}

test("a list starting at indent 0 keeps its existing level reset behavior", async ({ page }) => {
  const levels = [0, 1, 1, 0, 1];
  const host = await mount(page, {
    type: "doc",
    content: [
      { type: "orderedList", attrs: { start: 7 }, content: levels.map((level, index) => item(`项${index}`, level)) },
    ],
  });
  expect(
    await host
      .locator(".semlo-editor-prose > ol > li")
      .evaluateAll((items) => items.map((node) => node.getAttribute("value"))),
  ).toEqual(["7", "1", "2", "8", "1"]);
});

test("derived values stay valid when a list reaches the HTML integer limit", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "orderedList", attrs: { start: 2147483647 }, content: [item("甲", 1), item("乙", 1)] }],
  });
  const values = await host
    .locator(".semlo-editor-prose > ol > li")
    .evaluateAll((items) =>
      items.map((node) => ({ attribute: node.getAttribute("value"), value: (node as HTMLLIElement).value })),
    );
  expect(values).toEqual([
    { attribute: "2147483647", value: 2147483647 },
    { attribute: "2147483647", value: 2147483647 },
  ]);
  const markers = await listMarkers(page);
  expect(markers).toHaveLength(2);
  expect(markers[0]).toBe(markers[1]);
  const before = await snapshot(page);
  expect(await htmlValues(page, before.html)).toEqual([["2147483647", "2147483647"]]);
  await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), before.html);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("an explicit ordered-list type takes priority over nesting and item indent", async ({ page }) => {
  const types = ["1", "a", "A", "i", "I"];
  const content = {
    type: "doc",
    content: types.map((type) => ({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            paragraph(`父${type}`),
            {
              type: "orderedList",
              attrs: { start: 7, type },
              content: [item(`首${type}`, 0), item(`次${type}`, 1)],
            },
          ],
        },
      ],
    })),
  };
  const host = await mount(page, content);
  const expected = ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"];
  expect(
    await host
      .locator(".semlo-editor-prose ol")
      .evaluateAll((lists) =>
        lists.map((list) => Array.from(list.children, (child) => getComputedStyle(child).listStyleType)),
      ),
  ).toEqual(expected.map((style) => [style, style]));
  const before = await snapshot(page);
  expect(before.html).toContain('<ol start="7" type="1">');
  await page.evaluate((html) => window.__semloRequireFixture("listStartEditor").setContent(html), before.html);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await host
      .locator(".semlo-editor-prose ol")
      .evaluateAll((lists) =>
        lists.map((list) => Array.from(list.children, (child) => getComputedStyle(child).listStyleType)),
      ),
  ).toEqual(expected.map((style) => [style, style]));
});

test("the marker level combines ordinary ancestors with item indents", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            ...item("父", 1),
            content: [
              paragraph("父"),
              { type: "orderedList", attrs: { start: 7 }, content: [item("甲", 0), item("乙", 1)] },
            ],
          },
        ],
      },
    ],
  });
  expect(
    await host
      .locator(".semlo-editor-prose ol > li")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).listStyleType)),
  ).toEqual(["semlo-mixed-roman", "decimal"]);
});
