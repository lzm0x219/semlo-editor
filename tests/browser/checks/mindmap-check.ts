// Run after building tests/config/mindmap-rsbuild.config.ts into MINDMAP_TEST_DIR.
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize } from "node:path";

import { chromium } from "playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime.ts";

const root = process.env.MINDMAP_TEST_DIR!;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^\/+/, "") || "index.html";
  try {
    const data = await readFile(join(root, path));
    res.setHeader(
      "Content-Type",
      path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
    );
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server did not start");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await installFixtureGuards(page);
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForSelector(".semlo-editor-mindmap-label");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 4);
  await page.waitForSelector(".semlo-editor-mindmap-line");
  assert.equal(await page.locator(".semlo-editor-mindmap-line").count(), 3);
  const keyboardHeightHandle = page.getByRole("separator", { name: "调整画布高度" });
  const keyboardInitialHeight = Number(await keyboardHeightHandle.getAttribute("aria-valuenow"));
  await keyboardHeightHandle.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await keyboardHeightHandle.getAttribute("aria-valuenow"), String(keyboardInitialHeight + 20));
  assert.equal(await keyboardHeightHandle.evaluate((handle) => document.activeElement === handle), true);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent({ type: "doc", content: [{ type: "semloEditorMindmap" }] }),
  );
  const frozen = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").createMindmapContent());
  assert.equal(frozen.attrs.tree.text, "思维导图");
  assert.equal(frozen.attrs.tree.children.length, 3);
  const independent = await page.evaluate(() => {
    const first = window.__semloRequireFixture("mindmapTest").createMindmapContent();
    first.attrs.tree.text = "先前模板";
    return window.__semloRequireFixture("mindmapTest").createMindmapContent().attrs.tree.text;
  });
  assert.equal(independent, "思维导图");
  frozen.attrs.tree.text = "先前模板";
  await page.evaluate(
    (value) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({ type: "doc", content: [value] }),
    frozen,
  );
  const old = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML() };
  });
  for (const content of [old.json, old.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), old.json);
    assert.equal(await page.getByRole("button", { name: "中心节点：先前模板" }).count(), 1);
  }
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent({ type: "doc", content: [{ type: "semloEditorMindmap" }] }),
  );
  const branch = page.locator(".semlo-editor-mindmap-label").nth(1);
  assert.equal(await page.locator(".semlo-editor-mindmap-label").first().textContent(), "思维导图");
  await branch.dblclick();
  const input = page.getByLabel("编辑节点");
  const text = '<节点> & "内容"';
  await input.fill(text);
  await input.press("Enter");
  assert.equal(await branch.textContent(), text);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await branch.textContent(), "新建节点");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  assert.equal(await branch.textContent(), text);
  await branch.click();
  await page.getByLabel("添加下级节点").click();
  await input.fill("子节点甲");
  await input.press("Enter");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 5);
  const child = page.getByRole("button", { name: "节点：子节点甲" });
  await child.press("Tab");
  await input.fill("孙节点");
  await input.press("Enter");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 6);
  await page.getByRole("button", { name: "节点：孙节点" }).press("Enter");
  await input.fill("同级");
  await input.press("Enter");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 7);
  await page.getByRole("button", { name: "节点：同级" }).press("Backspace");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 6);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 7);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 6);
  await branch.click();
  const collapse = page.getByRole("button", { name: "折叠分支" }).first();
  await collapse.click();
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 4);
  assert.equal(await page.getByRole("button", { name: "展开分支" }).textContent(), "2");
  assert.equal(await page.locator(".semlo-editor-mindmap-line").count(), 3);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 6);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 4);
  const collapsed = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML() };
  });
  const staticCollapsed = await page.evaluate((html) => {
    const svg = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("figure[data-semlo-editor-mindmap] svg");
    return { namespace: svg?.namespaceURI, text: svg?.textContent, paths: svg?.querySelectorAll("path").length };
  }, collapsed.html);
  assert.equal(staticCollapsed.namespace, "http://www.w3.org/2000/svg");
  assert.match(staticCollapsed.text ?? "", /思维导图/);
  assert.doesNotMatch(staticCollapsed.text ?? "", /孙节点/);
  assert.match(staticCollapsed.text ?? "", /2/);
  for (const content of [collapsed.json, collapsed.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      collapsed.json,
    );
    assert.equal(await page.getByRole("button", { name: "展开分支" }).textContent(), "2");
  }
  await page.getByRole("button", { name: "展开分支" }).click();
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 6);
  assert.equal(await page.locator(".semlo-editor-mindmap-line").count(), 5);
  const heightHandle = page.getByRole("separator", { name: "调整画布高度" });
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "460");
  const heightBox = await heightHandle.boundingBox();
  if (!heightBox) throw new Error("missing height handle");
  await page.mouse.move(heightBox.x + heightBox.width / 2, heightBox.y + heightBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(heightBox.x + heightBox.width / 2, heightBox.y + heightBox.height / 2 + 60);
  await page.mouse.up();
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "520");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "460");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "520");
  const snapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.match(snapshot.html, /data-semlo-editor-mindmap/);
  const staticExpanded = await page.evaluate(
    (html) =>
      new DOMParser().parseFromString(html, "text/html").querySelector("figure[data-semlo-editor-mindmap] svg")
        ?.textContent,
    snapshot.html,
  );
  assert.match(staticExpanded ?? "", /孙节点/);
  assert.match(staticExpanded ?? "", /<节点> & "内容"/);
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      snapshot.json,
    );
    assert.equal(await heightHandle.getAttribute("aria-valuenow"), "520");
    assert.equal(await page.getByRole("button", { name: "节点：孙节点" }).count(), 1);
  }
  await branch.dblclick();
  await input.fill("取消");
  await input.press("Escape");
  assert.equal(await branch.textContent(), text);
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(false));
  await branch.dblclick();
  assert.equal(await input.count(), 0);
  assert.equal(await page.getByLabel("添加下级节点").count(), 0);
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(true));
  const futureTree = { text: "未来节点", children: [], futureFeature: { value: 42 } };
  await page.evaluate(
    (tree) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorMindmap", attrs: { tree } }],
      }),
    futureTree,
  );
  assert.equal(await page.getByRole("status").textContent(), "思维导图数据格式不受支持，暂无法编辑。");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 0);
  const unsupportedHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.match(unsupportedHtml, /思维导图数据格式不受支持/);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    unsupportedHtml,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree),
    futureTree,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent('<figure data-semlo-editor-mindmap data-tree="{bad"></figure>'),
  );
  assert.equal(await page.getByRole("status").textContent(), "思维导图数据格式不受支持，暂无法编辑。");
  const malformedHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    malformedHtml,
  );
  assert.equal(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree),
    "{bad",
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    editor.setEditable(true);
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorMindmap",
          attrs: { tree: { text: "原文档", children: [{ text: "旧节点", children: [] }] } },
        },
      ],
    });
  });
  await page.getByRole("button", { name: "节点：旧节点" }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    editor.commands.setContent(editor.getJSON());
  });
  assert.equal(await page.getByRole("button", { name: "节点：旧节点" }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "节点：旧节点" }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    editor.commands.setContent(editor.getHTML());
  });
  assert.equal(await page.getByRole("button", { name: "节点：旧节点" }).getAttribute("aria-pressed"), "false");
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorMindmap",
          attrs: { tree: { text: "新文档", children: [{ text: "新节点", children: [] }] } },
        },
      ],
    }),
  );
  assert.equal(await page.getByRole("button", { name: "节点：新节点" }).getAttribute("aria-pressed"), "false");
  assert.equal(await page.getByLabel("添加下级节点").count(), 0);
  await page.getByRole("button", { name: "节点：新节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("旧草稿");
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorMindmap",
          attrs: { tree: { text: "另一文档", children: [{ text: "另一节点", children: [] }] } },
        },
      ],
    }),
  );
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).count(), 1);
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("实体草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { replaceFirstWithSelf(): void };
    fixture.replaceFirstWithSelf();
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 1);
  assert.equal(await page.getByLabel("编辑节点").inputValue(), "实体草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      rebuildFirstNode(reentrant?: boolean): void;
    };
    fixture.rebuildFirstNode(true);
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"), "false");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const mindmap = editor.getJSON().content![0];
    editor.commands.setContent({
      type: "doc",
      content: [mindmap, { type: "paragraph", content: [{ type: "text", text: "正文 A" }] }],
    });
  });
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("局部替换草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { replaceFirstWithSelf(): void };
    fixture.replaceFirstWithSelf();
  });
  assert.equal(await page.getByLabel("编辑节点").inputValue(), "局部替换草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      rebuildFirstNode(reentrant: "edit"): void;
    };
    fixture.rebuildFirstNode("edit");
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("未提交草稿");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const mindmap = editor.getJSON().content![0];
    editor.commands.setContent({
      type: "doc",
      content: [mindmap, { type: "paragraph", content: [{ type: "text", text: "正文 B" }] }],
    });
  });
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).count(), 1);
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("追加事务草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplace(content: unknown): void;
    };
    fixture.appendReplace(fixture.editor.getJSON());
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("追加事务草稿");
  const reusedMindmap = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReuse(intermediate?: boolean): void;
    };
    const previous = fixture.editor.state.doc.child(0);
    fixture.appendReuse();
    return fixture.editor.state.doc.child(0) === previous;
  });
  assert.equal(reusedMindmap, true);
  assert.equal(await page.getByLabel("编辑节点").count(), 1);
  assert.equal(await page.getByLabel("编辑节点").inputValue(), "追加事务草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplace(content: unknown): void;
    };
    const mindmap = fixture.editor.getJSON().content![0];
    fixture.appendReplace({
      type: "doc",
      content: [mindmap, { type: "paragraph", content: [{ type: "text", text: "追加后的正文" }] }],
    });
  });
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"), "false");
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("事务还原草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      appendReuseAfterEdit(): void;
    };
    fixture.appendReuseAfterEdit();
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 1);
  assert.equal(await page.getByLabel("编辑节点").inputValue(), "事务还原草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      appendReuse(intermediate?: boolean): void;
    };
    fixture.appendReuse(true);
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 1);
  assert.equal(await page.getByLabel("编辑节点").inputValue(), "事务还原草稿");
  await page.getByLabel("编辑节点").press("Escape");
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("多步追加草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplaceWithIntermediate(content: unknown): void;
    };
    const mindmap = fixture.editor.getJSON().content![0];
    fixture.appendReplaceWithIntermediate({
      type: "doc",
      content: [mindmap, { type: "paragraph", content: [{ type: "text", text: "多步替换后" }] }],
    });
  });
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).count(), 1);
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { duplicateFirstNode(): void };
    fixture.duplicateFirstNode();
  });
  const twoMindmaps = page.locator(".semlo-editor-mindmap");
  assert.equal(await twoMindmaps.count(), 2);
  assert.equal(
    await page.evaluate(() => {
      const doc = window.__semloRequireFixture("mindmapTest").editor.state.doc;
      return doc.child(0) === doc.child(2);
    }),
    true,
  );
  await twoMindmaps.nth(0).getByRole("button", { name: "节点：另一节点" }).click();
  await twoMindmaps.nth(1).getByRole("button", { name: "节点：另一节点" }).dblclick();
  await twoMindmaps.nth(1).getByLabel("编辑节点").fill("第二个草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { rebuildLastNode(): void };
    fixture.rebuildLastNode();
  });
  assert.equal(await twoMindmaps.nth(1).getByLabel("编辑节点").count(), 0);
  assert.equal(
    await twoMindmaps.nth(1).getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await twoMindmaps.nth(0).getByRole("button", { name: "节点：另一节点" }).count(), 1);
  assert.equal(
    await twoMindmaps.nth(0).getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"),
    "true",
  );
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { moveFirstAfterParagraph(): void };
    fixture.moveFirstAfterParagraph();
  });
  await page.getByRole("button", { name: "节点：另一节点" }).dblclick();
  await page.getByLabel("编辑节点").fill("位置变化草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { editLeadingText(): void };
    fixture.editLeadingText();
  });
  assert.equal(await page.getByLabel("编辑节点").inputValue(), "位置变化草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { rebuildNodeAfterTextEdit(): void };
    fixture.rebuildNodeAfterTextEdit();
  });
  assert.equal(await page.getByLabel("编辑节点").count(), 0);
  assert.equal(await page.getByRole("button", { name: "节点：另一节点" }).getAttribute("aria-pressed"), "false");
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.destroy());
  assert.equal(await page.locator(".semlo-editor-mindmap").count(), 0);
  const withoutObserver = await browser.newPage();
  await withoutObserver.addInitScript(() => Object.defineProperty(window, "ResizeObserver", { value: undefined }));
  await withoutObserver.goto(`http://127.0.0.1:${address.port}/`);
  await withoutObserver.waitForSelector(".semlo-editor-mindmap-line");
  assert.equal(await withoutObserver.locator(".semlo-editor-mindmap-line").count(), 3);
  const previousPath = await withoutObserver.locator(".semlo-editor-mindmap-line").first().getAttribute("d");
  await withoutObserver
    .locator(".semlo-editor-mindmap-label")
    .first()
    .evaluate((label) => {
      (label as HTMLElement).style.fontSize = "48px";
      window.dispatchEvent(new Event("resize"));
    });
  assert.notEqual(await withoutObserver.locator(".semlo-editor-mindmap-line").first().getAttribute("d"), previousPath);
  await withoutObserver.close();
  console.log("mindmap: tree editing, undo/redo, JSON/HTML, cancel, read-only and destroy passed");
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
