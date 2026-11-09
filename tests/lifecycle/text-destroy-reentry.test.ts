import { expect, test } from "@rstest/playwright";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { createDatabaseData } from "../../packages/core/src/features/database/model";

test("controller cleanup removes the find panel after editor unmount", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-unmount'; document.body.append(host)
      window.findUnmount = createEditor({ element: host, outline: false, content: '<p>目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findUnmount")));
  await page.locator("#find-unmount").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await expect(panel).toBeVisible();
  const error = await page.evaluate(() => {
    const api = Reflect.get(window, "findUnmount");
    api.editor.unmount();
    try {
      api.destroy();
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(error).toBe("");
  await expect(panel).toHaveCount(0);
});

test("database search tolerates host replacement while opening a card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const data = createDatabaseData();
  data.records[0].values[data.fields[0].id] = "数据表目标";
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "findCardDatabaseData", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-card-db-replace'; document.body.append(host)
      window.findCardDatabase = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: 'details', attrs: { open: false }, content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: '卡片标题' }] },
          { type: 'detailsContent', content: [{ type: 'semloEditorDatabase', attrs: { data: window.findCardDatabaseData } }] }
        ] }]
      } })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findCardDatabase")));
  const host = page.locator("#find-card-db-replace");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await page.evaluate(() => {
    const api = Reflect.get(window, "findCardDatabase");
    let done = false;
    api.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (done || !transaction.docChanged) return;
      done = true;
      api.setContent("<p>新</p>");
    });
  });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("数据表目标");
  await expect(host.locator(".semlo-editor-prose")).toHaveText("新");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "findCardDatabase").destroy());
});

test("search reveals a nested card when a heading plugin appends an unrelated edit", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-heading-append'; document.body.append(host)
      window.findHeadingAppend = createEditor({ element: host, outline: false,
        content: '<h1>标题</h1><h2>子标题</h2><details><summary>卡片</summary><div data-type="detailsContent"><p>隐藏目标</p></div></details>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findHeadingAppend")));
  const host = page.locator("#find-heading-append");
  await host.getByRole("button", { name: "折叠标题：子标题" }).click();
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await page.evaluate(() => {
    const editor = Reflect.get(window, "findHeadingAppend").editor;
    const Plugin = editor.state.plugins[0].constructor;
    let done = false;
    editor.registerPlugin(
      new Plugin({
        appendTransaction(transactions: readonly Transaction[], _old: EditorState, state: EditorState) {
          const opens = transactions.some((transaction) => {
            const action = transaction.getMeta("semloEditorHeadingFold$") as
              | { kind?: string; folded?: boolean }
              | undefined;
            return action?.kind === "expand";
          });
          if (done || !opens) return null;
          done = true;
          return state.tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text("追加内容")));
        },
      }),
    );
  });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("隐藏目标");
  await expect(host.getByText("隐藏目标")).toBeVisible();
  await expect(host.getByText("追加内容")).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "findHeadingAppend").destroy());
});

test("text tools survive a synchronous remount during a painter transaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'text-sync-remount'; document.body.append(host)
      window.textSyncRemount = () => createEditor({ element: host, outline: false,
        content: '<p><strong>来源</strong></p><p>目标</p>' })
      window.textSyncCurrent = window.textSyncRemount()
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "textSyncCurrent")));
  const host = page.locator("#text-sync-remount");
  await page.evaluate(() => {
    const api = Reflect.get(window, "textSyncCurrent");
    api.editor.commands.focus();
    api.editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await host.locator(".semlo-editor-format-painter").click();
  await page.evaluate(() => {
    const api = Reflect.get(window, "textSyncCurrent");
    const start = api.editor.state.doc.child(0).nodeSize + 1;
    api.editor.commands.focus();
    api.editor.commands.setTextSelection({ from: start, to: start + 2 });
    let done = false;
    api.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (done || !transaction.docChanged) return;
      done = true;
      api.destroy();
      Reflect.set(window, "textSyncCurrent", Reflect.get(window, "textSyncRemount")());
      Reflect.set(window, "textSyncRemountObserved", true);
    });
  });
  await host.locator(".semlo-editor-prose").press("Enter");
  expect(await page.evaluate(() => Reflect.get(window, "textSyncRemountObserved"))).toBe(true);
  await expect(host.locator(".semlo-editor-format-painter")).toHaveCount(1);
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "textSyncCurrent").destroy());
});

