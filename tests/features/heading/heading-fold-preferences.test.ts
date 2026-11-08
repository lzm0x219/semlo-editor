import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-fold-preferences-fixture";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-fold-preferences-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

test("host-owned fold state restores only the same document and does not alter content", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  const host = page.locator("#fold-preferences-host");
  const toggle = host.getByRole("button", { name: "折叠标题：标题" });
  const before = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  await toggle.click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"), undefined, { timeout: 3000 });
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot())).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").changes)).toBe(0);
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("B"));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A", true, true, undefined, "r2"));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A", false));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await host.getByRole("button", { name: "展开标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
});

test("default fold state is saved with content and restores from JSON and HTML", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  const before = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  const folded = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  expect(folded.json.content![0].attrs!.semloEditorHeadingFolded).toBe(true);
  expect(folded.html).toContain('data-semlo-editor-heading-folded="true"');
  expect(folded.text).toBe(before.text);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").changes)).toBe(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves)).toBe(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").capture())).toBe(-1);
  for (const content of [folded.json, folded.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("foldPreferences").mount(null, true, false, value),
      content,
    );
    await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  }
  await host.getByRole("button", { name: "展开标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot())).toEqual(
    before,
  );
  await page.evaluate(
    (value) => window.__semloRequireFixture("foldPreferences").mount(null, false, false, value),
    folded.json,
  );
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await host.getByRole("button", { name: "展开标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot())).toEqual(
    folded,
  );
});

test("pasting a folded heading does not hide existing destination content", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.commands.focus();
    editor.commands.selectAll();
  });
  await page.keyboard.press("ControlOrMeta+c");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.mount(null, true, false, "<p>目标正文</p>");
    fixture.controller!.editor.commands.focus("start");
  });
  await page.keyboard.press("ControlOrMeta+v");
  await expect(host.getByText("目标正文", { exact: true })).toBeVisible();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  const heading = snapshot.json.content!.find((node) => node.type === "heading" && node.content?.[0]?.text === "标题");
  expect(heading?.attrs?.semloEditorHeadingFolded).toBeUndefined();
});

test("三级标题折叠后保存并刷新仍收起正文", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() =>
    window.__semloRequireFixture("foldPreferences").mount(null, true, false, "<h3>三级标题</h3><p>正文</p>"),
  );
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：三级标题" }).click();
  await page.evaluate(() => {
    const html = window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().html;
    sessionStorage.setItem("heading-fold-saved-content", html);
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("foldPreferences")
      .mount(null, true, false, sessionStorage.getItem("heading-fold-saved-content")!),
  );
  await expect(host.getByRole("button", { name: "展开标题：三级标题" })).toBeVisible();
  await expect(host.locator(".semlo-editor-prose > p").getByText("正文", { exact: true })).toBeHidden();
  await page.evaluate(() => sessionStorage.removeItem("heading-fold-saved-content"));
});

test("temporary read-only expansion survives editing and content replacement restores its own folds", async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  const folded = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  await page.evaluate(
    (value) => window.__semloRequireFixture("foldPreferences").mount(null, false, false, value),
    folded,
  );
  await host.getByRole("button", { name: "展开标题：标题" }).click();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("foldPreferences").controller!;
    controller.setEditable(true);
    controller.editor.commands.insertContentAt(1, "新");
  });
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.__semloRequireFixture("foldPreferences").controller!.setContent("<h1>新文档</h1><p>新正文</p>"),
  );
  await expect(host.locator(".semlo-editor-prose p").getByText("新正文", { exact: true })).toBeVisible();
  await page.evaluate((value) => window.__semloRequireFixture("foldPreferences").controller!.setContent(value), folded);
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeHidden();
});

test("converting a folded heading to a paragraph reveals its content and undo restores the fold", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  const before = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.commands.focus();
    editor.commands.setTextSelection(1);
  });
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "正文" }).click();
  await expect(host.locator(".semlo-editor-prose > p").getByText("正文", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.editor.commands.undo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose > p").getByText("正文", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot())).toEqual(
    before,
  );
});

