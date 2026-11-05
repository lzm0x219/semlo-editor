import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    mountImageEditing?: (content: JSONContent | string) => void;
    imageEditingEditor?: EditorController;
    imageEditingChanges?: number;
    imageEditingErrors?: string[];
    imageEditingPending?: Array<{ name: string; resolve: (value: string) => void }>;
  }
}

async function mount(page: Page, content: JSONContent | string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.mountImageEditing = (content) => {
        const host = document.createElement('div')
        host.id = 'image-inline-editing'
        document.body.prepend(host)
        window.imageEditingChanges = 0
        window.imageEditingErrors = []
        window.imageEditingPending = []
        window.imageEditingEditor = createEditor({
          element: host, content, outline: false,
          onChange: () => { window.imageEditingChanges++ },
          onError: (error) => window.imageEditingErrors.push(error.message),
          uploadImage: (file) => new Promise(resolve => window.imageEditingPending.push({name: file.name, resolve})),
        })
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.mountImageEditing));
  await page.evaluate((value) => window.__semloRequireFixture("mountImageEditing")(value), content);
  return page.locator("#image-inline-editing");
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("imageEditingEditor").getSnapshot());

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("controlled content rejects a block-level image instead of migrating it", async ({ page }) => {
  await mount(page, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] });
  const before = await snapshot(page);
  await page.evaluate(() => {
    window.__semloRequireFixture("imageEditingEditor").setContent({
      type: "doc",
      content: [{ type: "image", attrs: { src: "/tests/sample-image.svg" } }],
    });
  });
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("imageEditingErrors").length)).toBeGreaterThan(0);
});

test("inserting an image URL replaces only the selected text in the same paragraph", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲选乙" }] }],
  });
  await page.evaluate(() =>
    window
      .__semloRequireFixture("imageEditingEditor")
      .editor.chain()
      .focus()
      .setTextSelection({ from: 2, to: 3 })
      .run(),
  );
  await host.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="image"]').click();
  const form = page.getByRole("dialog", { name: "插入图片" });
  await form.getByLabel("图片地址").fill("/tests/sample-image.svg");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
  const items = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(items.map((item) => item.type)).toEqual(["text", "image", "text"]);
  expect(items.map((item) => item.text ?? item.attrs?.src)).toEqual(["甲", "/tests/sample-image.svg", "乙"]);
});

for (const kind of ["html", "file"] as const) {
  test(`${kind} image paste uses the latest browser selection before ProseMirror sync`, async ({ page }) => {
    const host = await mount(page, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "甲乙" }] }],
    });
    const prior = await page.evaluate((source) => {
      const editor = window.__semloRequireFixture("imageEditingEditor").editor;
      editor.commands.setTextSelection(3);
      editor.view.focus();
      const text = editor.view.dom.querySelector("p")!.firstChild!;
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      const before = { dom: selection.anchorOffset, pm: editor.state.selection.from };
      const transfer = new DataTransfer();
      if (source === "html") transfer.setData("text/html", '<img src="/tests/sample-image.svg" alt="粘贴图片">');
      else transfer.items.add(new File(["image"], "paste.png", { type: "image/png" }));
      editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
      return before;
    }, kind);
    expect(prior).toEqual({ dom: 1, pm: 3 });
    if (kind === "file") {
      await page.waitForFunction(() => window.__semloRequireFixture("imageEditingPending").length === 1);
      await page.evaluate(() =>
        window.__semloRequireFixture("imageEditingPending")[0].resolve("/tests/sample-image.svg?paste"),
      );
    }
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
    const items = (await snapshot(page)).json.content?.[0].content ?? [];
    expect(items.map((item) => item.type)).toEqual(["text", "image", "text"]);
    expect(items.map((item) => item.text ?? item.attrs?.alt)).toEqual([
      "甲",
      kind === "html" ? "粘贴图片" : "paste.png",
      "乙",
    ]);
  });
}

