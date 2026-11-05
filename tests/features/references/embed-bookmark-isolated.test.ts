import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Pending = {
  label?: string;
  url: string;
  canonicalUrl?: string;
  signal: AbortSignal;
  resolve: (value: { title: string; description?: string; iconUrl?: string } | null) => void;
  reject: (error: Error) => void;
};
declare global {
  interface Window {
    bookmarkEditor?: EditorController;
    bookmarkPending?: Pending[];
    bookmarkSecondEditor?: EditorController;
  }
}

test("bookmark metadata requests stay isolated between editor instances", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    window.bookmarkPending=[];
    const resolveEmbedMetadata=(url,{signal,canonicalUrl}) => new Promise((resolve,reject) => window.bookmarkPending.push({url,signal,canonicalUrl,resolve,reject}));
    const content={type:'doc',content:[{type:'paragraph',content:[{type:'semloEditorEmbedBookmarkInline',attrs:{provider:'codepen',url:'https://codepen.io/Mamboleoo/pen/XWJPxpZ'}}]}]};
    for (const [id, key] of [['first', 'bookmarkEditor'],['second', 'bookmarkSecondEditor']]) {
      const host=document.createElement('div'); host.id=id; document.body.append(host);
      window[key]=createEditor({element:host,outline:false,resolveEmbedMetadata,content});
    }
  `,
  });
  await page.waitForFunction(() => window.bookmarkPending?.length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").setEditable(false));
  expect(
    await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").map((pending) => pending.signal.aborted)),
  ).toEqual([true, false]);
  await page.evaluate(() => {
    const pending = window.__semloRequireFixture("bookmarkPending");
    pending[0].resolve({ title: "旧结果" });
    pending[1].resolve({ title: "第二个编辑器" });
  });
  await expect(page.locator("#second .semlo-editor-embed-bookmark-title")).toHaveText("第二个编辑器");
  await expect(page.locator("#first .semlo-editor-embed-bookmark-title")).not.toHaveText("旧结果");
  await page.evaluate(() => {
    window.__semloRequireFixture("bookmarkEditor").destroy();
    window.__semloRequireFixture("bookmarkSecondEditor").destroy();
  });
});

test("bookmark title ignores Enter and Escape while IME composition is active", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "原始标题" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("中文草稿");
  await input.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true }),
    );
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const key of ["Enter", "Escape"])
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await expect(input).toBeVisible();
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  await input.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await input.press("Enter");
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("中文草稿");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("bookmark title composition state is reset when the input loses focus", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "原始标题" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  const bookmark = host.locator(".semlo-editor-embed-bookmark-block");
  await bookmark.click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("初次输入");
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    (element as HTMLInputElement).blur();
  });
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("初次输入");
  await bookmark.click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  await input.fill("再次编辑");
  await input.press("Enter");
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("再次编辑");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("changing a bookmark URL discards the old uncommitted title draft", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("旧链接草稿");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, url: "https://codepen.io/other/pen/abc123" }),
    );
  });
  await expect(input).toBeHidden();
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await expect(input).toBeHidden();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].resolve({ title: "新链接标题" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新链接标题");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a stale resolver rejection cannot mark the new bookmark as failed", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    window.__semloRequireFixture("bookmarkPending")[0].reject(new Error("旧请求失败"));
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, url: "https://codepen.io/other/pen/abc123" }),
    );
  });
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await expect(host.locator(".semlo-editor-embed-bookmark-retry")).toBeHidden();
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].resolve({ title: "新链接标题" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新链接标题");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a settled result cannot write after its bookmark is removed in the same turn", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "迟到结果" });
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(editor.state.tr.delete(position, position + node.nodeSize));
  });
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveCount(0);
  expect(
    JSON.stringify(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot().json)),
  ).not.toContain("迟到结果");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("an abort listener can replace the document after an external bookmark URL update", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    const editor = api.editor;
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.setContent("<p>回调文档</p>"), { once: true });
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, url: "https://codepen.io/other/pen/abc123" }),
    );
  });
  await expect(host.locator(".semlo-editor-prose")).toHaveText("回调文档");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").length)).toBe(1);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("deleting a pending bookmark handles a host that destroys the editor on abort", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.destroy(), { once: true });
  });
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

test("changing a pending bookmark URL handles a host that destroys the editor on abort", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  const error = await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    const editor = api.editor;
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.destroy(), { once: true });
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    try {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          url: "https://codepen.io/other/pen/abc123",
        }),
      );
      return null;
    } catch (error) {
      return String(error);
    }
  });
  expect(error).toBe(null);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkEditor").editor.isDestroyed);
});

test("setting a pending bookmark title handles a host that destroys the editor on abort", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  const error = await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    const editor = api.editor;
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.destroy(), { once: true });
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    try {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, title: "外部标题" }));
      return null;
    } catch (error) {
      return String(error);
    }
  });
  expect(error).toBe(null);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkEditor").editor.isDestroyed);
});

test("changing a bookmark URL before the resolver microtask starts only the new request", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    api.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorEmbedBookmarkBlock",
          attrs: { provider: "codepen", url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ" },
        },
      ],
    });
    const editor = api.editor;
    const node = editor.state.doc.nodeAt(0)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, url: "https://codepen.io/other/pen/abc123" }),
    );
  });
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  const urls = await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").map((request) => request.url));
  expect(urls).toEqual(["https://codepen.io/other/embed/abc123"]);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a settled stale metadata result cannot overwrite the new bookmark URL", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "旧结果" });
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, url: "https://codepen.io/other/pen/abc123" }),
    );
  });
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].resolve({ title: "新结果" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
  expect(
    JSON.stringify(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot().json)),
  ).not.toContain("旧结果");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("title commit does not overwrite a document replaced by an abort listener", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    window.__semloRequireFixture("bookmarkPending")[0].signal.addEventListener(
      "abort",
      () => {
        api.setContent({
          type: "doc",
          content: [
            { type: "paragraph" },
            {
              type: "semloEditorEmbedBookmarkBlock",
              attrs: { provider: "codepen", url: "https://codepen.io/other/pen/abc123", title: "新文档" },
            },
          ],
        });
      },
      { once: true },
    );
  });
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("旧文档草稿");
  await input.press("Enter");
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新文档");
  const json = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot().json);
  expect(JSON.stringify(json)).toContain("https://codepen.io/other/pen/abc123");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("title commit respects read-only or destruction from an abort listener", async ({ page }) => {
  for (const action of ["readonly", "destroy"] as const) {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const host = await mount(page);
    await selectEmbed(page);
    await host.getByRole("button", { name: "卡片" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
    await page.evaluate((mode) => {
      const api = window.__semloRequireFixture("bookmarkEditor");
      window.__semloRequireFixture("bookmarkPending")[0].signal.addEventListener(
        "abort",
        () => {
          if (mode === "destroy") api.destroy();
          else api.setEditable(false);
        },
        { once: true },
      );
    }, action);
    await host.locator(".semlo-editor-embed-bookmark-block").click();
    await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
    const input = host.getByLabel("标题", { exact: true });
    await input.fill("旧文档草稿");
    await input.press("Enter");
    if (action === "readonly") {
      expect(
        JSON.stringify(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot().json)),
      ).not.toContain("旧文档草稿");
      await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
    } else {
      expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.isDestroyed)).toBe(true);
    }
    expect(errors).toEqual([]);
  }
});

test("destroying the editor during bookmark conversion does not throw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.destroy(), { once: true });
  });
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "嵌入" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

test("bookmark conversion does not overwrite a document replaced by an abort listener", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.setContent("<p>新文档</p>"), { once: true });
  });
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "嵌入" }).click();
  await expect(host.locator(".semlo-editor-prose")).toHaveText("新文档");
  await expect(host.locator(".semlo-editor-embed")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("title commit restarts metadata when abort synchronously edits the surrounding document", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .signal.addEventListener("abort", () => api.editor.commands.insertContentAt(1, "并发"), { once: true });
  });
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("旧草稿");
  await input.press("Enter");
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].resolve({ title: "重新解析" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("重新解析");
  await expect(host.locator(".semlo-editor-prose")).toContainText("并发");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("destroying the editor during the title transaction does not throw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("编辑标题");
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("bookmarkEditor");
    api.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) api.destroy();
    });
  });
  await input.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

async function mount(page: Page, resolver = true) {
  await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div'); host.id='bookmark-test'; document.body.prepend(host);
    window.bookmarkPending=[];
    const resolveMetadata=${resolver ? "(url, {signal,canonicalUrl}) => new Promise((resolve,reject) => window.bookmarkPending.push({url,signal,canonicalUrl,resolve,reject,label:'first'}))" : "undefined"};
    window.bookmarkEditor=createEditor({element:host,outline:false,resolveEmbedMetadata:resolveMetadata,
      content:{type:'doc',content:[{type:'paragraph'},{type:'semloEditorEmbed',attrs:{provider:'codepen',url:'https://codepen.io/Mamboleoo/pen/XWJPxpZ'}}]}});
  `,
  });
  await page.waitForFunction(() => Boolean(window.bookmarkEditor));
  return page.locator("#bookmark-test");
}