test("inserting below a folded heading uses the expanded current document", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await host.locator(".semlo-editor-prose h1").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="quote"]').click();
  await expect(host.locator(".semlo-editor-prose > blockquote")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-prose > p").getByText("正文", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.editor.commands.undo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose > blockquote")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose > p").getByText("正文", { exact: true })).toBeVisible();
});

test("dragging a folded heading keeps its saved state and can be undone", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  const before = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  const source = host.locator(".semlo-editor-prose h1").filter({ hasText: "标题" });
  const target = host.locator(".semlo-editor-prose h1").filter({ hasText: "后续" });
  await source.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error("标题拖动位置不可用");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, to.y + to.height - 2, { steps: 10 });
  await page.mouse.up();
  const after = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  expect(after).not.toEqual(before);
  const moved = after.content!.find((node) => node.type === "heading" && node.content?.[0]?.text === "标题");
  expect(moved?.attrs?.semloEditorHeadingFolded).toBe(true);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.editor.commands.undo()),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json),
  ).toEqual(before);
});

test("saved edits migrate folded headings to the new revision and survive a page reload", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.persistToBrowser = true;
    fixture.mount("A");
  });
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"));
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    const editor = fixture.controller!.editor;
    editor.view.dispatch(
      editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text("前文"))),
    );
    const heading = editor.state.doc.nodeAt(4)!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(4, undefined, { ...heading.attrs, textAlign: "center" }));
    const capture = fixture.captures[fixture.capture()];
    localStorage.setItem("fold-test-document", JSON.stringify(capture.snapshot.json));
    return { committed: capture.commit("r2"), old: fixture.records.get("A:r1"), current: fixture.records.get("A:r2") };
  });
  expect(result).toEqual({
    committed: true,
    old: { version: 1, positions: [0] },
    current: { version: 1, positions: [4] },
  });
  await host.getByRole("button", { name: "展开标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.get("A:r2")?.positions.length === 0);
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.get("A:r2")?.positions[0] === 4);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.persistToBrowser = true;
    fixture.mount("A", true, false, JSON.parse(localStorage.getItem("fold-test-document")!), "r2");
  });
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeHidden();
  await expect(host.locator(".semlo-editor-prose p").getByText("前文", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    const heading = editor.state.doc.nodeAt(4)!;
    editor.view.dispatch(editor.state.tr.delete(5, 4 + heading.nodeSize - 1));
  });
  await expect(host.getByRole("button", { name: "展开标题：标题 1" })).toBeVisible();
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeHidden();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.view.dispatch(editor.state.tr.delete(4, 4 + editor.state.doc.nodeAt(4)!.nodeSize));
  });
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: "折叠标题：后续" })).toHaveCount(1);
});