test("image paste keeps a selected image even when the DOM text selection is stale", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "甲" },
          { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "原图" } },
          { type: "text", text: "乙" },
        ],
      },
    ],
  });
  const kind = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.commands.setNodeSelection(2);
    editor.view.focus();
    const paragraph = editor.view.dom.querySelector("p")!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(paragraph.lastChild!, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const selectionType = editor.state.selection.constructor.name;
    const transfer = new DataTransfer();
    transfer.setData("text/html", '<img src="/tests/sample-image.svg" alt="新图">');
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    return selectionType;
  });
  expect(kind).toMatch(/NodeSelection$/);
  const items = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(items.map((item) => item.type)).toEqual(["text", "image", "text"]);
  expect(items.map((item) => item.text ?? item.attrs?.alt)).toEqual(["甲", "新图", "乙"]);
});

test("image paste synchronizes a browser text selection spanning an inline image", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "甲" },
          { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "原图" } },
          { type: "text", text: "乙" },
        ],
      },
    ],
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.commands.setTextSelection(4);
    editor.view.focus();
    const paragraph = editor.view.dom.querySelector("p")!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.lastChild!, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const transfer = new DataTransfer();
    transfer.setData("text/html", '<img src="/tests/sample-image.svg" alt="新图">');
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  const items = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(items.map((item) => item.type)).toEqual(["image"]);
  expect(items[0].attrs?.alt).toBe("新图");
});

test("paste does not force a selection change during an IME composition", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲乙" }] }],
  });
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.commands.setTextSelection(3);
    editor.view.focus();
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    const range = document.createRange();
    range.setStart(editor.view.dom.querySelector("p")!.firstChild!, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const transfer = new DataTransfer();
    transfer.setData("text/html", '<img src="/tests/sample-image.svg" alt="组合中">');
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    const state = { composing: editor.view.composing, from: editor.state.selection.from, json: editor.getJSON() };
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { data: "", bubbles: true }));
    return state;
  });
  expect(result.composing).toBe(true);
  expect(result.from).toBe(3);
  expect(result.json.content?.[0].content).toEqual([{ type: "text", text: "甲乙" }]);
});

test("Backspace uses the current browser caret beside an image and keeps deletion separate from typing", async ({
  page,
}) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "甲" },
          { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "图片" } },
          { type: "text", text: "乙" },
        ],
      },
    ],
  });
  const before = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.chain().focus().setTextSelection(3).insertContent("丙").run();
    const paragraph = editor.view.dom.querySelector("p")!;
    const range = document.createRange();
    range.setStart(paragraph.lastChild!, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const beforeKey = { dom: selection.anchorOffset, pm: editor.state.selection.from };
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    return beforeKey;
  });
  expect(before).toEqual({ dom: 0, pm: 4 });
  expect((await snapshot(page)).json.content?.[0].content).toEqual([{ type: "text", text: "甲丙乙" }]);
  await page.evaluate(() => window.__semloRequireFixture("imageEditingEditor").editor.commands.undo());
  let nodes = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(nodes.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(nodes.at(-1)?.text).toBe("丙乙");
  await page.evaluate(() => window.__semloRequireFixture("imageEditingEditor").editor.commands.undo());
  nodes = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(nodes.at(-1)?.text).toBe("乙");
});

test("Delete uses the current browser caret before an image", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "甲" },
          { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "图片" } },
          { type: "text", text: "乙" },
        ],
      },
    ],
  });
  const prior = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.commands.setTextSelection(1);
    editor.view.focus();
    const range = document.createRange();
    range.setStart(editor.view.dom.querySelector("p")!.firstChild!, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const before = { dom: selection.anchorOffset, pm: editor.state.selection.from };
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    return before;
  });
  expect(prior).toEqual({ dom: 1, pm: 1 });
  expect((await snapshot(page)).json.content?.[0].content).toEqual([{ type: "text", text: "甲乙" }]);
});

