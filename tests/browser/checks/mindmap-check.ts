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
  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";
  const redoKey = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
  await installFixtureGuards(page);
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForSelector(".semlo-editor-mindmap-label");
  assert.equal(await page.locator(".semlo-editor-mindmap-label").count(), 4);
  await page.waitForSelector(".semlo-editor-mindmap-line");
  assert.equal(await page.locator(".semlo-editor-mindmap-line").count(), 3);
  const beforeViewport = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  const rootLabel = page.getByRole("button", { name: "中心节点：思维导图" });
  const initialBox = await rootLabel.boundingBox();
  if (!initialBox) throw new Error("missing mindmap root");
  await page.getByRole("button", { name: "最大化思维导图" }).click();
  assert.equal(await page.getByRole("button", { name: "返回文档" }).count(), 1);
  const maximizedBox = await page.locator(".semlo-editor-mindmap").boundingBox();
  assert.ok(maximizedBox && maximizedBox.width === page.viewportSize()?.width && maximizedBox.y === 0);
  await rootLabel.dblclick();
  await page.getByLabel("编辑中心节点").fill("最大化测试");
  await page.getByLabel("编辑中心节点").press("Enter");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await rootLabel.count(), 1);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "中心节点：最大化测试" }).count(), 1);
  await page.getByRole("button", { name: "返回文档" }).click();
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeViewport,
  );
  await page.getByRole("button", { name: "放大画布" }).click();
  assert.equal(await page.getByLabel("缩放比例").textContent(), "120%");
  const enlargedBox = await rootLabel.boundingBox();
  if (!enlargedBox) throw new Error("missing enlarged mindmap root");
  assert.ok(enlargedBox.width > initialBox.width);
  await page.getByRole("button", { name: "平移画布" }).click();
  const viewport = page.getByLabel("平移思维导图");
  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  const movedBox = await rootLabel.boundingBox();
  if (!movedBox) throw new Error("missing moved mindmap root");
  assert.ok(movedBox.x > enlargedBox.x + 25);
  await page.getByRole("button", { name: "适应画布" }).click();
  assert.equal(await page.getByLabel("缩放比例").textContent(), "100%");
  await page.getByRole("button", { name: "平移画布" }).click();
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeViewport,
  );
  await page.getByRole("button", { name: "连线工具" }).click();
  await page.getByRole("button", { name: "绘制曲线" }).click();
  const firstNode = page.getByRole("button", { name: "节点：新建节点" }).first();
  const lastNode = page.getByRole("button", { name: "节点：新建节点" }).last();
  const firstBox = await firstNode.boundingBox();
  const lastBox = await lastNode.boundingBox();
  if (!firstBox || !lastBox) throw new Error("missing nodes for association");
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 5 });
  await page.mouse.up();
  const associated = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const associatedAttrs = associated.json.content?.[0]?.attrs;
  const associatedEdge = associatedAttrs?.canvasShapes.edges[0];
  assert.equal(associatedEdge.from, `@mindmap-node:${associatedAttrs?.tree.children[0].nodeId}`);
  assert.equal(associatedEdge.to, `@mindmap-node:${associatedAttrs?.tree.children[2].nodeId}`);
  assert.match(associated.html, /data-semlo-mindmap-node=/);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-mindmap-line")), associatedEdge.id);
  await page.keyboard.press(undoKey);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeViewport,
  );
  await page.keyboard.press(redoKey);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    associated.json,
  );
  const exportedPath = (html: string) =>
    page.evaluate((value) => {
      const document = new DOMParser().parseFromString(value, "text/html");
      return document.querySelector("figure svg > g:last-child > path")?.getAttribute("d");
    }, html);
  const initialExportedPath = await exportedPath(associated.html);
  assert.ok(initialExportedPath);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    associated.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    associated.json,
  );
  const oldAssociationPath = await page.locator("[data-mindmap-line]").getAttribute("d");
  await firstNode.press("Enter");
  await page.getByLabel("编辑节点").fill("插入节点");
  await page.getByLabel("编辑节点").press("Enter");
  assert.notEqual(await page.locator("[data-mindmap-line]").getAttribute("d"), oldAssociationPath);
  const afterInsertion = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
  );
  assert.equal(afterInsertion?.canvasShapes.edges[0].to, associatedEdge.to);
  assert.notEqual(
    await exportedPath(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML())),
    initialExportedPath,
  );
  await lastNode.press("Delete");
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0].to,
    ),
    "",
  );
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0].to,
    ),
    associatedEdge.to,
  );
  const legacyReference = structuredClone(beforeViewport);
  legacyReference.content![0].attrs!.canvasShapes = {
    shapes: [],
    edges: [
      {
        id: "legacy-line",
        from: "@mindmap-node:legacy",
        to: "",
        text: "",
        dashed: false,
        arrow: true,
        fromPoint: { x: 10, y: 10 },
        toPoint: { x: 80, y: 80 },
      },
    ],
  };
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    legacyReference,
  );
  await rootLabel.dblclick();
  await page.getByLabel("编辑中心节点").fill("兼容测试");
  await page.getByLabel("编辑中心节点").press("Enter");
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0].from,
    ),
    "@mindmap-node:legacy",
  );
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeViewport,
  );
  await page.getByRole("button", { name: "画笔工具" }).click();
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  const canvasBox = await page.locator(".semlo-editor-mindmap-viewport").boundingBox();
  if (!canvasBox) throw new Error("missing drawing viewport");
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 90);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 230, canvasBox.y + 120, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 1);
  const drawing = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(drawing.json.content?.[0]?.attrs?.drawing.length, 1);
  assert.match(drawing.html, /data-drawing=/);
  assert.match(drawing.html, /stroke="#585a5a"/);
  await page.keyboard.press(undoKey);
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 0);
  await page.keyboard.press(redoKey);
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 1);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    drawing.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    drawing.json,
  );
  const strokeBox = await (
    await page.waitForFunction(() => {
      const bounds = document.querySelector(".semlo-editor-mindmap-stroke")?.getBoundingClientRect();
      return bounds?.width && bounds.height
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : false;
    })
  ).jsonValue();
  if (!strokeBox) throw new Error("missing drawing stroke");
  await page.getByRole("button", { name: "画笔工具" }).click();
  await page.getByRole("button", { name: "橡皮擦" }).click();
  await page.mouse.move(strokeBox.x + strokeBox.width / 2, strokeBox.y - 10);
  await page.mouse.down();
  await page.mouse.move(strokeBox.x + strokeBox.width / 2, strokeBox.y + strokeBox.height + 10, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 0);
  await page.keyboard.press(undoKey);
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 1);
  await page.getByRole("button", { name: "画笔工具" }).click();
  await page.getByRole("button", { name: "马克笔" }).click();
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 150);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 230, canvasBox.y + 150, { steps: 4 });
  await page.mouse.up();
  const marker = page.locator(".semlo-editor-mindmap-stroke").last();
  assert.equal(await marker.getAttribute("stroke-opacity"), "0.5");
  assert.equal(await marker.getAttribute("stroke-linecap"), "square");
  const markedDrawing = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(markedDrawing.json.content?.[0]?.attrs?.drawing[1].kind, "marker");
  assert.match(markedDrawing.html, /stroke-opacity="0.5"/);
  await page.keyboard.press(undoKey);
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 1);
  await page.keyboard.press(redoKey);
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 2);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    markedDrawing.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    markedDrawing.json,
  );
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeViewport,
  );
  assert.equal(await page.locator(".semlo-editor-mindmap-stroke").count(), 0);
  await page.getByRole("button", { name: "画笔工具" }).click();
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 90);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 160, canvasBox.y + 100);
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeViewport,
  );
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.drawing,
    ),
    null,
  );
  await page.getByRole("button", { name: "画布文字工具" }).click();
  await page.mouse.click(canvasBox.x + 120, canvasBox.y + 210);
  await page.getByRole("button", { name: "画布文字：文本" }).dblclick();
  await page.getByLabel("编辑画布文字").fill("画布注释\n第二行");
  await page.getByLabel("编辑画布文字").press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  const annotation = page.getByRole("button", { name: /画布文字：画布注释/ });
  await rootLabel.click();
  assert.equal(await page.locator(".semlo-editor-mindmap-annotation-resize").count(), 0);
  await annotation.click();
  assert.equal(await page.locator(".semlo-editor-mindmap-annotation-resize").count(), 4);
  await page.getByRole("button", { name: "插入画布文字链接" }).click();
  const annotationLink = page.getByRole("dialog", { name: "画布文字链接" });
  await annotationLink.getByLabel("链接", { exact: true }).fill("javascript:alert(1)");
  await annotationLink.getByRole("button", { name: "确定" }).click();
  assert.equal(await annotationLink.isVisible(), true);
  await annotationLink.getByLabel("链接", { exact: true }).fill("https://example.com/first");
  await annotationLink.getByRole("button", { name: "确定" }).click();
  let annotationLinks = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
  );
  assert.equal(annotationLinks.text, "画布注释\n第二行");
  assert.equal(annotationLinks.href, "https://example.com/first");
  await annotation.dblclick();
  await page.getByLabel("编辑画布文字").evaluate((field) => (field as HTMLTextAreaElement).setSelectionRange(0, 2));
  await page.getByRole("button", { name: "插入画布文字链接" }).click();
  await annotationLink.getByLabel("链接", { exact: true }).fill("https://example.com/second");
  await annotationLink.getByRole("button", { name: "确定" }).click();
  annotationLinks = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
  );
  assert.deepEqual(annotationLinks.links, [
    { from: 0, to: 2, href: "https://example.com/second" },
    { from: 2, to: 8, href: "https://example.com/first" },
  ]);
  const linkedHTML = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.match(linkedHTML, /href="https:\/\/example\.com\/first"/);
  assert.match(linkedHTML, /href="https:\/\/example\.com\/second"/);
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(false));
  assert.equal(
    await page.locator('.semlo-editor-mindmap-annotation-label a[href="https://example.com/second"]').count(),
    1,
  );
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(true));
  await annotation.dblclick();
  await page.getByLabel("编辑画布文字").evaluate((field) => (field as HTMLTextAreaElement).setSelectionRange(0, 2));
  await page.getByRole("button", { name: "插入画布文字链接" }).click();
  await annotationLink.getByRole("button", { name: "移除链接" }).click();
  annotationLinks = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
  );
  assert.deepEqual(annotationLinks.links, [{ from: 2, to: 8, href: "https://example.com/first" }]);
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].links.length,
    ),
    2,
  );
  assert.equal(
    await page.getByRole("link", { name: "打开画布文字链接：画布" }).getAttribute("href"),
    "https://example.com/second",
  );
  await page.getByRole("button", { name: "插入画布文字链接" }).click();
  assert.equal(await annotationLink.getByLabel("文本", { exact: true }).inputValue(), "https://example.com/first");
  await annotationLink.getByLabel("文本", { exact: true }).fill("附加");
  await annotationLink.getByLabel("链接", { exact: true }).fill("https://example.com/third");
  await annotationLink.getByRole("button", { name: "确定" }).click();
  annotationLinks = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
  );
  assert.equal(annotationLinks.text, "画布注释\n第二行附加");
  assert.deepEqual(annotationLinks.links[2], { from: 8, to: 10, href: "https://example.com/third" });
  await page.keyboard.press(undoKey);
  await page.getByRole("button", { name: "画布文字加粗" }).click();
  await page.getByRole("button", { name: "画布文字颜色", exact: true }).click();
  await page.getByRole("button", { name: "画布文字颜色 #db9292" }).click();
  await page.getByLabel("画布文字水平对齐").selectOption("right");
  await page.getByLabel("画布文字垂直对齐").selectOption("bottom");
  assert.equal(await annotation.evaluate((element) => getComputedStyle(element).textAlign), "right");
  assert.equal(await annotation.evaluate((element) => (element as HTMLElement).style.justifyContent), "flex-end");
  const beforeResize = await annotation.boundingBox();
  const annotationResize = page.getByRole("button", { name: "调整画布文字大小：右下" });
  const annotationResizeBox = await annotationResize.boundingBox();
  if (!beforeResize || !annotationResizeBox) throw new Error("missing canvas text resize handle");
  await page.mouse.move(
    annotationResizeBox.x + annotationResizeBox.width / 2,
    annotationResizeBox.y + annotationResizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    annotationResizeBox.x + annotationResizeBox.width / 2 + 60,
    annotationResizeBox.y + annotationResizeBox.height / 2 + 40,
    { steps: 4 },
  );
  await page.mouse.up();
  const resizedText = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const resizedAnnotation = resizedText.json.content?.[0]?.attrs?.annotations[0];
  assert.ok(resizedAnnotation.width > beforeResize.width + 50);
  assert.ok(resizedAnnotation.height > beforeResize.height + 30);
  const alignment = await annotation.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const text = element.querySelector("span")!.getBoundingClientRect();
    return { top: text.top - box.top, bottom: box.bottom - text.bottom };
  });
  assert.ok(alignment.top > 30);
  assert.ok(alignment.bottom <= 6);
  assert.equal(resizedAnnotation.size, 14);
  assert.equal(resizedAnnotation.align, "right");
  assert.equal(resizedAnnotation.verticalAlign, "bottom");
  assert.match(resizedText.html, /foreignObject/);
  assert.match(resizedText.html, /text-align:\s*right/);
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].width,
    ),
    undefined,
  );
  await page.keyboard.press(redoKey);
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].width,
    ),
    resizedAnnotation.width,
  );
  const cancelBox = await annotationResize.boundingBox();
  if (!cancelBox) throw new Error("missing canvas text resize handle for cancellation");
  await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + cancelBox.width / 2 + 30, cancelBox.y + cancelBox.height / 2 + 30);
  await annotationResize.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].width,
    ),
    resizedAnnotation.width,
  );
  await annotationResize.press("Shift+ArrowRight");
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].width,
    ),
    resizedAnnotation.width + 10,
  );
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].width,
    ),
    resizedAnnotation.width,
  );
  const textRotate = page.getByRole("button", { name: "旋转画布文字" });
  await textRotate.press("Shift+ArrowRight");
  const rotatedText = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(rotatedText.json.content?.[0]?.attrs?.annotations[0].rotation, 15);
  assert.match(rotatedText.html, /rotate\(15 /);
  const rotatedBeforeResize = rotatedText.json.content![0].attrs!.annotations[0];
  const rotatedResizeBox = await annotationResize.boundingBox();
  if (!rotatedResizeBox) throw new Error("missing rotated text resize handle");
  await page.mouse.move(
    rotatedResizeBox.x + rotatedResizeBox.width / 2,
    rotatedResizeBox.y + rotatedResizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    rotatedResizeBox.x + rotatedResizeBox.width / 2 + 50,
    rotatedResizeBox.y + rotatedResizeBox.height / 2 + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  const rotatedAfterResize = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
  );
  const anchor = (item: typeof rotatedBeforeResize) => {
    const radians = (item.rotation * Math.PI) / 180;
    return {
      x: item.x + item.width / 2 - (Math.cos(radians) * item.width) / 2 + (Math.sin(radians) * item.height) / 2,
      y: item.y + item.height / 2 - (Math.sin(radians) * item.width) / 2 - (Math.cos(radians) * item.height) / 2,
    };
  };
  assert.ok(rotatedAfterResize.width > rotatedBeforeResize.width);
  assert.ok(Math.abs(anchor(rotatedAfterResize).x - anchor(rotatedBeforeResize).x) < 0.1);
  assert.ok(Math.abs(anchor(rotatedAfterResize).y - anchor(rotatedBeforeResize).y) < 0.1);
  await page.keyboard.press(undoKey);
  assert.deepEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
    ),
    rotatedBeforeResize,
  );
  const textRotateBox = await textRotate.boundingBox();
  const rotatedTextBox = await annotation.boundingBox();
  if (!textRotateBox || !rotatedTextBox) throw new Error("missing text rotation handle");
  await page.mouse.move(textRotateBox.x + textRotateBox.width / 2, textRotateBox.y + textRotateBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotatedTextBox.x + rotatedTextBox.width + 40, rotatedTextBox.y + rotatedTextBox.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  assert.notEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].rotation,
    ),
    15,
  );
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].rotation,
    ),
    15,
  );
  await page.keyboard.press(undoKey);
  const beforeTextMove = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0],
  );
  const annotationBox = await annotation.boundingBox();
  if (!annotationBox) throw new Error("missing canvas text");
  await page.mouse.move(annotationBox.x + 8, annotationBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(annotationBox.x + 68, annotationBox.y + 38, { steps: 4 });
  await page.mouse.up();
  const afterTextMove = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const textData = afterTextMove.json.content?.[0]?.attrs?.annotations[0];
  assert.ok(textData.x > beforeTextMove.x + 50);
  assert.equal(textData.bold, true);
  assert.equal(textData.color, "#db9292");
  assert.match(afterTextMove.html, /data-annotations=/);
  assert.match(afterTextMove.html, /第二行/);
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations[0].x,
    ),
    beforeTextMove.x,
  );
  await page.keyboard.press(redoKey);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    afterTextMove.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    afterTextMove.json,
  );
  await annotation.press("Delete");
  assert.equal(await annotation.count(), 0);
  await page.keyboard.press(undoKey);
  assert.equal(await annotation.count(), 1);
  await page.keyboard.press(redoKey);
  assert.equal(await annotation.count(), 0);
  await page.keyboard.press(undoKey);
  assert.equal(await annotation.count(), 1);
  await annotation.click();
  const replaceResizeBox = await annotationResize.boundingBox();
  if (!replaceResizeBox) throw new Error("missing canvas text resize handle before replacement");
  await page.mouse.move(
    replaceResizeBox.x + replaceResizeBox.width / 2,
    replaceResizeBox.y + replaceResizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    replaceResizeBox.x + replaceResizeBox.width / 2 + 30,
    replaceResizeBox.y + replaceResizeBox.height / 2 + 30,
  );
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeViewport,
  );
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.annotations,
    ),
    null,
  );
  await page.getByRole("button", { name: "图形工具" }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.click(canvasBox.x + 120, canvasBox.y + 210);
  const shape = page.getByRole("button", { name: /^图形：矩形/ });
  await shape.dblclick();
  await page.getByLabel("编辑图形文字").fill("图形内容");
  await page.getByLabel("编辑图形文字").press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await page.getByRole("button", { name: "图形填充颜色", exact: true }).click();
  await page.getByRole("button", { name: "图形填充颜色 #8cc5bd" }).click();
  const resizeHandle = page.getByRole("button", { name: "调整图形大小" });
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizeBox) throw new Error("missing shape resize handle");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 60, resizeBox.y + resizeBox.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  const pointerWidth = await page.evaluate(
    () =>
      window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes[0].width,
  );
  await resizeHandle.press("ArrowRight");
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes[0].width,
    ),
    pointerWidth + 1,
  );
  await page.keyboard.press(undoKey);
  const shaped = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const shapeData = shaped.json.content?.[0]?.attrs?.canvasShapes.shapes[0];
  assert.equal(shapeData.text, "图形内容");
  assert.equal(shapeData.fill, "#8cc5bd");
  assert.ok(shapeData.width > 150 && shapeData.height > 120);
  assert.match(shaped.html, /data-canvas-shapes=/);
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes[0].width,
    ),
    100,
  );
  await page.keyboard.press(redoKey);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    shaped.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    shaped.json,
  );
  await shape.press("Delete");
  assert.equal(await shape.count(), 0);
  await page.keyboard.press(undoKey);
  assert.equal(await shape.count(), 1);
  await shape.focus();
  const rotateHandle = page.getByRole("button", { name: "旋转图形" });
  await rotateHandle.press("Shift+ArrowRight");
  const rotated = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(rotated.json.content?.[0]?.attrs?.canvasShapes.shapes[0].rotation, 15);
  assert.match(rotated.html, /rotate\(15 /);
  const rotateBox = await rotateHandle.boundingBox();
  const rotationShapeBox = await shape.boundingBox();
  if (!rotateBox || !rotationShapeBox) throw new Error("missing rotation handle");
  await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rotationShapeBox.x + rotationShapeBox.width + 40,
    rotationShapeBox.y + rotationShapeBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  assert.notEqual(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes[0]
          .rotation,
    ),
    15,
  );
  await page.keyboard.press(undoKey);
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes[0]
          .rotation,
    ),
    15,
  );
  await page.keyboard.press(undoKey);
  await page.getByRole("button", { name: "连线工具" }).click();
  await page.getByRole("button", { name: "绘制曲线" }).click();
  const sourceBox = await shape.boundingBox();
  if (!sourceBox) throw new Error("missing line source shape");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 100, canvasBox.y + 100, { steps: 5 });
  await page.mouse.up();
  const linkedShape = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const linkedData = linkedShape.json.content?.[0]?.attrs?.canvasShapes;
  assert.equal(linkedData.edges[0].from, linkedData.shapes[0].id);
  assert.equal(linkedData.edges[0].route, "curved");
  assert.match(linkedShape.html, /data-canvas-shapes=/);
  await page.getByRole("button", { name: "编辑连线文字" }).click();
  const lineInput = page.getByRole("textbox", { name: "连线文字" });
  await lineInput.fill("说明");
  await lineInput.press("Enter");
  const readLineText = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0]?.text,
    );
  assert.equal(await readLineText(), "说明");
  assert.match(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML()), /说明/);
  await page.keyboard.press(undoKey);
  assert.equal(await readLineText(), "");
  await page.keyboard.press(redoKey);
  assert.equal(await readLineText(), "说明");
  await page.getByRole("button", { name: "起点箭头样式" }).click();
  assert.equal(await page.getByRole("dialog", { name: "起点箭头样式选择" }).getByRole("button").count(), 22);
  await page.getByRole("button", { name: "起点上侧单线箭头" }).click();
  await page.getByRole("button", { name: "终点箭头样式" }).click();
  await page.getByRole("button", { name: "终点三叉线与圆圈" }).click();
  const beforeReverse = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0],
  );
  assert.equal(beforeReverse.startMarker, "oneSideUp");
  assert.equal(beforeReverse.endMarker, "crowFootCircle");
  assert.match(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML()),
    /crowFootCircle/,
  );
  await page.getByRole("button", { name: "交换连线起点和终点" }).click();
  const reversed = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0],
  );
  assert.equal(reversed.to, beforeReverse.from);
  assert.equal(reversed.startMarker, beforeReverse.endMarker);
  assert.equal(reversed.endMarker, beforeReverse.startMarker);
  await page.keyboard.press(undoKey);
  assert.deepEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0],
    ),
    beforeReverse,
  );
  const markedHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    markedHtml,
  );
  assert.deepEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0],
    ),
    beforeReverse,
  );
  await page.getByRole("button", { name: "连线：说明" }).focus();
  await page.getByRole("button", { name: "连线类型" }).click();
  await page.getByRole("menuitemradio", { name: "折线", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0].route,
    ),
    "orthogonal",
  );
  const movingShape = await shape.boundingBox();
  if (!movingShape) throw new Error("missing linked shape");
  await page.mouse.move(movingShape.x + 10, movingShape.y + 10);
  await page.mouse.down();
  await page.mouse.move(movingShape.x + 30, movingShape.y + 30, { steps: 4 });
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.edges[0].from,
    ),
    linkedData.shapes[0].id,
  );
  await shape.press("Delete");
  const detached = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
  );
  assert.equal(detached.shapes.length, 0);
  assert.equal(detached.edges[0].from, "");
  assert.ok(detached.edges[0].fromPoint);
  await page.keyboard.press(undoKey);
  assert.equal(await shape.count(), 1);
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeViewport,
  );
  await page.getByRole("button", { name: "图形工具" }).click();
  await page.getByRole("button", { name: "Smart", exact: true }).click();
  await page.getByRole("button", { name: "阶段图", exact: true }).click();
  await page.mouse.click(canvasBox.x + 120, canvasBox.y + 210);
  const stage = page.getByRole("button", { name: "图形：组合文字，阶段一" });
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("missing smart template");
  const groupRotate = page.getByRole("button", { name: "旋转图形组合" });
  const originalGroup = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
  );
  await groupRotate.press("Shift+ArrowRight");
  const rotatedGroup = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { data: editor.getJSON().content?.[0]?.attrs?.canvasShapes, html: editor.getHTML() };
  });
  assert.ok(rotatedGroup.data.shapes.every((entry: { rotation?: number }) => entry.rotation === 15));
  assert.notEqual(rotatedGroup.data.shapes[0].x, originalGroup.shapes[0].x);
  assert.match(rotatedGroup.html, /rotate\(15 /);
  await page.getByRole("button", { name: "调整图形大小" }).press("Shift+ArrowRight");
  const resizedGroup = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
  );
  const ratioX = resizedGroup.shapes[0].width / rotatedGroup.data.shapes[0].width;
  const ratioY = resizedGroup.shapes[0].height / rotatedGroup.data.shapes[0].height;
  assert.ok(ratioX > 1 && Math.abs(ratioX - ratioY) < 1e-8);
  await page.keyboard.press(undoKey);
  assert.deepEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
    ),
    rotatedGroup.data,
  );
  await page.keyboard.press(undoKey);
  assert.deepEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
    ),
    originalGroup,
  );
  const groupRotateBox = await groupRotate.boundingBox();
  const groupBoundsBox = await page.locator(".semlo-editor-mindmap-shape-group").boundingBox();
  if (!groupRotateBox || !groupBoundsBox) throw new Error("missing group rotation handle");
  await page.mouse.move(groupRotateBox.x + groupRotateBox.width / 2, groupRotateBox.y + groupRotateBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(groupBoundsBox.x + groupBoundsBox.width + 40, groupBoundsBox.y + groupBoundsBox.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  assert.ok(
    (await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes[0]
          .rotation,
    )) !== 0,
  );
  await page.keyboard.press(undoKey);
  assert.deepEqual(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
    ),
    originalGroup,
  );
  const beforeGroupMove = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes,
  );
  assert.equal(beforeGroupMove.groups.length, 1);
  assert.equal(beforeGroupMove.shapes.length, 6);
  await page.mouse.move(stageBox.x + 10, stageBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 70, stageBox.y + 30, { steps: 4 });
  await page.mouse.up();
  const movedGroup = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.ok(
    movedGroup.json.content?.[0]?.attrs?.canvasShapes.shapes.every(
      (item: { x: number }, index: number) => item.x > beforeGroupMove.shapes[index].x + 50,
    ),
  );
  await page.keyboard.press(undoKey);
  await page.keyboard.press(redoKey);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    movedGroup.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    movedGroup.json,
  );
  await stage.click();
  await page.getByRole("button", { name: "取消图形编组" }).click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.groups.length,
    ),
    0,
  );
  await stage.press("Delete");
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.canvasShapes.shapes.length,
    ),
    5,
  );
  await page.keyboard.press(undoKey);
  assert.equal(await stage.count(), 1);
  const fitContent = structuredClone(beforeViewport);
  const fitAttrs = fitContent.content![0].attrs!;
  fitAttrs.canvasShapes = {
    shapes: [{ ...shapeData, x: -350, y: -180, rotation: 35 }],
    edges: [
      {
        id: "fit-line",
        from: "",
        to: "",
        text: "连线",
        dashed: false,
        arrow: true,
        fromPoint: { x: 650, y: 200 },
        toPoint: { x: 900, y: 350 },
        route: "straight",
      },
    ],
  };
  fitAttrs.annotations = [{ x: 800, y: -200, text: "画布文字", size: 18, color: "#585a5a", bold: false }];
  fitAttrs.drawing = [
    {
      points: [
        { x: -450, y: 200 },
        { x: -300, y: 300 },
      ],
      color: "#585a5a",
      width: 3,
    },
  ];
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    fitContent,
  );
  await page.getByRole("button", { name: "适应画布" }).click();
  const fitted = await page.evaluate(() => {
    const viewport = document.querySelector(".semlo-editor-mindmap-viewport")!.getBoundingClientRect();
    const items = document.querySelectorAll(
      "[data-mindmap-shape], [data-mindmap-annotation], .semlo-editor-mindmap-stroke, .semlo-editor-mindmap-canvas-line",
    );
    return [...items].map((item) => {
      const bounds = item.getBoundingClientRect();
      return (
        bounds.left >= viewport.left &&
        bounds.right <= viewport.right &&
        bounds.top >= viewport.top &&
        bounds.bottom <= viewport.bottom
      );
    });
  });
  assert.equal(fitted.length, 4);
  assert.ok(fitted.every(Boolean));
  assert.notEqual(await page.getByLabel("缩放比例").textContent(), "100%");
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeViewport,
  );
  await page.getByRole("button", { name: "适应画布" }).click();
  const styledBranch = page.getByRole("button", { name: "节点：新建节点" }).first();
  await styledBranch.click();
  await page.getByRole("button", { name: "分支样式" }).click();
  await page.getByRole("button", { name: "直角分支" }).click();
  await page.getByLabel("分支粗细").fill("5");
  await page.getByLabel("分支粗细").press("Tab");
  await page.getByRole("button", { name: "分支颜色", exact: true }).click();
  await page.getByRole("button", { name: "分支颜色 #db9292" }).click();
  const branchStyle = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(branchStyle.json.content?.[0]?.attrs?.tree.branchType, "elbow");
  assert.deepEqual(branchStyle.json.content?.[0]?.attrs?.tree.children[0].branch, { width: 5, color: "#db9292" });
  const branchLine = page.locator(".semlo-editor-mindmap-line").first();
  assert.equal(await branchLine.getAttribute("stroke"), "#db9292");
  assert.equal(await branchLine.getAttribute("stroke-width"), "5");
  assert.match((await branchLine.getAttribute("d"))!, / H .* V /);
  assert.match(branchStyle.html, /stroke="#db9292" stroke-width="5"/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    branchStyle.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    branchStyle.json,
  );
  await styledBranch.click();
  await page.getByRole("button", { name: "节点形状" }).click();
  await page.getByRole("button", { name: "圆角节点" }).click();
  await page.getByRole("button", { name: "节点填充颜色", exact: true }).click();
  await page.getByLabel("自定义节点填充颜色").fill("#ffcccc");
  await page.getByRole("button", { name: "节点描边颜色", exact: true }).click();
  await page.getByLabel("自定义节点描边颜色").fill("#336699");
  await page.getByLabel("节点描边粗细").fill("4");
  await page.getByLabel("节点描边粗细").press("Tab");
  const appearance = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.deepEqual(appearance.json.content?.[0]?.attrs?.tree.children[0].appearance, {
    shape: "round",
    fill: "#ffcccc",
    stroke: "#336699",
    strokeWidth: 4,
  });
  assert.equal(
    await styledBranch.evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(255, 204, 204)",
  );
  assert.match(appearance.html, /fill="#ffcccc" stroke="#336699" stroke-width="4"/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    appearance.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    appearance.json,
  );
  await styledBranch.click();
  await page.getByRole("button", { name: "节点形状" }).click();
  await page.getByRole("button", { name: "无描边" }).click();
  assert.equal(await styledBranch.evaluate((element) => getComputedStyle(element).borderColor), "rgba(0, 0, 0, 0)");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await styledBranch.click();
  await page.getByRole("button", { name: "添加标记" }).click();
  await page.getByRole("button", { name: "优先级 1" }).click();
  await page.getByRole("button", { name: "进度 50%" }).click();
  await page.getByRole("button", { name: "旗帜 5" }).click();
  const marked = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.deepEqual(marked.json.content?.[0]?.attrs?.tree.children[0].markers, { priority: 0, progress: 3, flag: 4 });
  assert.equal(await styledBranch.locator(".semlo-editor-mindmap-marker").count(), 3);
  assert.match(marked.html, /aria-label="进度 50%"/);
  await page.getByRole("button", { name: "清除优先级" }).click();
  assert.equal(await styledBranch.locator(".semlo-editor-mindmap-marker").count(), 2);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    marked.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    marked.json,
  );
  await styledBranch.locator(".semlo-editor-mindmap-marker").first().click();
  assert.equal(await page.getByRole("button", { name: "旗帜 5" }).count(), 0);
  await page.getByRole("button", { name: "优先级 2" }).click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0].markers
          .priority,
    ),
    1,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await styledBranch.click();
  await page.getByRole("button", { name: "添加概要" }).click();
  await page.getByRole("button", { name: "概要：概要" }).dblclick();
  await page.getByLabel("编辑节点").fill("结论");
  await page.getByLabel("编辑节点").press("Enter");
  await page.getByRole("button", { name: "添加下级节点" }).click();
  await page.getByLabel("编辑节点").fill("概要子项");
  await page.getByLabel("编辑节点").press("Enter");
  const summary = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(summary.json.content?.[0]?.attrs?.tree.children[0].summary.text, "结论");
  assert.equal(summary.json.content?.[0]?.attrs?.tree.children[0].summary.children[0].text, "概要子项");
  assert.match(summary.html, /结论/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    summary.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    summary.json,
  );
  await page.getByRole("button", { name: "概要：结论" }).click();
  await page.getByRole("button", { name: "概要：结论" }).press("Delete");
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0].summary,
    ),
    undefined,
  );
  const beforeGroupSummary = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  const groupNodes = page.getByRole("button", { name: "节点：新建节点" });
  await groupNodes.first().click();
  await groupNodes.nth(2).click({ modifiers: ["Shift"] });
  assert.deepEqual(await groupNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-pressed"))), [
    "true",
    "true",
    "true",
  ]);
  await page.getByRole("button", { name: "文字样式" }).click();
  await page.getByRole("button", { name: "粗体" }).click();
  assert.ok(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("mindmapTest")
        .editor.getJSON()
        .content?.[0]?.attrs?.tree.children.every((item: { style?: { bold?: boolean } }) => item.style?.bold === true),
    ),
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeGroupSummary,
  );
  await page.getByRole("button", { name: "文字样式" }).press("Escape");
  await groupNodes.first().click();
  await groupNodes.nth(2).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "添加标记" }).click();
  await page.getByRole("button", { name: "优先级 1" }).click();
  assert.ok(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("mindmapTest")
        .editor.getJSON()
        .content?.[0]?.attrs?.tree.children.every(
          (item: { markers?: { priority?: number } }) => item.markers?.priority === 0,
        ),
    ),
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeGroupSummary,
  );
  await page.getByRole("button", { name: "添加标记" }).press("Escape");
  await groupNodes.first().click();
  await groupNodes.nth(2).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "向下树形子树" }).click();
  assert.ok(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("mindmapTest")
        .editor.getJSON()
        .content?.[0]?.attrs?.tree.children.every(
          (item: { subtreeLayout?: string }) => item.subtreeLayout === "tree-down",
        ),
    ),
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeGroupSummary,
  );
  await groupNodes.first().click();
  await groupNodes.nth(2).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "分支样式" }).click();
  await page.getByLabel("分支粗细").fill("4");
  await page.getByLabel("分支粗细").press("Tab");
  assert.ok(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("mindmapTest")
        .editor.getJSON()
        .content?.[0]?.attrs?.tree.children.every((item: { branch?: { width?: number } }) => item.branch?.width === 4),
    ),
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeGroupSummary,
  );
  await page.getByRole("button", { name: "分支样式" }).press("Escape");
  await groupNodes.first().click();
  await groupNodes.nth(2).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "为选中节点添加概要" }).click();
  await page.getByRole("button", { name: "概要：概要" }).dblclick();
  await page.getByLabel("编辑节点").fill("分组结论");
  await page.getByLabel("编辑节点").press("Enter");
  const groupedSummary = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(groupedSummary.json.content?.[0]?.attrs?.tree.children[0].summarySpan, 3);
  assert.equal(groupedSummary.json.content?.[0]?.attrs?.tree.children[0].summary.text, "分组结论");
  assert.match(groupedSummary.html, /分组结论/);
  for (const direction of ["down", "up"] as const) {
    const input = structuredClone(beforeGroupSummary);
    input.content![0].attrs!.layout = direction;
    if (direction === "down") {
      input.content![0].attrs!.tree.children[0].subtreeLayout = "tree-down";
      input.content![0].attrs!.tree.children[0].children.push({ text: "竖向混合子项", children: [] });
    }
    await page.evaluate(
      (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
      input,
    );
    const beforePositions = await groupNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().left).sort((a, b) => a - b),
    );
    await groupNodes.first().click();
    await groupNodes.nth(2).click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "为选中节点添加概要" }).click();
    await page.waitForFunction((mode) => {
      const nodes = [...document.querySelectorAll('[aria-label="节点：新建节点"]')];
      const summary = document.querySelector('[aria-label="概要：概要"]');
      if (nodes.length !== 3 || !summary) return false;
      const child = document.querySelector('[aria-label="节点：竖向混合子项"]');
      const bounds = [...nodes, ...(child ? [child] : [])].map((node) => node.getBoundingClientRect());
      const label = summary.getBoundingClientRect();
      return mode === "down"
        ? label.top > Math.max(...bounds.map((box) => box.bottom))
        : label.bottom < Math.min(...bounds.map((box) => box.top));
    }, direction);
    const afterPositions = await groupNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().left).sort((a, b) => a - b),
    );
    for (let index = 1; index < beforePositions.length; index++)
      assert.ok(
        Math.abs(
          afterPositions[index] - afterPositions[index - 1] - (beforePositions[index] - beforePositions[index - 1]),
        ) < 1,
        `${direction}: before ${beforePositions}, after ${afterPositions}`,
      );
    const vertical = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    assert.equal(vertical.json.content?.[0]?.attrs?.tree.children[0].summarySpan, 3);
    const svg = await page.evaluate((html) => {
      const svg = new DOMParser().parseFromString(html, "text/html").querySelector("svg")!;
      const labels = [...svg.querySelectorAll("text")];
      const summary = labels.find((text) => text.textContent === "概要");
      const nodes = labels.filter((text) => ["新建节点", "竖向混合子项"].includes(text.textContent ?? ""));
      const bracket = [...svg.querySelectorAll('path[stroke="#b6b9b9"]')].map((path) => path.getAttribute("d"));
      const [, y, , height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      return {
        summaryY: Number(summary?.getAttribute("y")),
        nodeY: nodes.map((node) => Number(node.getAttribute("y"))),
        summaryVisible:
          !!summary && Number(summary.getAttribute("y")) >= y && Number(summary.getAttribute("y")) <= y + height,
        bracket,
      };
    }, vertical.html);
    assert.equal(svg.nodeY.length, direction === "down" ? 4 : 3);
    assert.ok(direction === "down" ? svg.summaryY > Math.max(...svg.nodeY) : svg.summaryY < Math.min(...svg.nodeY));
    assert.equal(svg.summaryVisible, true);
    assert.ok(svg.bracket.some((path) => path?.includes(" H ")));
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), input);
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      vertical.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      vertical.json,
    );
  }
  for (const direction of ["tree-down-right", "tree-down-left", "tree-up-right", "tree-up-left"] as const) {
    const input = structuredClone(beforeGroupSummary);
    input.content![0].attrs!.layout = direction;
    await page.evaluate(
      (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
      input,
    );
    const beforePositions = await groupNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top).sort((a, b) => a - b),
    );
    await groupNodes.first().click();
    await groupNodes.nth(2).click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "为选中节点添加概要" }).click();
    await page.waitForFunction((mode) => {
      const nodes = [...document.querySelectorAll('[aria-label="节点：新建节点"]')];
      const summary = document.querySelector('[aria-label="概要：概要"]');
      if (nodes.length !== 3 || !summary) return false;
      const bounds = nodes.map((node) => node.getBoundingClientRect());
      const label = summary.getBoundingClientRect();
      return mode.endsWith("right")
        ? label.left > Math.max(...bounds.map((box) => box.right))
        : label.right < Math.min(...bounds.map((box) => box.left));
    }, direction);
    const afterPositions = await groupNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top).sort((a, b) => a - b),
    );
    for (let index = 1; index < beforePositions.length; index++)
      assert.ok(
        Math.abs(
          afterPositions[index] - afterPositions[index - 1] - (beforePositions[index] - beforePositions[index - 1]),
        ) < 1,
        `${direction}: before ${beforePositions}, after ${afterPositions}`,
      );
    const grouped = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    assert.equal(grouped.json.content?.[0]?.attrs?.tree.children[0].summarySpan, 3);
    const exported = await page.evaluate((html) => {
      const svg = new DOMParser().parseFromString(html, "text/html").querySelector("svg")!;
      const labels = [...svg.querySelectorAll("text")];
      return {
        summaryX: Number(labels.find((text) => text.textContent === "概要")?.getAttribute("x")),
        nodeX: labels.filter((text) => text.textContent === "新建节点").map((node) => Number(node.getAttribute("x"))),
        bracket: [...svg.querySelectorAll('path[stroke="#b6b9b9"]')].map((path) => path.getAttribute("d")),
      };
    }, grouped.html);
    assert.equal(exported.nodeX.length, 3);
    assert.ok(
      direction.endsWith("right")
        ? exported.summaryX > Math.max(...exported.nodeX)
        : exported.summaryX < Math.min(...exported.nodeX),
    );
    assert.ok(exported.bracket.some((path) => path?.includes(" V ")));
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), input);
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      grouped.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      grouped.json,
    );
  }
  for (const direction of ["timeline-right", "timeline-left"] as const) {
    const input = structuredClone(beforeGroupSummary);
    input.content![0].attrs!.layout = direction;
    await page.evaluate(
      (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
      input,
    );
    const beforePositions = await groupNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().left).sort((a, b) => a - b),
    );
    await groupNodes.first().click();
    await groupNodes.nth(2).click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "为选中节点添加概要" }).click();
    await page.waitForFunction(() => {
      const nodes = [...document.querySelectorAll('[aria-label="节点：新建节点"]')];
      const summary = document.querySelector('[aria-label="概要：概要"]');
      if (nodes.length !== 3 || !summary) return false;
      return (
        summary.getBoundingClientRect().bottom < Math.min(...nodes.map((node) => node.getBoundingClientRect().top))
      );
    });
    const afterPositions = await groupNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().left).sort((a, b) => a - b),
    );
    for (let index = 1; index < beforePositions.length; index++)
      assert.ok(
        Math.abs(
          afterPositions[index] - afterPositions[index - 1] - (beforePositions[index] - beforePositions[index - 1]),
        ) < 1,
      );
    const grouped = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    const exported = await page.evaluate((html) => {
      const svg = new DOMParser().parseFromString(html, "text/html").querySelector("svg")!;
      const labels = [...svg.querySelectorAll("text")];
      return {
        summaryY: Number(labels.find((text) => text.textContent === "概要")?.getAttribute("y")),
        nodeY: labels.filter((text) => text.textContent === "新建节点").map((node) => Number(node.getAttribute("y"))),
        bracket: [...svg.querySelectorAll('path[stroke="#b6b9b9"]')].map((path) => path.getAttribute("d")),
      };
    }, grouped.html);
    assert.equal(exported.nodeY.length, 3);
    assert.ok(exported.summaryY < Math.min(...exported.nodeY));
    assert.ok(exported.bracket.some((path) => path?.includes(" H ")));
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), input);
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      grouped.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      grouped.json,
    );
  }
  const balancedInput = structuredClone(beforeGroupSummary);
  balancedInput.content![0].attrs!.layout = "balanced";
  balancedInput.content![0].attrs!.tree.children.push({ text: "分支丁", children: [] });
  for (const [index, text] of ["分支甲", "分支乙", "分支丙"].entries())
    balancedInput.content![0].attrs!.tree.children[index].text = text;
  const balancedNode = (name: string) => page.getByRole("button", { name: `节点：${name}` });
  for (const [first, last, side, index] of [
    ["分支甲", "分支乙", "right", 0],
    ["分支丙", "分支丁", "left", 2],
  ] as const) {
    await page.evaluate(
      (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
      balancedInput,
    );
    await balancedNode(first).click();
    await balancedNode(last).click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "为选中节点添加概要" }).click();
    await page.waitForFunction(
      ({ first, last, side }) => {
        const nodes = [first, last].map((name) => document.querySelector(`[aria-label="节点：${name}"]`));
        const summary = document.querySelector('[aria-label="概要：概要"]');
        if (nodes.some((node) => !node) || !summary) return false;
        const bounds = nodes.map((node) => node!.getBoundingClientRect());
        const label = summary.getBoundingClientRect();
        return side === "right"
          ? label.left > Math.max(...bounds.map((box) => box.right))
          : label.right < Math.min(...bounds.map((box) => box.left));
      },
      { first, last, side },
    );
    const grouped = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    assert.equal(grouped.json.content?.[0]?.attrs?.tree.children[index].summarySpan, 2);
    const exported = await page.evaluate(
      ({ html, first, last }) => {
        const svg = new DOMParser().parseFromString(html, "text/html").querySelector("svg")!;
        const labels = [...svg.querySelectorAll("text")];
        const names = new Set<string>([first, last]);
        return {
          summaryX: Number(labels.find((text) => text.textContent === "概要")?.getAttribute("x")),
          nodeX: labels
            .filter((text) => names.has(text.textContent ?? ""))
            .map((node) => Number(node.getAttribute("x"))),
          bracket: [...svg.querySelectorAll('path[stroke="#b6b9b9"]')].map((path) => path.getAttribute("d")),
        };
      },
      { html: grouped.html, first, last },
    );
    assert.equal(exported.nodeX.length, 2);
    assert.ok(
      side === "right"
        ? exported.summaryX > Math.max(...exported.nodeX)
        : exported.summaryX < Math.min(...exported.nodeX),
    );
    assert.ok(exported.bracket.some((path) => path?.includes(" V ")));
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      balancedInput,
    );
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      grouped.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      grouped.json,
    );
  }
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    balancedInput,
  );
  await balancedNode("分支乙").click();
  await balancedNode("分支丙").click({ modifiers: ["Shift"] });
  assert.equal(await page.getByRole("button", { name: "为选中节点添加概要" }).isEnabled(), false);
  await balancedNode("分支甲").click();
  await balancedNode("分支乙").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "为选中节点添加概要" }).click();
  await balancedNode("分支丁").click();
  await balancedNode("分支丁").press("Delete");
  await balancedNode("分支丙").click();
  await balancedNode("分支丙").press("Delete");
  await page.waitForFunction(() => {
    const root = document.querySelector('[aria-label="中心节点：思维导图"]')?.getBoundingClientRect();
    const nodes = ["分支甲", "分支乙"].map((name) => document.querySelector(`[aria-label="节点：${name}"]`));
    const summary = document.querySelector('[aria-label="概要：概要"]')?.getBoundingClientRect();
    return !!root && !!summary && nodes.every((node) => !!node && node.getBoundingClientRect().left > root.right);
  });
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    groupedSummary.json,
  );
  assert.equal(await groupNodes.first().locator("..").getByRole("button", { name: "折叠分支" }).count(), 0);
  const groupedWithChild = structuredClone(groupedSummary.json);
  groupedWithChild.content![0].attrs!.tree.children[0].children.push({ text: "被折叠子项", children: [] });
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    groupedWithChild,
  );
  await groupNodes.first().locator("..").getByRole("button", { name: "折叠分支" }).click();
  assert.equal(await page.getByRole("button", { name: "节点：被折叠子项" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "概要：分组结论" }).count(), 1);
  assert.equal(await groupNodes.first().locator("..").getByRole("button", { name: "展开分支" }).textContent(), "1");
  assert.match(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML()), /分组结论/);
  const mixedGroup = structuredClone(groupedSummary.json);
  mixedGroup.content![0].attrs!.tree.children[0].subtreeLayout = "tree-down";
  mixedGroup.content![0].attrs!.tree.children[0].children.push({ text: "混合子项", children: [] });
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    mixedGroup,
  );
  const mixedGroupHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.ok(
    await page
      .locator('.semlo-editor-mindmap-lines path[stroke="#b6b9b9"]')
      .evaluateAll((paths) => paths.some((path) => path.getAttribute("d")?.includes(" V "))),
  );
  const mixedGroupExport = await page.evaluate((html) => {
    const svg = new DOMParser().parseFromString(html, "text/html").querySelector("svg")!;
    const bracket = [...svg.querySelectorAll('path[stroke="#b6b9b9"]')].map((path) => path.getAttribute("d"));
    const label = [...svg.querySelectorAll("text")].find((text) => text.textContent === "分组结论");
    const [x, , width] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const labelX = Number(label?.getAttribute("x"));
    return { bracket, labelVisible: !!label && labelX >= x && labelX <= x + width };
  }, mixedGroupHtml);
  assert.ok(mixedGroupExport.bracket.some((path) => path?.includes(" V ")));
  assert.equal(mixedGroupExport.labelVisible, true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    groupedSummary.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    groupedSummary.json,
  );
  await groupNodes.first().click();
  await groupNodes.first().press("Enter");
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0].summarySpan,
    ),
    4,
  );
  await page.getByLabel("编辑节点").press("Escape");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await groupNodes.first().click();
  await groupNodes.first().press("Delete");
  const afterGroupDeletion = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  assert.equal(afterGroupDeletion.content?.[0]?.attrs?.tree.children[0].summarySpan, 2);
  assert.equal(afterGroupDeletion.content?.[0]?.attrs?.tree.children[0].summary.text, "分组结论");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    groupedSummary.json,
  );
  const conflictingSummary = structuredClone(groupedSummary.json);
  conflictingSummary.content![0].attrs!.tree.children[1].summary = { text: "另一概要", children: [] };
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    conflictingSummary,
  );
  await groupNodes.first().click();
  await groupNodes.first().press("Delete");
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    conflictingSummary,
  );
  assert.match((await page.locator(".semlo-editor-mindmap-drawing-status").textContent())!, /后续节点已有概要/);
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    beforeGroupSummary,
  );
  await styledBranch.click();
  await page.getByRole("button", { name: "文字样式" }).click();
  await page.getByRole("button", { name: "粗体" }).click();
  await page.getByRole("button", { name: "斜体" }).click();
  await page.getByRole("button", { name: "下划线" }).click();
  await page.getByLabel("节点字号").selectOption("92");
  await page.getByRole("button", { name: "节点文字颜色", exact: true }).click();
  await page.getByLabel("自定义节点文字颜色").fill("#336699");
  await page.getByLabel("节点文字对齐").selectOption("right");
  const styled = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.deepEqual(styled.json.content?.[0]?.attrs?.tree.children[0].style, {
    bold: true,
    italic: true,
    underline: true,
    size: 92,
    color: "#336699",
    align: "right",
  });
  const staticStyle = await page.evaluate((html) => {
    const label = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("svg text")].find(
      (element) => element.textContent === "新建节点",
    )!;
    return ["font-weight", "font-style", "text-decoration", "font-size", "fill", "text-anchor"].map((key) =>
      label.getAttribute(key),
    );
  }, styled.html);
  assert.deepEqual(staticStyle, ["700", "italic", "underline", "92", "#336699", "end"]);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    styled.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    styled.json,
  );
  await page.getByRole("button", { name: "节点：新建节点" }).first().click();
  await page.getByRole("button", { name: "插入节点链接" }).click();
  const linkDialog = page.getByRole("dialog", { name: "节点链接" });
  await linkDialog.getByLabel("文本").fill("参考资料");
  await linkDialog.getByLabel("链接", { exact: true }).fill("example.com");
  await linkDialog.getByRole("button", { name: "确定" }).click();
  assert.equal(await page.getByRole("link", { name: "打开节点链接" }).getAttribute("href"), "https://example.com");
  const linked = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.match(linked.html, /href="https:\/\/example\.com"/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.getByRole("link", { name: "打开节点链接" }).count(), 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    linked.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    linked.json,
  );
  await page.getByRole("button", { name: "节点：参考资料" }).click();
  await page.getByRole("button", { name: "插入节点链接" }).click();
  await linkDialog.getByLabel("链接", { exact: true }).fill("javascript:alert(1)");
  await linkDialog.getByRole("button", { name: "确定" }).click();
  assert.equal(await page.getByRole("link", { name: "打开节点链接" }).getAttribute("href"), "https://example.com");
  await linkDialog.getByRole("button", { name: "移除链接" }).click();
  assert.equal(await page.getByRole("link", { name: "打开节点链接" }).count(), 0);
  await page.getByRole("button", { name: "节点：参考资料" }).dblclick();
  await page.getByLabel("编辑节点").fill("甲乙丙丁");
  await page.getByLabel("编辑节点").press("Enter");
  const addPartialLink = async (node: string, from: number, to: number, url: string) => {
    await page.getByRole("button", { name: `节点：${node}` }).dblclick();
    await page
      .getByLabel("编辑节点")
      .evaluate((input, range) => (input as HTMLInputElement).setSelectionRange(range.from, range.to), { from, to });
    await page.getByRole("button", { name: "插入节点链接" }).click();
    await linkDialog.getByLabel("链接", { exact: true }).fill(url);
    await linkDialog.getByRole("button", { name: "确定" }).click();
  };
  await addPartialLink("甲乙丙丁", 1, 2, "https://example.com/a");
  await addPartialLink("甲乙丙丁", 2, 3, "https://example.com/b");
  let partial = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0],
  );
  assert.deepEqual(partial.links, [
    { from: 1, to: 2, href: "https://example.com/a" },
    { from: 2, to: 3, href: "https://example.com/b" },
  ]);
  await page.getByRole("button", { name: "节点：甲乙丙丁" }).dblclick();
  await page.getByLabel("编辑节点").press("Home");
  await page.keyboard.insertText("新");
  await page.getByLabel("编辑节点").press("End");
  await page.keyboard.insertText("末");
  await page.getByLabel("编辑节点").press("Enter");
  partial = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0],
  );
  assert.deepEqual(partial.links, [
    { from: 2, to: 3, href: "https://example.com/a" },
    { from: 3, to: 4, href: "https://example.com/b" },
  ]);
  const partialHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.match(partialHtml, /href="https:\/\/example\.com\/a"/);
  assert.match(partialHtml, /href="https:\/\/example\.com\/b"/);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    partialHtml,
  );
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(false));
  assert.equal(await page.getByRole("link", { name: "乙", exact: true }).getAttribute("href"), "https://example.com/a");
  assert.equal(await page.getByRole("link", { name: "丙", exact: true }).getAttribute("href"), "https://example.com/b");
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(true));
  await page.getByRole("button", { name: "节点：新甲乙丙丁末" }).dblclick();
  await page.getByLabel("编辑节点").evaluate((input) => (input as HTMLInputElement).setSelectionRange(2, 3));
  await page.getByRole("button", { name: "插入节点链接" }).click();
  await linkDialog.getByRole("button", { name: "移除链接" }).click();
  partial = await page.evaluate(
    () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0],
  );
  assert.deepEqual(partial.links, [{ from: 3, to: 4, href: "https://example.com/b" }]);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent({ type: "doc", content: [{ type: "semloEditorMindmap" }] }),
  );
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
  await page.getByRole("button", { name: "中心节点：先前模板" }).click();
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "向左结构" }).click();
  const positions = async () =>
    page.locator(".semlo-editor-mindmap-label").evaluateAll((labels) => {
      const center = labels.find((label) => label.getAttribute("aria-label")?.startsWith("中心节点："))!;
      const centerX = center.getBoundingClientRect().x;
      return labels.filter((label) => label !== center).map((label) => label.getBoundingClientRect().x - centerX);
    });
  assert.ok((await positions()).every((x) => x < 0));
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.ok((await positions()).every((x) => x > 0));
  await page.getByRole("button", { name: "中心节点：先前模板" }).click();
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "双侧结构" }).click();
  assert.equal((await positions()).filter((x) => x < 0).length, 1);
  assert.equal((await positions()).filter((x) => x > 0).length, 2);
  const balanced = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(balanced.json.content?.[0]?.attrs?.layout, "balanced");
  const staticPositions = await page.evaluate((html) => {
    const labels = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("svg text")];
    const center = labels.find((label) => label.textContent === "先前模板")!;
    const centerX = Number(center.getAttribute("x"));
    return labels.filter((label) => label !== center).map((label) => Number(label.getAttribute("x")) - centerX);
  }, balanced.html);
  assert.equal(staticPositions.filter((x) => x < 0).length, 1);
  assert.equal(staticPositions.filter((x) => x > 0).length, 2);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    balanced.html,
  );
  assert.equal(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.layout),
    "balanced",
  );
  assert.equal((await positions()).filter((x) => x < 0).length, 1);
  const mixedInput = structuredClone(balanced.json);
  const mixedTree = mixedInput.content![0].attrs!.tree;
  mixedTree.children[0].text = "分支甲";
  mixedTree.children[1].text = "分支乙";
  mixedTree.children[2].text = "分支丙";
  mixedTree.children[0].children = [
    { text: "子项甲", children: [] },
    { text: "子项乙", children: [] },
  ];
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    mixedInput,
  );
  const mixedParent = page.getByRole("button", { name: "节点：分支甲" });
  const mixedChild = page.getByRole("button", { name: "节点：子项甲" });
  const chooseSubtree = async (name: string) => {
    await mixedParent.click();
    await page.getByRole("button", { name: "结构", exact: true }).click();
    await page.getByRole("button", { name }).click();
  };
  await chooseSubtree("向下树形子树");
  const parentDown = await mixedParent.boundingBox();
  const childDown = await mixedChild.boundingBox();
  if (!parentDown || !childDown) throw new Error("missing mixed subtree");
  assert.ok(childDown.y > parentDown.y && childDown.x > parentDown.x);
  const mixed = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(mixed.json.content?.[0]?.attrs?.layout, "balanced");
  assert.equal(mixed.json.content?.[0]?.attrs?.tree.children[0].subtreeLayout, "tree-down");
  const staticMixed = await page.evaluate((html) => {
    const labels = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("svg text")];
    return Object.fromEntries(
      ["先前模板", "分支甲", "分支丙", "子项甲"].map((text) => {
        const label = labels.find((entry) => entry.textContent === text)!;
        return [text, { x: Number(label.getAttribute("x")), y: Number(label.getAttribute("y")) }];
      }),
    );
  }, mixed.html);
  assert.ok(staticMixed["子项甲"].y > staticMixed["分支甲"].y);
  assert.ok(staticMixed["分支丙"].x < staticMixed["先前模板"].x);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    mixed.html,
  );
  assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), mixed.json);
  await chooseSubtree("向上树形子树");
  const parentUp = await mixedParent.boundingBox();
  const childUp = await mixedChild.boundingBox();
  if (!parentUp || !childUp) throw new Error("missing upward subtree");
  assert.ok(childUp.y < parentUp.y);
  await chooseSubtree("时间轴子树");
  const parentTimeline = await mixedParent.boundingBox();
  const childTimeline = await mixedChild.boundingBox();
  if (!parentTimeline || !childTimeline) throw new Error("missing timeline subtree");
  assert.ok(childTimeline.x > parentTimeline.x);
  await chooseSubtree("分支结构");
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    balanced.html,
  );
  const verticalPositions = async () =>
    page.locator(".semlo-editor-mindmap-label").evaluateAll((labels) => {
      const center = labels.find((label) => label.getAttribute("aria-label")?.startsWith("中心节点："))!;
      const centerY = center.getBoundingClientRect().y;
      return labels.filter((label) => label !== center).map((label) => label.getBoundingClientRect().y - centerY);
    });
  await page.getByRole("button", { name: "中心节点：先前模板" }).click();
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "向下结构" }).click();
  assert.ok((await verticalPositions()).every((y) => y > 0));
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal((await positions()).filter((x) => x < 0).length, 1);
  await page.getByRole("button", { name: "中心节点：先前模板" }).click();
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "向上结构" }).click();
  assert.ok((await verticalPositions()).every((y) => y < 0));
  await page.getByRole("button", { name: "节点：新建节点" }).first().click();
  await page.getByLabel("添加下级节点").click();
  await page.getByLabel("编辑节点").fill("竖向子节点");
  await page.getByLabel("编辑节点").press("Enter");
  const vertical = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const staticVertical = await page.evaluate((html) => {
    const labels = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("svg text")];
    const center = labels.find((label) => label.textContent === "先前模板")!;
    return labels
      .filter((label) => label !== center)
      .map((label) => Number(label.getAttribute("y")) - Number(center.getAttribute("y")));
  }, vertical.html);
  assert.ok(staticVertical.every((y) => y < 0));
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    vertical.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    vertical.json,
  );
  assert.equal(await page.getByRole("button", { name: "节点：竖向子节点" }).count(), 1);
  for (const [name, xDirection, yDirection] of [
    ["向右树形结构", 1, 1],
    ["向左树形结构", -1, 1],
    ["向上右树形结构", 1, -1],
    ["向上左树形结构", -1, -1],
  ] as const) {
    await page.getByRole("button", { name: "中心节点：先前模板" }).click();
    await page.getByRole("button", { name: "结构", exact: true }).click();
    await page.getByRole("button", { name }).click();
    assert.ok((await positions()).every((x) => x * xDirection > 0));
    assert.ok((await verticalPositions()).every((y) => y * yDirection > 0));
  }
  const treeLayout = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(treeLayout.json.content?.[0]?.attrs?.layout, "tree-up-left");
  assert.match(treeLayout.html, /竖向子节点/);
  assert.match(treeLayout.html, /<svg/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    treeLayout.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    treeLayout.json,
  );
  for (const [name, xDirection] of [
    ["向右时间轴结构", 1],
    ["向左时间轴结构", -1],
  ] as const) {
    await page.getByRole("button", { name: "中心节点：先前模板" }).click();
    await page.getByRole("button", { name: "结构", exact: true }).click();
    await page.getByRole("button", { name }).click();
    assert.ok((await positions()).every((x) => x * xDirection > 0));
    const baselineOffsets = await page.locator(".semlo-editor-mindmap-label").evaluateAll((labels) => {
      const root = labels
        .find((label) => label.getAttribute("aria-label")?.startsWith("中心节点："))!
        .getBoundingClientRect();
      return labels
        .filter((label) => !label.getAttribute("aria-label")?.startsWith("中心节点："))
        .map((label) => label.getBoundingClientRect().bottom - (root.top + root.height / 2));
    });
    assert.ok(baselineOffsets.every((offset) => Math.abs(offset) < 3));
  }
  const timeline = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.equal(timeline.json.content?.[0]?.attrs?.layout, "timeline-left");
  assert.match(timeline.html, /竖向子节点/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    timeline.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    timeline.json,
  );
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
  const invalidSpan = {
    text: "中心",
    children: [{ text: "节点", children: [], summary: { text: "概要", children: [] }, summarySpan: 3 }],
  };
  await page.evaluate(
    (tree) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorMindmap", attrs: { tree } }],
      }),
    invalidSpan,
  );
  assert.equal(await page.getByRole("status").textContent(), "思维导图数据格式不受支持，暂无法编辑。");
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree),
    invalidSpan,
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
  await page.getByRole("button", { name: "节点：另一节点" }).click();
  await page.getByRole("button", { name: "文字样式" }).click();
  await page.getByRole("button", { name: "节点文字颜色", exact: true }).click();
  const staleColor = await page.getByLabel("自定义节点文字颜色").elementHandle();
  assert.ok(staleColor);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    editor.commands.setContent(editor.getJSON());
  });
  await page.getByRole("button", { name: "节点：另一节点" }).click();
  await staleColor.evaluate((input) => {
    (input as HTMLInputElement).value = "#112233";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(
      () => window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs?.tree.children[0].style,
    ),
    undefined,
  );
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