test("pending saves keep their captured document and cannot replace a newer revision", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  const host = page.locator("#fold-preferences-host");
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    const editor = fixture.controller!.editor;
    const prepend = (text: string) =>
      editor.view.dispatch(
        editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text(text))),
      );
    prepend("甲");
    const first = fixture.captures[fixture.capture()];
    prepend("乙");
    const second = fixture.captures[fixture.capture()];
    const firstCommitted = first.commit("r2");
    const capturedRecord = fixture.records.get("A:r2");
    editor.view.dom.querySelector<HTMLButtonElement>(".semlo-editor-heading-fold-toggle")!.click();
    const secondCommitted = second.commit("r3");
    const currentRecord = fixture.records.get("A:r3");
    editor.view.dom.querySelector<HTMLButtonElement>(".semlo-editor-heading-fold-toggle")!.click();
    const older = fixture.captures[fixture.capture()];
    const newer = fixture.captures[fixture.capture()];
    const newerCommitted = newer.commit("r4");
    const staleCommitted = older.commit("r5");
    prepend("丙");
    const reusedRevision = fixture.captures[fixture.capture()].commit("r4");
    const reentrant = fixture.captures[fixture.capture()];
    let nestedCommit: boolean | undefined;
    fixture.onSave = () => {
      fixture.onSave = undefined;
      nestedCommit = reentrant.commit("r6");
      prepend("丁");
    };
    const reentrantCommitted = reentrant.commit("r6");
    const reentrantRecord = fixture.records.get("A:r6");
    const beforeUnmount = fixture.captures[fixture.capture()];
    editor.unmount();
    const unmountedCapture = fixture.capture();
    const unmountedCommit = beforeUnmount.commit("r7");
    const mount = document.createElement("div");
    document.querySelector("#fold-preferences-host .semlo-editor-content")!.append(mount);
    editor.mount(mount);
    const remountedCommit = beforeUnmount.commit("r7");
    const afterDestroy = fixture.captures[fixture.capture()];
    fixture.controller!.destroy();
    const destroyedCommitted = afterDestroy.commit("r8");
    fixture.mount("A", true, false, first.snapshot.json, "r2");
    return {
      firstCommitted,
      capturedRecord,
      secondCommitted,
      currentRecord,
      newerCommitted,
      staleCommitted,
      staleRecord: fixture.records.has("A:r5"),
      reusedRevision,
      reentrantCommitted,
      reentrantRecord,
      nestedCommit,
      unmountedCapture,
      unmountedCommit,
      remountedCommit,
      destroyedCommitted,
    };
  });
  expect(result).toEqual({
    firstCommitted: true,
    capturedRecord: { version: 1, positions: [3] },
    secondCommitted: true,
    currentRecord: { version: 1, positions: [] },
    newerCommitted: true,
    staleCommitted: false,
    staleRecord: false,
    reusedRevision: false,
    reentrantCommitted: true,
    reentrantRecord: { version: 1, positions: [9] },
    nestedCommit: false,
    unmountedCapture: -1,
    unmountedCommit: false,
    remountedCommit: false,
    destroyedCommitted: false,
  });
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeHidden();
  await expect(host.locator(".semlo-editor-prose p").getByText("甲", { exact: true })).toBeVisible();
  await expect(host.locator(".semlo-editor-prose p").getByText("乙", { exact: true })).toHaveCount(0);
});

test("controlled echo, remapped positions, search expansion and undo remain coherent", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  const host = page.locator("#fold-preferences-host");
  const before = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"), undefined, { timeout: 3000 });
  const saves = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.view.dispatch(
      editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text("前文"))),
    );
  });
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves)).toBe(saves);
  const edited = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").changes)).toBe(1);
  await page.evaluate(
    (json) => window.__semloRequireFixture("foldPreferences").mount("A", true, false, json, "r2"),
    edited,
  );
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await host.getByRole("button", { name: "查找替换" }).click();
  await page.getByRole("dialog", { name: "查找替换" }).getByRole("textbox", { name: "查找内容" }).fill("正文");
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  await page.waitForFunction(() => window.foldPreferences!.records.get("A:r2")?.positions.length === 0);
  await page.evaluate(
    (json) => window.__semloRequireFixture("foldPreferences").mount("A", true, false, json, "r2"),
    edited,
  );
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  // A fold preference is view state and does not add an undo event.
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.view.dispatch(editor.state.tr.insertText("X", 2));
  });
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.editor.commands.undo());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json),
  ).toEqual(edited);
  expect(edited).not.toEqual(before);
});

test("mutating the original adapter identity cannot move a fold into another document or revision", async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.mount("A");
    fixture.adapter!.documentId = "B";
    fixture.adapter!.revision = "r2";
  });
  await page.locator("#fold-preferences-host").getByRole("button", { name: "折叠标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"));
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").records.has("B:r2"))).toBe(false);
});