test("deletion selection synchronization preserves a table cell selection", async ({ page }) => {
  await mount(page, "<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table>");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") positions.push(pos);
    });
    editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    editor.view.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(editor.view.dom.querySelector("td p")!.firstChild!, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const handlers = editor.view.props.handleDOMEvents!;
    const original = handlers.keydown!;
    let afterType = "";
    let afterFrom = -1;
    let afterTo = -1;
    const beforeType = editor.state.selection.constructor.name;
    const beforeFrom = editor.state.selection.from;
    const beforeTo = editor.state.selection.to;
    editor.view.setProps({
      handleDOMEvents: {
        ...handlers,
        keydown(view, event) {
          original(view, event);
          afterType = view.state.selection.constructor.name;
          afterFrom = view.state.selection.from;
          afterTo = view.state.selection.to;
          return true;
        },
      },
    });
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    return { beforeType, beforeFrom, beforeTo, afterType, afterFrom, afterTo };
  });
  expect(result.beforeType).toMatch(/CellSelection$/);
  expect(result.afterType).toBe(result.beforeType);
  expect([result.afterFrom, result.afterTo]).toEqual([result.beforeFrom, result.beforeTo]);
});

test("image deletion does not force a selection change during IME composition", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "甲" },
          { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "图片" } },
          { type: "text", text: "乙" },
        ],
      },
    ],
  });
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.commands.setTextSelection(4);
    editor.view.focus();
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    const range = document.createRange();
    range.setStart(editor.view.dom.querySelector("p")!.lastChild!, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const state = { composing: editor.view.composing, from: editor.state.selection.from, json: editor.getJSON() };
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { data: "", bubbles: true }));
    return state;
  });
  expect(result.composing).toBe(true);
  expect(result.from).toBe(4);
  expect(result.json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
});

test("pasted file uploads replace a selection and retain order at the mapped inline position", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲选乙" }] }],
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.commands.setTextSelection({ from: 2, to: 3 });
    const transfer = new DataTransfer();
    transfer.items.add(new File(["first"], "first.png", { type: "image/png" }));
    transfer.items.add(new File(["second"], "second.png", { type: "image/png" }));
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    editor.commands.insertContent("补");
  });
  expect((await snapshot(page)).json.content?.[0].content?.map((node) => node.text).join("")).toBe("甲补乙");
  await page.waitForFunction(() => window.__semloRequireFixture("imageEditingPending").length === 1);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageEditingPending")[0].resolve("/tests/sample-image.svg?first"),
  );
  await page.waitForFunction(() => window.__semloRequireFixture("imageEditingPending").length === 2);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageEditingPending")[1].resolve("/tests/sample-image.svg?second"),
  );
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(2);
  const items = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(items.map((item) => item.type)).toEqual(["text", "image", "image", "text"]);
  expect(items.map((item) => item.text ?? item.attrs?.alt)).toEqual(["甲补", "first.png", "second.png", "乙"]);
  expect(await page.evaluate(() => window.imageEditingErrors)).toEqual([]);
});

test("a stale upload cannot insert into a replacement document", async ({ page }) => {
  const host = await mount(page, { type: "doc", content: [{ type: "paragraph" }] });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "pending.png", { type: "image/png" }));
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForFunction(() => window.__semloRequireFixture("imageEditingPending").length === 1);
  await page.evaluate(() => {
    window.__semloRequireFixture("imageEditingEditor").setContent("<p>替换内容</p>");
    window.__semloRequireFixture("imageEditingPending")[0].resolve("/tests/sample-image.svg?stale");
  });
  await expect(host.locator(".semlo-editor-prose")).toHaveText("替换内容");
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(0);
});

test("dropping an image uses its pointer position without deleting an unrelated selection", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲乙丙丁" }] }],
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageEditingEditor").editor;
    editor.chain().focus().setTextSelection({ from: 1, to: 2 }).run();
    const text = editor.view.dom.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 3);
    const rect = range.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "drop.png", { type: "image/png" }));
    editor.view.dom.dispatchEvent(
      new DragEvent("drop", {
        clientX: rect.left,
        clientY: rect.top + rect.height / 2,
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForFunction(() => window.__semloRequireFixture("imageEditingPending").length === 1);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageEditingPending")[0].resolve("/tests/sample-image.svg?drop"),
  );
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
  const items = (await snapshot(page)).json.content?.[0].content ?? [];
  expect(items.map((item) => item.type)).toEqual(["text", "image", "text"]);
  expect(items.map((item) => item.text ?? item.attrs?.alt)).toEqual(["甲乙丙", "drop.png", "丁"]);
});