async function selectEmbed(page: Page) {
  const host = page.locator("#bookmark-test");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.setTextSelection(1));
  await host.getByRole("button", { name: "选择嵌入内容" }).click();
  return host;
}

test("long bookmark metadata survives resolution, title editing, undo and HTML", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  const title = "题".repeat(501);
  const description = "描述".repeat(1000) + "终";
  await page.evaluate((metadata) => window.__semloRequireFixture("bookmarkPending")[0].resolve(metadata), {
    title,
    description,
  });
  await page.waitForFunction(
    () => window.__semloRequireFixture("bookmarkEditor").getSnapshot().json.content?.[1].attrs?.title?.length === 501,
  );
  const initial = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot());
  expect(initial.json.content?.[1].attrs?.title).toBe(title);
  expect(initial.json.content?.[1].attrs?.description).toBe(description);
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await expect(input).toHaveValue(title);
  await input.fill(title + "续");
  await input.press("Enter");
  let snapshot = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot());
  expect(snapshot.json.content?.[1].attrs?.title).toBe(title + "续");
  expect(snapshot.json.content?.[1].attrs?.description).toBe(description);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  snapshot = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot());
  expect(snapshot.json.content?.[1].attrs?.title).toBe(title);
  expect(snapshot.json.content?.[1].attrs?.description).toBe(description);
  await page.evaluate((html) => window.__semloRequireFixture("bookmarkEditor").setContent(html), snapshot.html);
  expect((await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).json).toEqual(
    snapshot.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("bookmark raw fields round trip without activating unsafe links or icons", async ({ page }) => {
  const host = await mount(page, false);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "semloEditorEmbedBookmarkInline",
              attrs: {
                provider: "unknown",
                url: "javascript:alert(1)",
                title: "首行\r\n末行",
                description: "说明\r\n末行",
                iconUrl: "javascript:alert(2)",
              },
            },
          ],
        },
        {
          type: "semloEditorEmbedBookmarkBlock",
          attrs: {
            provider: "codepen",
            url: "javascript:alert(3)",
            title: "卡片",
            description: "描述",
            iconUrl: "javascript:alert(4)",
          },
        },
      ],
    }),
  );
  const initial = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot());
  expect(initial.html).not.toContain("javascript:");
  expect(initial.html).not.toContain("href=");
  await expect(host.locator(".semlo-editor-embed-bookmark img[src]")).toHaveCount(0);
  await page.evaluate((html) => window.__semloRequireFixture("bookmarkEditor").setContent(html), initial.html);
  expect((await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).json).toEqual(
    initial.json,
  );
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("opening a multiline bookmark title without editing does not replace its original text", async ({ page }) => {
  const host = await mount(page, false);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkEditor").setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorEmbedBookmarkBlock",
          attrs: { provider: "codepen", url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ", title: "首行\r\n末行" },
        },
      ],
    }),
  );
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  await host.getByLabel("标题", { exact: true }).press("Enter");
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).json.content?.[0].attrs
      ?.title,
  ).toBe("首行\r\n末行");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("inline title resolves metadata and survives HTML and JSON round trips", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await expect(host.locator(".semlo-editor-embed-bookmark-inline .semlo-editor-embed-bookmark-title")).toHaveText(
    "内容加载中…",
  );
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].url)).toBe(
    "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].canonicalUrl)).toBe(
    "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
  );
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkPending")[0].resolve({
      title: "公开示例",
      description: "说明",
      iconUrl: "https://example.com/icon.svg",
    }),
  );
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("公开示例");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(false);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed iframe")).toHaveCount(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.redo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("公开示例");
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").setContent("<p>替换</p>"));
    await page.evaluate((value) => window.__semloRequireFixture("bookmarkEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("公开示例");
  }
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("block bookmark aborts stale work and undo restores the embed", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-block")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "迟到标题" }));
  await expect(host.locator(".semlo-editor-embed iframe")).toHaveCount(1);
  expect((await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).html).not.toContain(
    "迟到标题",
  );
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("failure falls back to URL and read-only aborts pending work", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].reject(new Error("offline")));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText(
    "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
  );
  await host.getByRole("button", { name: "重试" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").setEditable(false));
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("without a resolver conversion controls remain disabled", async ({ page }) => {
  const host = await mount(page, false);
  await selectEmbed(page);
  await expect(host.getByRole("button", { name: "标题" })).toBeDisabled();
  await expect(host.getByRole("button", { name: "卡片" })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("resolved title switches between inline, card, embed and link with undo", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "示例标题", description: "示例描述" }),
  );
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("示例标题");
  await host.locator(".semlo-editor-embed-bookmark-inline").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "卡片" }).click();
  await expect(host.locator(".semlo-editor-embed-bookmark-block .semlo-editor-embed-bookmark-title")).toHaveText(
    "示例标题",
  );
  await expect(host.locator(".semlo-editor-embed-bookmark-description")).toHaveText("示例描述");
  const copiedHTML = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    editor.commands.selectAll();
    return editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
  });
  expect(copiedHTML).toContain('data-semlo-editor-embed-bookmark="block"');
  expect(copiedHTML).toContain("示例标题");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-inline .semlo-editor-embed-bookmark-title")).toHaveText(
    "示例标题",
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.redo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-block .semlo-editor-embed-bookmark-title")).toHaveText(
    "示例标题",
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") editor.commands.setNodeSelection(pos);
    });
  });
  await expect(host.getByRole("toolbar", { name: "书签操作" })).toBeVisible();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "嵌入" }).click();
  await expect(host.locator(".semlo-editor-embed iframe")).toHaveCount(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-block")).toHaveCount(1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorEmbedBookmarkBlock") editor.commands.setNodeSelection(pos);
    });
  });
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
  );
  await expect(host.locator(".semlo-editor-prose a")).toHaveText("示例标题");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a replacement or destroyed editor cancels a pending resolution", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").setContent("<p>新文档</p>"));
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "过期结果" }));
  await expect(host.locator(".semlo-editor-prose")).toHaveText("新文档");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("document replacement invalidates metadata work even when the bookmark remains identical", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor");
    const document = editor.getSnapshot().json;
    document.content!.push({ type: "paragraph", content: [{ type: "text", text: "新文档" }] });
    editor.setContent(document);
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(true);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").length)).toBe(2);
  await page.evaluate(() => {
    const pending = window.__semloRequireFixture("bookmarkPending");
    pending[0].resolve({ title: "过期结果" });
    pending[1].resolve({ title: "新结果" });
  });
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
  await expect(host.locator(".semlo-editor-prose")).toContainText("新文档");
  await expect(host.locator(".semlo-editor-prose")).not.toContainText("过期结果");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("undoing a document replacement invalidates metadata started in the replacement", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("bookmarkEditor");
    const content = controller.getSnapshot().json;
    content.content!.push({ type: "paragraph", content: [{ type: "text", text: "新文档" }] });
    controller.setContent(content);
  });
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].signal.aborted)).toBe(true);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 3);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.redo())).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[2].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("local and simulated remote partial edits do not cancel pending metadata", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    editor.view.dispatch(editor.state.tr.insertText("本地", 1));
    editor.commands.undo();
    editor.view.dispatch(
      editor.state.tr.insertText("远程", 1).setMeta("simulated-remote", true).setMeta("addToHistory", false),
    );
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(false);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").length)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "结果" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("结果");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a simulated remote whole-document replacement invalidates pending metadata", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text("远程文档"));
    const replacement = editor.state.doc.content.append(editor.state.doc.type.create(null, [paragraph]).content);
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, replacement)
        .setMeta("simulated-remote", true)
        .setMeta("addToHistory", false),
    );
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("whole-document replacement after an earlier step uses that step's document size", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor").editor;
    const tr = editor.state.tr.insertText("局部", 1);
    const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text("替换后"));
    const replacement = tr.doc.content.append(tr.doc.type.create(null, [paragraph]).content);
    tr.replaceWith(0, tr.doc.content.size, replacement);
    editor.view.dispatch(tr);
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(true);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].signal.aborted)).toBe(true);
});