test("text tools work after destroying and recreating an editor in the same host", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'text-remount'; document.body.append(host)
      window.textRemount = () => createEditor({ element: host, outline: false,
        content: '<p><strong>来源</strong></p><p>目标</p>' })
      window.textRemounted = window.textRemount()
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "textRemounted")));
  const host = page.locator("#text-remount");
  await host.getByRole("button", { name: "查找替换" }).click();
  await expect(page.getByRole("dialog", { name: "查找替换" })).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(window, "textRemounted").destroy();
    Reflect.set(window, "textRemounted", Reflect.get(window, "textRemount")());
  });
  await expect(page.getByRole("dialog", { name: "查找替换" })).toHaveCount(0);
  await page.evaluate(() => {
    const editor = Reflect.get(window, "textRemounted").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  const painter = host.locator(".semlo-editor-format-painter");
  await expect(painter).toHaveCount(1);
  await painter.click();
  await page.evaluate(() => {
    const editor = Reflect.get(window, "textRemounted").editor;
    const start = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: start, to: start + 2 });
  });
  await host.locator(".semlo-editor-prose").press("Enter");
  await expect(host.locator(".semlo-editor-prose p").nth(1).locator("strong")).toHaveText("目标");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await expect(panel).toHaveCount(1);
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "textRemounted").destroy());
});

test("find shortcut ignores composition keyboard events", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-composition'; document.body.append(host)
      window.findComposition = createEditor({ element: host, outline: false, content: '<p>文字</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findComposition")));
  const prose = page.locator("#find-composition .semlo-editor-prose");
  await prose.click();
  for (const init of [
    { key: "f", ctrlKey: true, isComposing: true },
    { key: "f", ctrlKey: true, keyCode: 229 },
  ]) {
    const handled = await prose.evaluate(
      (element, options) =>
        !element.dispatchEvent(new KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true })),
      init,
    );
    expect(handled).toBe(false);
    await expect(page.getByRole("dialog", { name: "查找替换" })).toHaveCount(0);
  }
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  expect(await page.evaluate(() => Reflect.get(window, "findComposition").editor.view.composing)).toBe(true);
  await prose.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })),
  );
  await expect(page.getByRole("dialog", { name: "查找替换" })).toHaveCount(0);
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.waitForFunction(() => !Reflect.get(window, "findComposition").editor.view.composing);
  await prose.press("ControlOrMeta+f");
  await expect(page.getByRole("dialog", { name: "查找替换" })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "findComposition").destroy());
});

