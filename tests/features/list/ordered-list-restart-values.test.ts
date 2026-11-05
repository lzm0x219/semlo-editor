import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { deriveOrderedListValues } from "../../../packages/core/src/features/list/ordinals";
import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    restartValueEditor?: EditorController;
    restartValueErrors?: string[];
  }
}

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent: number, restart?: unknown): JSONContent => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent, ...(restart === undefined ? {} : { semloEditorListRestart: restart }) },
  content: [paragraph(text)],
});
const content = (start: number, ...items: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [{ type: "orderedList", attrs: { start }, content: items }, paragraph("尾段")],
});

async function mount(page: Page, value: JSONContent) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'ordered-restart-values-test'
      document.body.append(host)
      window.restartValueErrors = []
      window.restartValueEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(value)},
        onError: error => window.restartValueErrors.push(error.message),
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.restartValueEditor));
  return page.locator("#ordered-restart-values-test");
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const controller = window.restartValueEditor;
    if (!controller) throw new Error("Editor not mounted");
    return controller.getSnapshot();
  });
}

async function values(page: Page): Promise<Array<string | null>> {
  return page
    .locator("#ordered-restart-values-test .semlo-editor-prose > ol > li")
    .evaluateAll((items) => items.map((element) => element.getAttribute("value")));
}

async function htmlItems(page: Page, html: string) {
  return page.evaluate((value) => {
    const template = document.createElement("template");
    template.innerHTML = value;
    const list = template.content.querySelector("ol");
    if (!list) throw new Error("Missing serialized ordered list");
    return Array.from(list.children, (element) => ({
      value: element.getAttribute("value"),
      restart: element.getAttribute("data-semlo-editor-list-restart"),
    }));
  }, html);
}

test("restart derivation preserves old inputs and resets only the specified level", () => {
  expect(deriveOrderedListValues([], 7, undefined, [true])).toEqual([]);
  expect(deriveOrderedListValues([0, 0, 0], 7)).toEqual([7, 8, 9]);
  expect(deriveOrderedListValues([0, 0, 0], 7, undefined, [])).toEqual([7, 8, 9]);
  expect(deriveOrderedListValues([0, 0, 0, 0, 0], 7, undefined, [false, true, false, true, false])).toEqual([
    7, 1, 2, 1, 2,
  ]);
  expect(deriveOrderedListValues([0, 1, 1, 1], 1, undefined, [false, false, true, false])).toEqual([1, 1, 1, 2]);
  expect(deriveOrderedListValues([0, 1, 2, 1, 2, 0, 1], 5, { 1: 4, 2: 6 }, [false, false, false, true])).toEqual([
    5, 4, 6, 1, 1, 6, 1,
  ]);
  expect(deriveOrderedListValues([1, 0, 1], 7, { 0: 5 }, [false, true])).toEqual([7, 1, 1]);
  expect(deriveOrderedListValues([0, 0, 0], -4, undefined, [true, false, false])).toEqual([1, 2, 3]);
  expect(deriveOrderedListValues([0, 0], 2147483647, undefined, [false, true])).toEqual([2147483647, 1]);
});

test("invalid restart values, accessors and revoked proxies do not reset or throw", () => {
  for (const invalid of [null, false, true, 1, "true", {}, Symbol("invalid")]) {
    expect(deriveOrderedListValues([0, 0, 0], 7, undefined, invalid as unknown as readonly unknown[])).toEqual([
      7, 8, 9,
    ]);
  }
  expect(deriveOrderedListValues([0, 0, 0, 0, 0], 7, undefined, ["true", 1, null, {}, false])).toEqual([
    7, 8, 9, 10, 11,
  ]);
  const accessor: unknown[] = [false, false, false];
  Object.defineProperty(accessor, "1", {
    get: () => {
      throw new Error("restart getter must not be read");
    },
  });
  expect(deriveOrderedListValues([0, 0, 0], 7, undefined, accessor)).toEqual([7, 8, 9]);
  const revocable = Proxy.revocable([], {});
  revocable.revoke();
  expect(deriveOrderedListValues([0, 0, 0], 7, undefined, revocable.proxy)).toEqual([7, 8, 9]);
  const sparse = Array(4);
  sparse[2] = true;
  expect(deriveOrderedListValues([0, 0, 0, 0], 7, undefined, sparse)).toEqual([7, 8, 1, 2]);
});