test("equal and invalid content writes do not cancel pending bookmark metadata", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor");
    editor.setContent(editor.getSnapshot().json);
    editor.setContent({ type: "doc", content: [{ type: "unknown-node" }] });
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(false);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").length)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "正常结果" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("正常结果");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("removing a bookmark before its resolver microtask does not start an obsolete request", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("bookmarkEditor");
    controller.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "semloEditorEmbedBookmarkInline",
              attrs: {
                provider: "codepen",
                url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
              },
            },
          ],
        },
      ],
    });
    controller.setContent("<p>已删除</p>");
  });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending").length)).toBe(0);
  await expect(host.locator(".semlo-editor-prose")).toHaveText("已删除");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("an abort listener can replace or destroy the editor during content replacement", async ({ page }) => {
  for (const action of ["replace", "destroy"] as const) {
    const host = await mount(page);
    await selectEmbed(page);
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("bookmarkEditor");
      const signal = window.__semloRequireFixture("bookmarkPending")[0].signal;
      signal.addEventListener("abort", () => {
        if (mode === "replace") controller.setContent("<p>内层文档</p>");
        else controller.destroy();
      });
      controller.setContent("<p>外层文档</p>");
    }, action);
    if (action === "replace") {
      await expect(host.locator(".semlo-editor-prose")).toHaveText("内层文档");
      await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
    } else {
      await expect(host.locator(".semlo-editor-prose")).toHaveCount(0);
    }
    await host.evaluate((element) => element.remove());
  }
});