for (const location of ["before", "after"] as const) {
  test(`search opens nested cards when a plugin appends an unrelated edit ${location} them`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-card-append'; document.body.append(host)
      window.findCardAppend = createEditor({ element: host, outline: false,
        content: '<details><summary>外层标题</summary><div data-type="detailsContent"><details><summary>目标标题</summary><div data-type="detailsContent"><p>内层正文</p></div></details></div></details>' })
    `,
    });
    await page.waitForFunction(() => Boolean(Reflect.get(window, "findCardAppend")));
    const host = page.locator("#find-card-append");
    await host.getByRole("button", { name: "查找替换" }).click();
    const panel = page.getByRole("dialog", { name: "查找替换" });
    await page.evaluate((where) => {
      const editor = Reflect.get(window, "findCardAppend").editor;
      const Plugin = editor.state.plugins[0].constructor;
      let done = false;
      editor.registerPlugin(
        new Plugin({
          appendTransaction(transactions: readonly Transaction[], _old: EditorState, state: EditorState) {
            if (done || !transactions.some((transaction) => transaction.docChanged)) return null;
            done = true;
            const paragraph = state.schema.nodes.paragraph.create(null, state.schema.text("追加内容"));
            return state.tr.insert(where === "before" ? 0 : state.doc.content.size, paragraph);
          },
        }),
      );
    }, location);
    await panel.getByRole("textbox", { name: "查找内容" }).fill("目标标题");
    await expect(host.getByText("内层正文")).toBeVisible();
    await expect(host.getByText("追加内容")).toBeVisible();
    await page.evaluate(() => Reflect.get(window, "findCardAppend").destroy());
  });
}

test("search tolerates host replacement while opening nested cards", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-card-replace'; document.body.append(host)
      window.findCardReplace = createEditor({ element: host, outline: false,
        content: '<details><summary>外层标题</summary><div data-type="detailsContent"><details><summary>长长的目标标题</summary><div data-type="detailsContent"><p>内部</p></div></details></div></details>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findCardReplace")));
  const host = page.locator("#find-card-replace");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await page.evaluate(() => {
    const api = Reflect.get(window, "findCardReplace");
    let done = false;
    api.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (done || !transaction.docChanged) return;
      done = true;
      api.setContent("<p>新</p>");
    });
  });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标标题");
  await expect(host.locator(".semlo-editor-prose")).toHaveText("新");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "findCardReplace").destroy());
});

test("search tolerates host replacement while revealing a folded heading", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-heading-replace'; document.body.append(host)
      window.findHeadingReplace = createEditor({ element: host, outline: false,
        content: '<h1>标题</h1><p>很长的隐藏目标文字</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findHeadingReplace")));
  const host = page.locator("#find-heading-replace");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await page.evaluate(() => {
    const api = Reflect.get(window, "findHeadingReplace");
    let done = false;
    api.editor.on("transaction", ({ transaction }: { transaction: { getMeta(key: string): unknown } }) => {
      const action = transaction.getMeta("semloEditorHeadingFold$") as { kind?: string; folded?: boolean } | undefined;
      if (done || action?.kind !== "expand") return;
      done = true;
      api.setContent("<p>新</p>");
    });
  });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("隐藏目标");
  await expect(host.locator(".semlo-editor-prose")).toHaveText("新");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "findHeadingReplace").destroy());
});

test("prefilled search tears down if its query transaction destroys the editor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-prefill-destroy'; document.body.append(host)
      window.findPrefillDestroy = createEditor({ element: host, outline: false, content: '<p>目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findPrefillDestroy")));
  await page.evaluate(() => {
    const api = Reflect.get(window, "findPrefillDestroy");
    api.editor.commands.setTextSelection({ from: 1, to: 3 });
    let count = 0;
    api.editor.on("transaction", () => {
      if (++count === 2) api.destroy();
    });
  });
  await page.locator("#find-prefill-destroy").getByRole("button", { name: "查找替换" }).click();
  await expect(page.getByRole("dialog", { name: "查找替换" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("opening search does not leave a panel when its transaction destroys the editor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-open-destroy'; document.body.append(host)
      window.findOpenDestroy = createEditor({ element: host, outline: false, content: '<p>目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findOpenDestroy")));
  await page.evaluate(() => {
    const api = Reflect.get(window, "findOpenDestroy");
    api.editor.on("transaction", () => api.destroy());
  });
  await page.locator("#find-open-destroy").getByRole("button", { name: "查找替换" }).click();
  await expect(page.getByRole("dialog", { name: "查找替换" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("search navigation tolerates synchronous destruction during its transaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-navigation-destroy'; document.body.append(host)
      window.findNavigationDestroy = createEditor({ element: host, outline: false, content: '<p>目标 目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findNavigationDestroy")));
  await page.locator("#find-navigation-destroy").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await page.evaluate(() => {
    const api = Reflect.get(window, "findNavigationDestroy");
    api.editor.on("transaction", () => api.destroy());
  });
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("search handles destruction while opening a folded card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-fold-destroy'; document.body.append(host)
      window.findFoldDestroy = createEditor({ element: host, outline: false,
        content: '<details><summary>卡片标题</summary><div data-type="detailsContent"><p>折叠目标文字</p></div></details>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findFoldDestroy")));
  await page.locator("#find-fold-destroy").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await page.evaluate(() => {
    const api = Reflect.get(window, "findFoldDestroy");
    api.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) api.destroy();
    });
  });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("折叠目标");
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("format painters remain independent across editors", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const first = document.createElement('div'), second = document.createElement('div')
      first.id = 'painter-one'; second.id = 'painter-two'
      document.body.append(first, second)
      window.independentPainters = [
        createEditor({ element: first, outline: false, content: '<p><strong>源一</strong></p><p>目标一</p>' }),
        createEditor({ element: second, outline: false, content: '<p><em>源二</em></p><p>目标二</p>' }),
      ]
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "independentPainters")));
  await page.evaluate(() => {
    const first = Reflect.get(window, "independentPainters")[0].editor;
    first.commands.focus();
    first.commands.setTextSelection({ from: 1, to: 3 });
  });
  const firstPainter = page.locator("#painter-one .semlo-editor-format-painter");
  const secondPainter = page.locator("#painter-two .semlo-editor-format-painter");
  await firstPainter.click();
  await expect(firstPainter).toHaveAttribute("aria-pressed", "true");
  await expect(secondPainter).toHaveAttribute("aria-pressed", "false");
  await page.locator("#painter-two .semlo-editor-prose").evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await page.waitForFunction(() => !Reflect.get(window, "independentPainters")[1].editor.view.composing);
  await expect(firstPainter).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const second = Reflect.get(window, "independentPainters")[1].editor;
    second.commands.focus();
    second.commands.setTextSelection({ from: 1, to: 3 });
  });
  await secondPainter.click();
  await expect(firstPainter).toHaveAttribute("aria-pressed", "false");
  await expect(secondPainter).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const second = Reflect.get(window, "independentPainters")[1].editor;
    const start = second.state.doc.child(0).nodeSize + 1;
    second.commands.focus();
    second.commands.setTextSelection({ from: start, to: start + 3 });
  });
  await page.locator("#painter-two .semlo-editor-prose").press("Enter");
  await expect(page.locator("#painter-two .semlo-editor-prose p").nth(1).locator("em")).toHaveText("目标二");
  await expect(page.locator("#painter-one .semlo-editor-prose p").nth(1).locator("strong")).toHaveCount(0);
  await page.evaluate(() =>
    Reflect.get(window, "independentPainters").forEach((api: { destroy(): void }) => api.destroy()),
  );
});

test("find replacement reports a synchronous host replacement conflict", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'replace-reentry'; document.body.append(host)
    window.replaceReentryEditor = createEditor({ element: host, outline: false, content: '<p>旧文目标</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "replaceReentryEditor")));
  await page.locator("#replace-reentry").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("改写");
  await page.evaluate(() => {
    const api = Reflect.get(window, "replaceReentryEditor");
    let done = false;
    api.editor.on("beforeTransaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (done || !transaction.docChanged) return;
      done = true;
      try {
        api.setContent("<p>宿主新文档</p>");
        Reflect.set(window, "replaceReentryConflict", "returned");
      } catch (error) {
        Reflect.set(window, "replaceReentryConflict", error instanceof Error ? error.name : String(error));
      }
    });
  });
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "replaceReentryConflict"))).toBe("ReentrantTransactionError");
  await expect(page.locator("#replace-reentry .semlo-editor-prose")).toHaveText("旧文改写");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "replaceReentryEditor").destroy());
  await expect(panel).toHaveCount(0);
  await expect(page.locator("#replace-reentry .semlo-editor")).toHaveCount(0);
});

test("find replacement preserves a host replacement from a transaction listener", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'find-transaction-reentry'; document.body.append(host)
    window.findTransactionReentry = createEditor({ element: host, outline: false, content: '<p>旧文目标</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findTransactionReentry")));
  await page.locator("#find-transaction-reentry").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("改写");
  await page.evaluate(() => {
    const api = Reflect.get(window, "findTransactionReentry");
    let done = false;
    api.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (done || !transaction.docChanged) return;
      done = true;
      api.setContent("<p>宿主新文档</p>");
    });
  });
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(page.locator("#find-transaction-reentry .semlo-editor-prose")).toHaveText("宿主新文档");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "findTransactionReentry").destroy());
});

test("destroying an editor during find replacement leaves another editor usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const first = document.createElement('div'), second = document.createElement('div')
    first.id = 'destroy-find-first'; second.id = 'destroy-find-second'
    document.body.append(first, second)
    window.destroyFindEditors = [
      createEditor({ element: first, outline: false, content: '<p>目标文字</p>' }),
      createEditor({ element: second, outline: false, content: '<p>另一个编辑器</p>' }),
    ]
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "destroyFindEditors")));
  await page.locator("#destroy-find-first").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("新");
  await page.evaluate(() => {
    const first = Reflect.get(window, "destroyFindEditors")[0];
    first.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) first.destroy();
    });
  });
  await panel.getByRole("button", { name: "替换", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.locator("#destroy-find-second .semlo-editor-prose p").click();
  await page.keyboard.type("x");
  await expect(page.locator("#destroy-find-second .semlo-editor-prose")).toContainText("x");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "destroyFindEditors")[1].destroy());
});

test("destroying an editor while painting does not break another editor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const first = document.createElement('div'), second = document.createElement('div')
    first.id = 'destroy-paint-first'; second.id = 'destroy-paint-second'
    document.body.append(first, second)
    window.destroyPaintEditors = [
      createEditor({ element: first, outline: false, content: '<p><strong>源</strong></p><p>目标</p>' }),
      createEditor({ element: second, outline: false, content: '<p>另一个编辑器</p>' }),
    ]
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "destroyPaintEditors")));
  await page.evaluate(() => {
    const editor = Reflect.get(window, "destroyPaintEditors")[0].editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 2 });
  });
  await page.locator("#destroy-paint-first .semlo-editor-format-painter").click();
  await page.evaluate(() => {
    const first = Reflect.get(window, "destroyPaintEditors")[0];
    const start = first.editor.state.doc.child(0).nodeSize + 1;
    first.editor.commands.focus();
    first.editor.commands.setTextSelection({ from: start, to: start + 2 });
    first.editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) first.destroy();
    });
  });
  await page.locator("#destroy-paint-first .semlo-editor-prose").press("Enter");
  await expect(page.locator("#destroy-paint-first .semlo-editor-prose")).toHaveCount(0);
  await page.locator("#destroy-paint-second .semlo-editor-prose p").click();
  await page.keyboard.type("x");
  await expect(page.locator("#destroy-paint-second .semlo-editor-prose")).toContainText("x");
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(window, "destroyPaintEditors")[1].destroy());
});