test("flat unindented restarts drive live values and survive HTML and JSON round trips", async ({ page }) => {
  await mount(page, content(7, item("甲", 0), item("乙", 0, true), item("丙", 0), item("丁", 0, true), item("戊", 0)));
  const before = await snapshot(page);
  expect(await values(page)).toEqual(["7", "1", "2", "1", "2"]);
  expect(await htmlItems(page, before.html)).toEqual([
    { value: "7", restart: null },
    { value: "1", restart: "true" },
    { value: "2", restart: null },
    { value: "1", restart: "true" },
    { value: "2", restart: null },
  ]);
  const sourceItems = (before.json as JSONContent).content?.[0].content;
  expect(sourceItems?.map((node) => node.attrs?.semloEditorListRestart ?? false)).toEqual([
    false,
    true,
    false,
    true,
    false,
  ]);
  for (const value of [before.json, before.html]) {
    const restored = await page.evaluate((input) => {
      const controller = window.restartValueEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent("<p>临时内容</p>");
      controller.setContent(input);
      return controller.getSnapshot();
    }, value);
    expect(restored.json).toEqual(before.json);
    expect(await values(page)).toEqual(["7", "1", "2", "1", "2"]);
    expect(await htmlItems(page, restored.html)).toEqual(await htmlItems(page, before.html));
  }
  expect(await page.evaluate(() => window.restartValueErrors)).toEqual([]);
});

test("legacy JSON without a restart attribute keeps the existing native list sequence", async ({ page }) => {
  await mount(page, content(7, item("甲", 0), item("乙", 0), item("丙", 0)));
  const before = await snapshot(page);
  expect(await values(page)).toEqual([null, null, null]);
  expect(await htmlItems(page, before.html)).toEqual([
    { value: null, restart: null },
    { value: null, restart: null },
    { value: null, restart: null },
  ]);
  const sourceItems = (before.json as JSONContent).content?.[0].content;
  expect(sourceItems?.map((node) => node.attrs?.semloEditorListRestart ?? false)).toEqual([false, false, false]);
  await page.evaluate((input) => {
    const controller = window.restartValueEditor;
    if (!controller) throw new Error("Editor not mounted");
    controller.setContent(input);
  }, before.json);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await values(page)).toEqual([null, null, null]);
});

test("invalid JSON restart values are not treated as true", async ({ page }) => {
  await mount(page, content(7, item("甲", 0, "true"), item("乙", 0, 1), item("丙", 0, null)));
  const before = await snapshot(page);
  expect(await values(page)).toEqual([null, null, null]);
  expect((await htmlItems(page, before.html)).every((entry) => entry.restart === null)).toBe(true);
  expect(await page.evaluate(() => window.restartValueErrors)).toEqual([]);
});

test("Enter after a restarted child creates a new same-level item that continues numbering", async ({ page }) => {
  const host = await mount(page, content(1, item("戊", 0), item("己", 1), item("庚", 1, true)));
  expect(await values(page)).toEqual(["1", "1", "1"]);
  await page.evaluate(() => {
    const controller = window.restartValueEditor;
    if (!controller) throw new Error("Editor not mounted");
    const editor = controller.editor;
    let end = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "庚") end = pos + node.nodeSize - 1;
    });
    if (end < 0) throw new Error("Missing restarted item");
    editor.view.focus();
    editor.commands.setTextSelection(end);
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("辛");
  await expect(host.getByText("辛", { exact: true })).toBeVisible();
  expect(await values(page)).toEqual(["1", "1", "1", "2"]);
  const after = await snapshot(page);
  const items = (after.json as JSONContent).content?.[0].content;
  expect(items?.map((node) => node.attrs?.semloEditorListRestart ?? false)).toEqual([false, false, true, false]);
  expect(items?.map((node) => node.attrs?.semloEditorListIndent ?? 0)).toEqual([0, 1, 1, 1]);
  expect(await htmlItems(page, after.html)).toEqual([
    { value: "1", restart: null },
    { value: "1", restart: null },
    { value: "1", restart: "true" },
    { value: "2", restart: null },
  ]);
});