test("reentrant replacement retains ownership of the newly started metadata request", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("bookmarkEditor");
    window.__semloRequireFixture("bookmarkPending")[0].signal.addEventListener("abort", () => {
      const content = editor.getSnapshot().json;
      content.content!.push({ type: "paragraph", content: [{ type: "text", text: "内层" }] });
      editor.setContent(content);
    });
    editor.setContent("<p>外层</p>");
  });
  await expect(host.locator(".semlo-editor-prose")).toContainText("内层");
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].signal.aborted)).toBe(true);
});

test("replacing the document discards an uncommitted bookmark title draft", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "原始标题" }));
  const bookmark = host.locator(".semlo-editor-embed-bookmark-inline");
  await expect(bookmark.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  await bookmark.click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  await host.getByRole("textbox", { name: "标题" }).fill("旧草稿");
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("bookmarkEditor");
    const content = controller.getSnapshot().json;
    content.content!.push({ type: "paragraph", content: [{ type: "text", text: "新文档" }] });
    controller.setContent(content);
  });
  await expect(host.locator(".semlo-editor-embed-bookmark-edit")).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(host.locator(".semlo-editor-prose")).toContainText("原始标题");
  await expect(host.locator(".semlo-editor-prose")).not.toContainText("旧草稿");
  await expect(host.locator(".semlo-editor-prose")).toContainText("新文档");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a changed resolver aborts old work and is used without recreating the editor", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "标题" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => {
    window.__semloRequireFixture("bookmarkEditor").setIntegrations({
      resolveEmbedMetadata: (url, { signal }) =>
        new Promise((resolve, reject) =>
          window.__semloRequireFixture("bookmarkPending").push({ url, signal, resolve, reject, label: "second" }),
        ),
    });
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].signal.aborted)).toBe(true);
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 2);
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[1].label)).toBe("second");
  await page.evaluate(() => {
    window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "过期解析器" });
    window.__semloRequireFixture("bookmarkPending")[1].resolve({ title: "新解析器" });
  });
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新解析器");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("converting an inline bookmark preserves surrounding text and undo restores it", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "之前" },
            {
              type: "semloEditorEmbedBookmarkInline",
              attrs: { provider: "codepen", url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ", title: "示例" },
            },
            { type: "text", text: "之后" },
          ],
        },
      ],
    }),
  );
  await host.locator(".semlo-editor-embed-bookmark-inline").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "卡片" }).click();
  await expect(host.locator(".semlo-editor-embed-bookmark-block")).toHaveCount(1);
  const html = (await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).html;
  expect(html).toContain("之前");
  expect(html).toContain("之后");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-inline")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-prose")).toContainText("之前");
  await expect(host.locator(".semlo-editor-prose")).toContainText("之后");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("bookmark metadata is displayed as text and unsafe icons are discarded", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkPending")[0].resolve({
      title: "<img src=x onerror=alert(1)>",
      description: "<script>unsafe</script>",
      iconUrl: "javascript:alert(1)",
    }),
  );
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("<img src=x onerror=alert(1)>");
  await expect(host.locator(".semlo-editor-embed-bookmark-description")).toHaveText("<script>unsafe</script>");
  await expect(host.locator(".semlo-editor-embed-bookmark-icon")).not.toHaveAttribute("src", /.+/);
  await expect(host.locator(".semlo-editor-embed-bookmark-fallback-icon")).not.toHaveAttribute("hidden", "");
  const html = (await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).html;
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<script>");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a failed metadata icon falls back without retrying on selection", async ({ page }) => {
  await page.route("https://example.test/missing-icon.svg", (route) => route.fulfill({ status: 404 }));
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("bookmarkPending")[0]
      .resolve({ title: "示例", iconUrl: "https://example.test/missing-icon.svg" }),
  );
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("示例");
  await expect(host.locator(".semlo-editor-embed-bookmark-icon")).toHaveAttribute("hidden", "");
  await expect(host.locator(".semlo-editor-embed-bookmark-fallback-icon")).not.toHaveAttribute("hidden", "");
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await expect(host.locator(".semlo-editor-embed-bookmark-fallback-icon")).not.toHaveAttribute("hidden", "");
  await expect(host.locator(".semlo-editor-embed-bookmark-icon")).toHaveAttribute("hidden", "");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a copied bookmark is restored by the editor's paste handler", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkEditor").setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorEmbedBookmarkBlock",
          attrs: {
            provider: "codepen",
            url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
            title: "复制的书签",
          },
        },
      ],
    }),
  );
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("bookmarkEditor");
    const editor = controller.editor;
    editor.commands.selectAll();
    const html = editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
    controller.setContent("<p></p>");
    editor.commands.setTextSelection(1);
    const data = new DataTransfer();
    data.setData("text/html", html);
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(host.locator(".semlo-editor-embed-bookmark-block .semlo-editor-embed-bookmark-title")).toHaveText(
    "复制的书签",
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot())).html).toContain(
    'data-semlo-editor-embed-bookmark="block"',
  );
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("a top-of-document inline bookmark remains operable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const host = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("bookmarkEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "semloEditorEmbedBookmarkInline",
              attrs: {
                provider: "codepen",
                url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
                title: "示例",
              },
            },
          ],
        },
      ],
    }),
  );
  await host.locator(".semlo-editor-embed-bookmark-inline").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "卡片" }).click();
  await expect(host.locator(".semlo-editor-embed-bookmark-block .semlo-editor-embed-bookmark-title")).toHaveText(
    "示例",
  );
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});

test("bookmark title edits commit on Enter, cancel on Escape and survive serialization", async ({ page }) => {
  const host = await mount(page);
  await selectEmbed(page);
  await host.getByRole("button", { name: "卡片" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("bookmarkPending").length === 1);
  await page.evaluate(() => window.__semloRequireFixture("bookmarkPending")[0].resolve({ title: "原始标题" }));
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  const input = host.getByLabel("标题", { exact: true });
  await input.fill("取消标题");
  await input.press("Escape");
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  await input.fill("自定义标题");
  await input.press("Enter");
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("自定义标题");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.redo())).toBe(true);
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").setContent("<p>替换</p>"));
    await page.evaluate((value) => window.__semloRequireFixture("bookmarkEditor").setContent(value), content);
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("自定义标题");
    await expect(host.locator(".semlo-editor-embed-bookmark-link")).toHaveAttribute(
      "href",
      "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
    );
  }
  await host.locator(".semlo-editor-embed-bookmark-block").click();
  await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
  await input.fill("失焦标题");
  await page.mouse.click(10, 700);
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("失焦标题");
  expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("自定义标题");
  await page.evaluate(() => window.__semloRequireFixture("bookmarkEditor").destroy());
});
