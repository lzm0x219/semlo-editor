// Run after building tests/config/mindmap-rsbuild.config.ts into MINDMAP_TEST_DIR.
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize } from "node:path";

import { chromium } from "playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime.ts";

declare global {
  interface Window {
    testCanvasClipboard?: DataTransfer;
    canvasReleasePending?: () => Promise<void>;
    canvasHeightPointerId?: number;
    canvasShapePointerId?: number;
    canvasResizePointerId?: number;
    canvasRotatePointerId?: number;
    canvasGroupPointerId?: number;
    canvasDrawPointerId?: number;
    canvasNavigationPointerId?: number;
  }
}

function requireCanvasAttrs(snapshot: import("@tiptap/core").JSONContent) {
  const attrs = snapshot.content?.[0]?.attrs;
  assert.ok(attrs, "Canvas document attributes are missing");
  return attrs;
}

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installFixtureGuards(page);
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const chooseShape = async (shape: string) => {
    await page.getByRole("button", { name: "更多形状", exact: true }).click();
    await page.getByRole("dialog", { name: "图形库" }).locator(`[data-shape-tool="${shape}"]`).first().click();
  };
  const setKind = (kind: string) =>
    page.evaluate(
      (value) =>
        window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
          type: "doc",
          content: [{ type: "semloEditorCanvas", attrs: { kind: value } }],
        }),
      kind,
    );
  await page.waitForSelector(".semlo-editor-mindmap");
  const wrapping = await page.evaluate(async () => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const samples = [
      { shape: "rectangle", text: "这是用于测试画布长文本自动换行的内容，确保能够在形状内分成多行。" },
      { shape: "rectangle", text: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { shape: "rectangle", text: "<节点 & 内容> 测试自动换行和 HTML 转义，保留符号与文字。" },
      { shape: "diamond", text: "这是用于测试画布长文本自动换行的内容，确保能够在形状内分成多行。" },
      { shape: "text", text: "一行\n二行\n中文混合内容继续自动折行" },
      { shape: "text", strokeWidth: 10, text: "这是用于测试画布长文本自动换行的内容，确保能够在形状内分成多行。" },
      { shape: "rectangle", text: "超长文本".repeat(80), y: 400, verticalAlign: "top" },
      { shape: "rectangle", text: "超长文本".repeat(80), y: 400, verticalAlign: "bottom", rotation: 30 },
    ];
    const results = [];
    for (const sample of samples) {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "semloEditorCanvas",
            attrs: {
              kind: "board",
              data: {
                shapes: [{ id: "shape", x: 100, y: 100, width: 140, height: 110, fontSize: 16, ...sample }],
                edges: [],
              },
            },
          },
        ],
      });
      const original = editor.getJSON();
      const live = document.querySelector(".semlo-editor-canvas-shape > span")!;
      const range = document.createRange();
      range.selectNodeContents(live);
      const liveLines = range.getClientRects().length;
      const html = editor.getHTML();
      const host = document.createElement("div");
      host.style.width = "800px";
      host.innerHTML = html;
      document.body.append(host);
      const svg = host.querySelector("svg")!;
      const text = svg.querySelector("foreignObject div div")!;
      const details = {
        liveFont: getComputedStyle(live).font,
        staticFont: getComputedStyle(text).font,
        liveWidth: live.getBoundingClientRect().width,
        staticWidth: text.getBoundingClientRect().width,
        text: sample.text,
        shape: sample.shape,
      };
      range.selectNodeContents(text);
      const staticLines = range.getClientRects().length;
      const textBox = text.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      const contained =
        textBox.left >= svgBox.left - 1 &&
        textBox.right <= svgBox.right + 1 &&
        textBox.top >= svgBox.top - 1 &&
        textBox.bottom <= svgBox.bottom + 1;
      const serialized = new XMLSerializer().serializeToString(svg);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      await image.decode();
      const fallbackNode = svg.querySelector("switch > text")!;
      const fallback = fallbackNode.textContent;
      const fallbackHost = document.createElement("div");
      fallbackHost.style.width = "800px";
      fallbackHost.innerHTML = svg.outerHTML.replace('http://www.w3.org/1999/xhtml"', 'https://unsupported.invalid"');
      document.body.append(fallbackHost);
      const fallbackVisible = fallbackHost.querySelector("switch > text")!.getBoundingClientRect().width > 0;
      fallbackHost.remove();
      const exportedText = text.textContent;
      host.remove();
      editor.commands.setContent(html);
      const roundTrip = editor.getJSON();
      results.push({
        liveLines,
        staticLines,
        details,
        contained,
        fallbackVisible,
        textInsetWidth:
          sample.shape === "text" && sample.strokeWidth === 10
            ? svg.querySelector("foreignObject")!.getAttribute("width")
            : null,
        fallback,
        exportedText,
        sameData:
          JSON.stringify(original.content?.[0]?.attrs?.data) === JSON.stringify(roundTrip.content?.[0]?.attrs?.data),
        text: sample.text,
      });
    }
    return results;
  });
  for (const result of wrapping) {
    assert.ok(result.liveLines > 1);
    assert.equal(result.staticLines, result.liveLines, JSON.stringify(result.details));
    assert.equal(result.contained, true);
    assert.equal(result.fallbackVisible, true);
    if (result.textInsetWidth !== null) assert.equal(result.textInsetWidth, "124");
    assert.equal(result.exportedText, result.text);
    assert.equal(result.fallback, result.text.replaceAll("\n", ""));
    assert.equal(result.sameData, true);
  }
  await setKind("flowchart");
  const captureHeightHandle = page.getByRole("separator", { name: "调整画布高度" });
  const captureInitialHeight = await captureHeightHandle.getAttribute("aria-valuenow");
  const originalCanvasData = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  await captureHeightHandle.evaluate((handle) => {
    handle.addEventListener(
      "pointerdown",
      (event) => {
        window.canvasHeightPointerId = (event as PointerEvent).pointerId;
      },
      { once: true },
    );
  });
  const captureHeightPosition = await captureHeightHandle.boundingBox();
  assert.ok(captureHeightPosition);
  const captureHeightX = captureHeightPosition.x + captureHeightPosition.width / 2;
  const captureHeightY = captureHeightPosition.y + captureHeightPosition.height / 2;
  await page.mouse.move(captureHeightX, captureHeightY);
  await page.mouse.down();
  await page.mouse.move(captureHeightX, captureHeightY + 30);
  assert.equal(await captureHeightHandle.getAttribute("aria-valuenow"), String(Number(captureInitialHeight) + 30));
  await captureHeightHandle.evaluate((handle) => handle.releasePointerCapture(window.canvasHeightPointerId!));
  await page.mouse.move(captureHeightX + 1, captureHeightY + 30);
  await page.waitForFunction(
    (height) => document.querySelector(".semlo-editor-canvas-height-handle")?.getAttribute("aria-valuenow") === height,
    captureInitialHeight,
  );
  await page.mouse.up();
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    originalCanvasData,
  );
  await captureHeightHandle.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await captureHeightHandle.getAttribute("aria-valuenow"), String(Number(captureInitialHeight) + 20));
  assert.equal(await captureHeightHandle.evaluate((handle) => document.activeElement === handle), true);
  await captureHeightHandle.evaluate((handle) => handle.blur());
  await setKind("flowchart");
  const inactiveWheelPrevented = await page.locator(".semlo-editor-canvas-viewport").evaluate((viewport) => {
    const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    viewport.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(inactiveWheelPrevented, false);
  const initialFlowFits = await page.locator(".semlo-editor-canvas-shape").evaluateAll((elements) => {
    const viewport = document.querySelector(".semlo-editor-canvas-viewport")!.getBoundingClientRect();
    return elements.every((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.left >= viewport.left &&
        box.right <= viewport.right &&
        box.top >= viewport.top &&
        box.bottom <= viewport.bottom
      );
    });
  });
  assert.equal(initialFlowFits, true);
  const captureShape = page.getByRole("button", { name: "图形：开始" });
  await captureShape.click();
  const captureShapeBefore = await captureShape.boundingBox();
  assert.ok(captureShapeBefore);
  const captureShapeData = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  await captureShape.evaluate((shape) => {
    shape.addEventListener(
      "pointerdown",
      (event) => {
        window.canvasShapePointerId = (event as PointerEvent).pointerId;
      },
      { once: true },
    );
  });
  await page.mouse.move(
    captureShapeBefore.x + captureShapeBefore.width / 2,
    captureShapeBefore.y + captureShapeBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    captureShapeBefore.x + captureShapeBefore.width / 2 + 60,
    captureShapeBefore.y + captureShapeBefore.height / 2 + 20,
  );
  const captureShapePreview = await captureShape.boundingBox();
  assert.ok(captureShapePreview);
  assert.ok(Math.abs(captureShapePreview.x - captureShapeBefore.x - 60) < 1);
  await captureShape.evaluate((shape) => shape.releasePointerCapture(window.canvasShapePointerId!));
  await page.mouse.move(1, 1);
  await page.mouse.up();
  const captureShapeAfter = await captureShape.boundingBox();
  assert.ok(captureShapeAfter);
  assert.ok(Math.abs(captureShapeAfter.x - captureShapeBefore.x) < 1);
  assert.ok(Math.abs(captureShapeAfter.y - captureShapeBefore.y) < 1);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    captureShapeData,
  );
  const captureResizeHandle = captureShape.locator('.semlo-editor-canvas-resize[data-corner="se"]');
  const captureResizePosition = await captureResizeHandle.boundingBox();
  assert.ok(captureResizePosition);
  await captureResizeHandle.evaluate((handle) => {
    handle.addEventListener(
      "pointerdown",
      (event) => {
        window.canvasResizePointerId = (event as PointerEvent).pointerId;
      },
      { once: true },
    );
  });
  await page.mouse.move(
    captureResizePosition.x + captureResizePosition.width / 2,
    captureResizePosition.y + captureResizePosition.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    captureResizePosition.x + captureResizePosition.width / 2 + 40,
    captureResizePosition.y + captureResizePosition.height / 2 + 25,
  );
  const captureResizePreview = await captureShape.boundingBox();
  assert.ok(captureResizePreview);
  assert.ok(Math.abs(captureResizePreview.width - captureShapeBefore.width - 40) < 1);
  await captureResizeHandle.evaluate((handle) => handle.releasePointerCapture(window.canvasResizePointerId!));
  await page.mouse.move(1, 1);
  await page.mouse.up();
  const captureResizeAfter = await captureShape.boundingBox();
  assert.ok(captureResizeAfter);
  assert.ok(Math.abs(captureResizeAfter.width - captureShapeBefore.width) < 1);
  assert.ok(Math.abs(captureResizeAfter.height - captureShapeBefore.height) < 1);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    captureShapeData,
  );
  const captureRotateHandle = captureShape.locator(".semlo-editor-canvas-rotate");
  const captureRotatePosition = await captureRotateHandle.boundingBox();
  assert.ok(captureRotatePosition);
  const captureRotateBefore = await captureShape.evaluate((shape) => (shape as HTMLElement).style.transform);
  await captureRotateHandle.evaluate((handle) => {
    handle.addEventListener(
      "pointerdown",
      (event) => {
        window.canvasRotatePointerId = (event as PointerEvent).pointerId;
      },
      { once: true },
    );
  });
  await page.mouse.move(
    captureRotatePosition.x + captureRotatePosition.width / 2,
    captureRotatePosition.y + captureRotatePosition.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    captureRotatePosition.x + captureRotatePosition.width / 2 + 100,
    captureRotatePosition.y + captureRotatePosition.height / 2 + 20,
  );
  const captureRotatePreview = await captureShape.evaluate((shape) => (shape as HTMLElement).style.transform);
  assert.notEqual(captureRotatePreview, captureRotateBefore);
  await captureRotateHandle.evaluate((handle) => handle.releasePointerCapture(window.canvasRotatePointerId!));
  await page.mouse.move(1, 1);
  await page.mouse.up();
  assert.equal(await captureShape.evaluate((shape) => (shape as HTMLElement).style.transform), captureRotateBefore);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    captureShapeData,
  );
  const beforePan = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  const panShape = page.getByRole("button", { name: "图形：开始" });
  const panBefore = await panShape.boundingBox();
  assert.ok(panBefore);
  await page.getByRole("button", { name: "平移", exact: true }).click();
  await page.mouse.move(panBefore.x + panBefore.width / 2, panBefore.y + panBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(panBefore.x + panBefore.width / 2 + 55, panBefore.y + panBefore.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const panAfter = await panShape.boundingBox();
  assert.ok(panAfter);
  assert.ok(Math.abs(panAfter.x - panBefore.x - 55) < 1);
  assert.ok(Math.abs(panAfter.y - panBefore.y - 30) < 1);
  const afterPan = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  assert.deepEqual(requireCanvasAttrs(afterPan).data, requireCanvasAttrs(beforePan).data);
  assert.ok(requireCanvasAttrs(afterPan).viewport.x > 0);
  const wheelViewport = await page.locator(".semlo-editor-canvas-viewport").boundingBox();
  assert.ok(wheelViewport);
  await page.mouse.move(wheelViewport.x + wheelViewport.width / 2, wheelViewport.y + wheelViewport.height / 2);
  await page.mouse.wheel(0, 40);
  const afterWheel = await panShape.boundingBox();
  assert.ok(afterWheel);
  assert.ok(Math.abs(afterWheel.y - panAfter.y + 40) < 1);
  await page.mouse.wheel(0, -40);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await panShape.click();
  assert.equal(await panShape.getAttribute("aria-pressed"), "true");
  const selectedShapeBox = await panShape.boundingBox();
  const selectedControlsBox = await page.locator(".semlo-editor-canvas-shape-controls").boundingBox();
  assert.ok(selectedShapeBox && selectedControlsBox);
  assert.ok(
    selectedControlsBox.y + selectedControlsBox.height <= selectedShapeBox.y ||
      selectedControlsBox.y >= selectedShapeBox.y + selectedShapeBox.height,
  );
  const copyResult = await page.evaluate(() => {
    const button = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    // Synthetic ClipboardEvent data is copied or discarded by some browsers; use the event's data explicitly.
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    button.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    button.dispatchEvent(paste);
    return { type: clipboard.types.includes("application/x-semlo-canvas+json"), text: clipboard.getData("text/plain") };
  });
  assert.equal(copyResult.type, true);
  assert.equal(copyResult.text, "开始");
  assert.equal(await page.getByRole("button", { name: "图形：开始" }).count(), 2);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.getByRole("button", { name: "图形：开始" }).count(), 1);
  const centerCoordinate = () =>
    page.evaluate(() => {
      const stage = document.querySelector(".semlo-editor-canvas-stage")!.getBoundingClientRect();
      const viewport = document.querySelector(".semlo-editor-canvas-viewport")!.getBoundingClientRect();
      return {
        x: ((viewport.left + viewport.width / 2 - stage.left) * 800) / stage.width,
        y: ((viewport.top + viewport.height / 2 - stage.top) * 440) / stage.height,
      };
    });
  const centerBeforeZoom = await centerCoordinate();
  const fontBeforeZoom = await panShape
    .locator("span")
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole("button", { name: "缩小画布" }).click();
  const centerAfterZoom = await centerCoordinate();
  const fontAfterZoom = await panShape
    .locator("span")
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(Math.abs(centerAfterZoom.x - centerBeforeZoom.x) < 0.1);
  assert.ok(Math.abs(centerAfterZoom.y - centerBeforeZoom.y) < 0.1);
  assert.ok(Math.abs(fontAfterZoom / fontBeforeZoom - 0.9) < 0.01);
  await page.getByRole("button", { name: "放大画布" }).click();
  const viewportBounds = await page.locator(".semlo-editor-canvas-viewport").boundingBox();
  assert.ok(viewportBounds);
  await chooseShape("rectangle");
  await page.mouse.click(viewportBounds.x + 10, viewportBounds.y + 80);
  const addedOutside = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.shapes.at(-1),
  );
  assert.ok(addedOutside.x < 0);
  const exportViewBox = await page.evaluate(() => {
    const html = window.__semloRequireFixture("mindmapTest").editor.getHTML();
    return new DOMParser().parseFromString(html, "text/html").querySelector("svg")?.getAttribute("viewBox");
  });
  assert.ok(Number(exportViewBox?.split(" ")[0]) < addedOutside.x);
  await page.getByRole("button", { name: "平移", exact: true }).click();
  await page.mouse.move(viewportBounds.x + 200, viewportBounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(viewportBounds.x + 220, viewportBounds.y + 200, { steps: 3 });
  await page.mouse.up();
  const viewportBeforeUndo = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).viewport,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).viewport,
    ),
    viewportBeforeUndo,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  const panHeightHandle = page.getByRole("separator", { name: "调整画布高度" });
  const beforeHeight = await panHeightHandle.getAttribute("aria-valuenow");
  await panHeightHandle.press("ArrowDown");
  assert.notEqual(await panHeightHandle.getAttribute("aria-valuenow"), beforeHeight);
  await page.mouse.move(viewportBounds.x + 200, viewportBounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(viewportBounds.x + 210, viewportBounds.y + 200, { steps: 3 });
  await page.mouse.up();
  const viewportAfterHeight = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).viewport,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await panHeightHandle.getAttribute("aria-valuenow"), beforeHeight);
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).viewport,
    ),
    viewportAfterHeight,
  );
  await page.getByRole("button", { name: "平移", exact: true }).click();
  await page.mouse.move(viewportBounds.x + 200, viewportBounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(viewportBounds.x + 145, viewportBounds.y + 170, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.getByRole("button", { name: "适应画布" }).click();
  const fitted = await page.locator(".semlo-editor-canvas-shape").evaluateAll((elements) => {
    const viewport = document.querySelector(".semlo-editor-canvas-viewport")!.getBoundingClientRect();
    return elements.every((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.left >= viewport.left - 1 &&
        box.right <= viewport.right + 1 &&
        box.top >= viewport.top - 1 &&
        box.bottom <= viewport.bottom + 1
      );
    });
  });
  assert.equal(fitted, true);
  const fittedSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  const fittedPositions = await page.locator(".semlo-editor-canvas-shape").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }),
  );
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    fittedSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    fittedSnapshot.json,
  );
  const restoredPositions = await page.locator(".semlo-editor-canvas-shape").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  assert.deepEqual(restoredPositions, fittedPositions);
  const widelySpaced = {
    shapes: [
      { id: "left", shape: "rectangle", x: -1200, y: 80, width: 100, height: 60, text: "左" },
      { id: "right", shape: "rectangle", x: 1800, y: 80, width: 100, height: 60, text: "右" },
    ],
    edges: [{ id: "link", from: "left", to: "right", text: "连接", dashed: false, arrow: true }],
    strokes: [
      {
        id: "stroke",
        points: [
          { x: 0, y: 110 },
          { x: 300, y: 150 },
        ],
        color: "#cc3355",
        width: 4,
      },
    ],
  };
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    widelySpaced,
  );
  await page.getByRole("button", { name: "适应画布" }).click();
  assert.ok(
    (await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).viewport.zoom,
    )) < 50,
  );
  assert.equal(
    await page.locator(".semlo-editor-canvas-shape").evaluateAll((elements) => {
      const viewport = document.querySelector(".semlo-editor-canvas-viewport")!.getBoundingClientRect();
      return elements.every((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= viewport.left - 1 &&
          box.right <= viewport.right + 1 &&
          box.top >= viewport.top - 1 &&
          box.bottom <= viewport.bottom + 1
        );
      });
    }),
    true,
  );
  await page.locator(".semlo-editor-canvas-stage").press("ControlOrMeta+a");
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  assert.equal(await page.locator('.semlo-editor-canvas-edge-hit[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.semlo-editor-canvas-stroke-hit[aria-pressed="true"]').count(), 1);
  await page.locator(".semlo-editor-canvas-stage").press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 0);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 0);
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const fittedViewport = await page.locator(".semlo-editor-canvas-viewport").boundingBox();
  assert.ok(fittedViewport);
  await page.mouse.move(fittedViewport.x + 5, fittedViewport.y + 5);
  await page.mouse.down();
  await page.mouse.move(fittedViewport.x + fittedViewport.width - 5, fittedViewport.y + fittedViewport.height - 5, {
    steps: 8,
  });
  await page.mouse.up();
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  assert.equal(await page.locator('.semlo-editor-canvas-edge-hit[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.semlo-editor-canvas-stroke-hit[aria-pressed="true"]').count(), 1);
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    selected.dispatchEvent(paste);
  });
  const pastedData = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(pastedData.shapes.length, 4);
  assert.equal(pastedData.edges.length, 2);
  assert.equal(pastedData.edges[1].from, pastedData.shapes[2].id);
  assert.equal(pastedData.edges[1].to, pastedData.shapes[3].id);
  assert.equal(pastedData.strokes.length, 2);
  assert.equal(pastedData.strokes[1].color, "#cc3355");
  assert.equal(pastedData.strokes[1].points[0].x, 40);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const externalPastePrevented = await page.evaluate(() => {
    const selected = document.querySelector(".semlo-editor-canvas-stage")!;
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "外部文本");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    selected.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(externalPastePrevented, true);
  assert.equal(await page.getByRole("button", { name: "图形：外部文本" }).count(), 1);
  await page.getByRole("button", { name: "图形：外部文本" }).dblclick();
  const textEditingPastePrevented = await page.getByLabel("编辑图形文字").evaluate((field) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "编辑中的内容");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    field.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(textEditingPastePrevented, false);
  const textSelectAllPrevented = await page.getByLabel("编辑图形文字").evaluate((field) => {
    const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(textSelectAllPrevented, false);
  const textWheelPrevented = await page.getByLabel("编辑图形文字").evaluate((field) => {
    const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(textWheelPrevented, false);
  await page.getByLabel("编辑图形文字").press("Escape");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                {
                  id: "rotated",
                  shape: "rectangle",
                  x: 150,
                  y: 100,
                  width: 120,
                  height: 60,
                  text: "旋转",
                  rotation: 45,
                },
                { id: "plain", shape: "rectangle", x: 400, y: 100, width: 120, height: 60, text: "普通" },
              ],
              edges: [],
            },
          },
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "图形：旋转" }).click();
  await page.getByRole("button", { name: "图形：普通" }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "左对齐", exact: true }).click();
  const alignedBoxes = await page
    .locator('.semlo-editor-canvas-shape[aria-pressed="true"]')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
  assert.ok(Math.abs(alignedBoxes[0] - alignedBoxes[1]) < 0.25);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }),
  );
  for (const [kind, count] of [
    ["board", 0],
    ["flowchart", 5],
    ["uml", 7],
  ] as const) {
    await setKind(kind);
    assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), count);
    const original = await page.evaluate(() => {
      const e = window.__semloRequireFixture("mindmapTest").editor;
      return { json: e.getJSON(), html: e.getHTML() };
    });
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      original.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      original.json,
    );
  }
  for (const [kind, count] of [
    ["board", 0],
    ["flowchart", 5],
    ["uml", 9],
  ] as const) {
    const frozen = await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").createCanvasContent(value),
      kind,
    );
    assert.equal(frozen.attrs.data.shapes.length, count);
    if (count > 0) {
      frozen.attrs.data.shapes[0].text = "先前模板";
      const fresh = await page.evaluate(
        (value) => window.__semloRequireFixture("mindmapTest").createCanvasContent(value),
        kind,
      );
      assert.notEqual(fresh.attrs.data.shapes[0].text, "先前模板");
    }
    await page.evaluate(
      (value) =>
        window.__semloRequireFixture("mindmapTest").editor.commands.setContent({ type: "doc", content: [value] }),
      frozen,
    );
    const snapshot = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      snapshot.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      snapshot.json,
    );
    if (count > 0) assert.equal(await page.getByRole("button", { name: "图形：先前模板" }).count(), 1);
    if (kind === "uml") {
      assert.equal(await page.getByRole("button", { name: "图形：<<Include>>" }).count(), 1);
      const edges = page.getByRole("button", { name: "连接线", exact: true });
      assert.equal(await edges.count(), 5);
      await edges.nth(1).press("Backspace");
      assert.equal(await edges.count(), 4);
      assert.equal(await page.getByRole("button", { name: "图形：<<Include>>" }).count(), 1);
      assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
      assert.equal(await edges.count(), 5);
    }
  }
  await setKind("board");
  const freeLineStage = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(freeLineStage);
  await page.getByRole("button", { name: "连线", exact: true }).click();
  await page.mouse.move(freeLineStage.x + 80, freeLineStage.y + 100);
  await page.mouse.down();
  await page.mouse.move(freeLineStage.x + 200, freeLineStage.y + 150, { steps: 5 });
  await page.mouse.up();
  const freeEdge = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.edges[0],
  );
  assert.equal(freeEdge.from, "");
  assert.equal(freeEdge.to, "");
  assert.ok(freeEdge.fromPoint && freeEdge.toPoint && freeEdge.arrow);
  const bend = await page.getByRole("button", { name: "调整折线拐点" }).boundingBox();
  assert.ok(bend);
  const pathBeforeBend = await page.locator(".semlo-editor-canvas-edge").getAttribute("d");
  await page.mouse.move(bend.x + bend.width / 2, bend.y + bend.height / 2);
  await page.mouse.down();
  await page.mouse.move(bend.x + bend.width / 2 + 30, bend.y + bend.height / 2, { steps: 5 });
  assert.notEqual(await page.locator(".semlo-editor-canvas-edge").getAttribute("d"), pathBeforeBend);
  await page.mouse.up();
  const bendSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const html = new DOMParser().parseFromString(editor.getHTML(), "text/html");
    return {
      offset: window.__semloRequireValue(editor.getJSON().content?.[0]?.attrs, "canvas document attributes").data
        .edges[0].bendOffset,
      saved: JSON.parse(html.querySelector("figure")!.getAttribute("data-canvas")!).edges[0].bendOffset,
      path: html.querySelector("svg path")?.getAttribute("d"),
    };
  });
  assert.ok(bendSnapshot.offset > 0);
  assert.equal(bendSnapshot.offset, bendSnapshot.saved);
  assert.equal(bendSnapshot.path, await page.locator(".semlo-editor-canvas-edge").getAttribute("d"));
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").getAttribute("d"), pathBeforeBend);
  await page.getByRole("button", { name: "线条样式", exact: true }).click();
  await page.getByLabel("连线路径").selectOption("curved");
  assert.match((await page.locator(".semlo-editor-canvas-edge").getAttribute("d")) ?? "", / C /);
  await page.getByLabel("连线路径").selectOption("straight");
  assert.doesNotMatch((await page.locator(".semlo-editor-canvas-edge").getAttribute("d")) ?? "", / C /);
  await page.getByLabel("连线颜色").fill("#cc3355");
  await page.getByLabel("连线粗细").fill("6");
  await page.getByLabel("连线粗细").press("Tab");
  await page.getByRole("button", { name: "起点", exact: true }).click();
  await page.getByRole("button", { name: "起点箭头" }).click();
  assert.equal(await page.locator("[data-edge-start-arrow-id]").count(), 1);
  await page.getByLabel("起点样式").selectOption("hollowDiamond");
  await page.getByRole("button", { name: "终点", exact: true }).click();
  await page.getByLabel("终点样式").selectOption("open");
  assert.equal(await page.locator("[data-edge-start-arrow-id]").getAttribute("fill"), "#fff");
  assert.equal(await page.locator("[data-edge-arrow-id]").getAttribute("fill"), "none");
  const lineStyle = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const line = new DOMParser().parseFromString(editor.getHTML(), "text/html").querySelector("svg path");
    return {
      edge: window.__semloRequireValue(editor.getJSON().content?.[0]?.attrs, "canvas document attributes").data
        .edges[0],
      color: line?.getAttribute("stroke"),
      width: line?.getAttribute("stroke-width"),
      markers: Array.from(new DOMParser().parseFromString(editor.getHTML(), "text/html").querySelectorAll("svg path"))
        .slice(1)
        .map((path) => path.getAttribute("fill")),
    };
  });
  assert.equal(lineStyle.edge.route, "straight");
  assert.equal(lineStyle.edge.startArrow, true);
  assert.equal(lineStyle.edge.startMarker, "hollowDiamond");
  assert.equal(lineStyle.edge.endMarker, "open");
  assert.equal(lineStyle.color, "#cc3355");
  assert.equal(lineStyle.width, "6");
  assert.deepEqual(lineStyle.markers, ["none", "#fff"]);
  for (let i = 0; i < 7; i++)
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 0);
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                {
                  id: "rotated-target",
                  shape: "rectangle",
                  x: 350,
                  y: 160,
                  width: 160,
                  height: 40,
                  text: "旋转目标",
                  rotation: 90,
                },
              ],
              edges: [
                {
                  id: "free",
                  from: "",
                  to: "",
                  fromPoint: { x: 100, y: 50 },
                  toPoint: { x: 200, y: 50 },
                  text: "",
                  dashed: false,
                  arrow: true,
                },
              ],
            },
          },
        },
      ],
    }),
  );
  const freeLineClickStage = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(freeLineClickStage);
  await page.mouse.click(
    freeLineClickStage.x + (freeLineClickStage.width * 150) / 800,
    freeLineClickStage.y + (freeLineClickStage.height * 50) / 440,
  );
  const rotatedEnd = await page.getByRole("button", { name: "连接线终点" }).boundingBox();
  const rotatedStage = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(rotatedEnd && rotatedStage);
  await page.mouse.move(rotatedEnd.x + rotatedEnd.width / 2, rotatedEnd.y + rotatedEnd.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rotatedStage.x + (rotatedStage.width * 430) / 800,
    rotatedStage.y + (rotatedStage.height * 120) / 440,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.edges[0].to,
    ),
    "rotated-target",
  );
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                { id: "diamond-target", shape: "diamond", x: 350, y: 160, width: 160, height: 100, text: "菱形目标" },
              ],
              edges: [
                {
                  id: "free",
                  from: "",
                  to: "",
                  fromPoint: { x: 100, y: 50 },
                  toPoint: { x: 200, y: 50 },
                  text: "",
                  dashed: false,
                  arrow: true,
                },
              ],
            },
          },
        },
      ],
    }),
  );
  const diamondStage = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(diamondStage);
  await page.mouse.click(
    diamondStage.x + (diamondStage.width * 150) / 800,
    diamondStage.y + (diamondStage.height * 50) / 440,
  );
  const diamondEnd = await page.getByRole("button", { name: "连接线终点" }).boundingBox();
  assert.ok(diamondEnd);
  await page.mouse.move(diamondEnd.x + diamondEnd.width / 2, diamondEnd.y + diamondEnd.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    diamondStage.x + (diamondStage.width * 355) / 800,
    diamondStage.y + (diamondStage.height * 165) / 440,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.edges[0].to,
    ),
    "",
  );
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                { id: "triangle-target", shape: "triangle", x: 350, y: 160, width: 160, height: 100, text: "三角目标" },
              ],
              edges: [
                {
                  id: "line",
                  from: "",
                  to: "triangle-target",
                  fromPoint: { x: 100, y: 210 },
                  text: "",
                  dashed: false,
                  arrow: true,
                },
              ],
            },
          },
        },
      ],
    }),
  );
  assert.match((await page.locator(".semlo-editor-canvas-edge").getAttribute("d")) ?? "", /L 390 210$/);
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [{ id: "capsule", shape: "rounded", x: 350, y: 160, width: 120, height: 60, text: "起止符" }],
              edges: [
                {
                  id: "line",
                  from: "",
                  to: "capsule",
                  fromPoint: { x: 210, y: -10 },
                  text: "",
                  dashed: false,
                  arrow: true,
                  route: "straight",
                },
              ],
            },
          },
        },
      ],
    }),
  );
  const capsulePath = (await page.locator(".semlo-editor-canvas-edge").getAttribute("d"))!.split(" ");
  assert.ok(Math.abs(Number(capsulePath.at(-2)) - 380) < 0.01);
  assert.ok(Math.abs(Number(capsulePath.at(-1)) - 160) < 0.01);
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                { id: "box", shape: "rectangle", x: 300, y: 200, width: 120, height: 60, text: "对齐对象" },
                { id: "other", shape: "rectangle", x: 520, y: 200, width: 120, height: 60, text: "其他对象" },
              ],
              edges: [
                {
                  id: "free",
                  from: "",
                  to: "",
                  fromPoint: { x: 100, y: 80 },
                  toPoint: { x: 220, y: 120 },
                  text: "",
                  dashed: false,
                  arrow: true,
                },
              ],
            },
          },
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "图形：对齐对象" }).click();
  await page
    .locator(".semlo-editor-canvas-edge-hit")
    .evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
  const freeBeforeAlign = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  await page.getByRole("button", { name: "顶端对齐", exact: true }).click();
  const freeAfterAlign = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.ok(freeAfterAlign.shapes[0].y < freeBeforeAlign.shapes[0].y);
  assert.deepEqual(freeAfterAlign.edges[0].fromPoint, freeBeforeAlign.edges[0].fromPoint);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "编组", exact: true }).click();
  const edgeGroupSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.deepEqual(requireCanvasAttrs(edgeGroupSnapshot.json).data.groups[0].edges, ["free"]);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    edgeGroupSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    edgeGroupSnapshot.json,
  );
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  await page.getByRole("button", { name: "图形：对齐对象" }).click();
  assert.equal(await page.locator('.semlo-editor-canvas-edge-hit[aria-pressed="true"]').count(), 1);
  await page.getByRole("button", { name: "图形：其他对象" }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "编组", exact: true }).click();
  const nestedEdgeGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.groups[0],
  );
  assert.deepEqual(nestedEdgeGroup.edges, ["free"]);
  assert.deepEqual(nestedEdgeGroup.children[0].edges, ["free"]);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  const nestedEdgeSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    nestedEdgeSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    nestedEdgeSnapshot.json,
  );
  await page.getByRole("button", { name: "图形：对齐对象" }).click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    selected.dispatchEvent(paste);
  });
  const nestedEdgeCopy = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(nestedEdgeCopy.groups.length, 2);
  assert.equal(nestedEdgeCopy.groups[1].edges[0], nestedEdgeCopy.edges[1].id);
  assert.equal(nestedEdgeCopy.groups[1].children[0].edges[0], nestedEdgeCopy.edges[1].id);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "图形：对齐对象" }).click();
  await page.getByRole("button", { name: "取消编组" }).click();
  const restoredInnerEdgeGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.groups[0],
  );
  assert.deepEqual(restoredInnerEdgeGroup.edges, ["free"]);
  assert.deepEqual(restoredInnerEdgeGroup.members, ["box"]);
  await page.getByRole("button", { name: "图形：对齐对象" }).click();
  await page.getByRole("button", { name: "图形：对齐对象" }).press("Shift+ArrowRight");
  const movedEdgeGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(movedEdgeGroup.edges[0].fromPoint.x, freeBeforeAlign.edges[0].fromPoint.x + 10);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const edgeGroupResize = await page.locator('.semlo-editor-canvas-group-resize[data-corner="se"]').boundingBox();
  assert.ok(edgeGroupResize);
  await page.mouse.move(edgeGroupResize.x + edgeGroupResize.width / 2, edgeGroupResize.y + edgeGroupResize.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edgeGroupResize.x + edgeGroupResize.width / 2 + 30,
    edgeGroupResize.y + edgeGroupResize.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up();
  const resizedEdgeGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.notDeepEqual(resizedEdgeGroup.edges[0].toPoint, freeBeforeAlign.edges[0].toPoint);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const edgeGroupRotate = await page.getByRole("button", { name: "旋转编组" }).boundingBox();
  assert.ok(edgeGroupRotate);
  await page.mouse.move(edgeGroupRotate.x + edgeGroupRotate.width / 2, edgeGroupRotate.y + edgeGroupRotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edgeGroupRotate.x + edgeGroupRotate.width / 2 + 30,
    edgeGroupRotate.y + edgeGroupRotate.height / 2 + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  const rotatedEdgeGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.notDeepEqual(rotatedEdgeGroup.edges[0].toPoint, freeBeforeAlign.edges[0].toPoint);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    selected.dispatchEvent(paste);
  });
  const copiedEdgeGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(copiedEdgeGroup.groups.length, 2);
  assert.equal(copiedEdgeGroup.groups[1].edges[0], copiedEdgeGroup.edges[1].id);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  const edgeDragStage = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(edgeDragStage);
  const groupBeforeEdgeDrag = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  const edgeDragX = edgeDragStage.x + (edgeDragStage.width * 160) / 800;
  const edgeDragY = edgeDragStage.y + (edgeDragStage.height * 100) / 440;
  await page.mouse.move(edgeDragX, edgeDragY);
  await page.mouse.down();
  await page.mouse.move(edgeDragX + 30, edgeDragY + 15, { steps: 5 });
  await page.mouse.up();
  const groupAfterEdgeDrag = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  const edgeDx = groupAfterEdgeDrag.edges[0].fromPoint.x - groupBeforeEdgeDrag.edges[0].fromPoint.x;
  const shapeDx = groupAfterEdgeDrag.shapes[0].x - groupBeforeEdgeDrag.shapes[0].x;
  assert.ok(edgeDx > 0 && Math.abs(edgeDx - shapeDx) < 0.001);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                { id: "inside", shape: "rectangle", x: 100, y: 100, width: 100, height: 60, text: "组内" },
                { id: "outside", shape: "rectangle", x: 400, y: 100, width: 100, height: 60, text: "组外" },
              ],
              edges: [{ id: "connected", from: "inside", to: "outside", text: "", dashed: false, arrow: true }],
            },
          },
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "图形：组内" }).click();
  await page
    .locator(".semlo-editor-canvas-edge-hit")
    .evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
  await page.getByRole("button", { name: "编组", exact: true }).click();
  await page.getByRole("button", { name: "图形：组内" }).press("Shift+ArrowRight");
  const attachedGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(attachedGroup.shapes.find((shape: any) => shape.id === "inside").x, 110);
  assert.equal(attachedGroup.shapes.find((shape: any) => shape.id === "outside").x, 400);
  assert.equal(attachedGroup.edges[0].from, "inside");
  assert.equal(attachedGroup.edges[0].to, "outside");
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { replaceFirstWithSelf(): void };
    fixture.replaceFirstWithSelf();
    document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(paste);
  });
  const copiedAttachedGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(copiedAttachedGroup.edges[1].from, copiedAttachedGroup.shapes[2].id);
  assert.equal(copiedAttachedGroup.edges[1].to, "outside");
  assert.equal(copiedAttachedGroup.edges[1].toPoint, undefined);
  assert.equal(copiedAttachedGroup.groups[1].edges[0], copiedAttachedGroup.edges[1].id);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "图形：组内" }).click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    window.testCanvasClipboard = clipboard;
  });
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { rebuildFirstNode(): void };
    fixture.rebuildFirstNode();
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: window.__semloRequireFixture("testCanvasClipboard") });
    document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(paste);
  });
  const rebuiltCanvasCopy = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.equal(rebuiltCanvasCopy.to, "");
  assert.ok(rebuiltCanvasCopy.toPoint);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }),
  );
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    attachedGroup,
  );
  await page.evaluate(() => {
    const stage = document.querySelector(".semlo-editor-canvas-stage")!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: window.__semloRequireFixture("testCanvasClipboard") });
    stage.dispatchEvent(paste);
  });
  const crossCanvasCopy = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.equal(crossCanvasCopy.to, "");
  assert.ok(crossCanvasCopy.toPoint);
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    attachedGroup,
  );
  await page.getByRole("button", { name: "图形：组内" }).click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    window.testCanvasClipboard = copy.clipboardData!;
  });
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [{ id: "outside", shape: "rectangle", x: 500, y: 200, width: 100, height: 60, text: "新对象" }],
              edges: [],
            },
          },
        },
      ],
    }),
  );
  await page.evaluate(() => {
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: window.__semloRequireFixture("testCanvasClipboard") });
    document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(paste);
  });
  const replacedCanvasCopy = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.equal(replacedCanvasCopy.to, "");
  assert.ok(replacedCanvasCopy.toPoint);
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    attachedGroup,
  );
  await page.getByRole("button", { name: "图形：组内" }).click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    window.testCanvasClipboard = copy.clipboardData!;
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplace(content: unknown): void;
    };
    fixture.appendReplace({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [{ id: "outside", shape: "rectangle", x: 500, y: 200, width: 100, height: 60, text: "新对象" }],
              edges: [],
            },
          },
        },
      ],
    });
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: window.__semloRequireFixture("testCanvasClipboard") });
    document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(paste);
  });
  const appendedCanvasCopy = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.equal(appendedCanvasCopy.to, "");
  assert.ok(appendedCanvasCopy.toPoint);
  await setKind("flowchart");
  const freeLineTargetBox = await page.getByRole("button", { name: "图形：开始" }).boundingBox();
  const connectionStage = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(freeLineTargetBox && connectionStage);
  await page.getByRole("button", { name: "连线", exact: true }).click();
  await page.mouse.move(connectionStage.x + 10, freeLineTargetBox.y + freeLineTargetBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    freeLineTargetBox.x + freeLineTargetBox.width / 2,
    freeLineTargetBox.y + freeLineTargetBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  const attachedEdge = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.ok(attachedEdge.fromPoint);
  assert.equal(attachedEdge.to, "a");
  await page.getByRole("button", { name: "连线", exact: true }).click();
  await page.mouse.move(
    freeLineTargetBox.x + freeLineTargetBox.width / 2,
    freeLineTargetBox.y + freeLineTargetBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(connectionStage.x + 10, freeLineTargetBox.y + freeLineTargetBox.height + 50, { steps: 5 });
  await page.mouse.up();
  const fromShapeEdge = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.equal(fromShapeEdge.from, "a");
  assert.ok(fromShapeEdge.toPoint);
  await page.getByRole("button", { name: "连线", exact: true }).click();
  const startBoxForTwoShapes = await page.getByRole("button", { name: "图形：开始" }).boundingBox();
  const processBox = await page.getByRole("button", { name: "图形：过程" }).first().boundingBox();
  assert.ok(startBoxForTwoShapes && processBox);
  await page.mouse.move(
    startBoxForTwoShapes.x + startBoxForTwoShapes.width / 2,
    startBoxForTwoShapes.y + startBoxForTwoShapes.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(processBox.x + processBox.width / 2, processBox.y + processBox.height / 2, { steps: 5 });
  await page.mouse.up();
  const twoShapesEdge = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.at(-1),
  );
  assert.equal(twoShapesEdge.from, "a");
  assert.equal(twoShapesEdge.to, "b");
  await setKind("uml");
  assert.equal(await page.locator(".semlo-editor-canvas-actor-icon circle").count(), 1);
  const uml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").createCanvasContent("uml"));
  await page.evaluate(
    (value) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({ type: "doc", content: [value] }),
    uml,
  );
  const stageForMarquee = page.locator(".semlo-editor-canvas-stage");
  const stageBounds = await stageForMarquee.boundingBox();
  if (!stageBounds) throw new Error("missing canvas for marquee");
  const canvasXY = (x: number, y: number) => ({
    x: stageBounds.x + (x * stageBounds.width) / 800,
    y: stageBounds.y + (y * stageBounds.height) / 440,
  });
  const marqueeStart = canvasXY(240, 130),
    marqueeEnd = canvasXY(650, 235);
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 3);
  assert.equal(await page.locator('.semlo-editor-canvas-edge-hit[aria-pressed="true"]').count(), 1);
  await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').first().press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 6);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 4);
  assert.equal(await page.getByRole("button", { name: "图形：<<Extend>>" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "图形：<<Include>>" }).count(), 1);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 9);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 5);
  await page.evaluate(
    (value) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({ type: "doc", content: [value] }),
    uml,
  );
  const groupShapes = page.locator(".semlo-editor-canvas-shape");
  const box1 = await groupShapes.nth(1).boundingBox(),
    box2 = await groupShapes.nth(2).boundingBox();
  if (!box1 || !box2) throw new Error("missing marquee targets");
  await page.mouse.move(box1.x - 10, box1.y + box1.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width + 5, box1.y + box1.height + 5, { steps: 6 });
  assert.equal(await page.locator(".semlo-editor-canvas-marquee").count(), 1);
  await page.mouse.up();
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 0);
  await groupShapes.nth(1).click();
  await groupShapes.nth(2).click({ modifiers: ["Shift"] });
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  assert.equal(
    await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"] .semlo-editor-canvas-resize:visible').count(),
    0,
  );
  await page.getByRole("button", { name: "左对齐", exact: true }).click();
  const aligned = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  assert.equal(aligned.find((shape: any) => shape.id === "b").x, aligned.find((shape: any) => shape.id === "c").x);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "编组", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.groups.length,
    ),
    1,
  );
  const groupedSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    groupedSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    groupedSnapshot.json,
  );
  await groupShapes.nth(1).click();
  await groupShapes.nth(3).click({ modifiers: ["Shift"] });
  const beforeGroupAlign = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  await page.getByRole("button", { name: "右对齐", exact: true }).click();
  const afterGroupAlign = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  const groupGap = (shapes: any[]) =>
    shapes.find((shape) => shape.id === "c").x - shapes.find((shape) => shape.id === "b").x;
  assert.equal(groupGap(afterGroupAlign), groupGap(beforeGroupAlign));
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "编组", exact: true }).click();
  let outerGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.groups[0],
  );
  assert.equal(outerGroup.members.length, 3);
  assert.equal(outerGroup.children.length, 1);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  const outerSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    outerSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    outerSnapshot.json,
  );
  await groupShapes.nth(1).click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    selected.dispatchEvent(paste);
  });
  const nestedCopies = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.groups,
  );
  assert.equal(nestedCopies.length, 2);
  assert.equal(nestedCopies[1].children.length, 1);
  assert.notEqual(nestedCopies[0].children[0].id, nestedCopies[1].children[0].id);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await groupShapes.nth(1).click();
  await page.getByRole("button", { name: "取消编组" }).click();
  outerGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.groups[0],
  );
  assert.deepEqual(outerGroup.members.sort(), ["b", "c"]);
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  await groupShapes.nth(1).click();
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  assert.equal(await page.locator(".semlo-editor-canvas-group-outline").count(), 1);
  const sizeHandle = await page.locator('.semlo-editor-canvas-group-resize[data-corner="se"]').boundingBox();
  assert.ok(sizeHandle);
  const originalGroupShape = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.shapes.find((shape: any) => shape.id === "b"),
  );
  const edgeBeforeGroupResize = await page.locator(".semlo-editor-canvas-edge").first().getAttribute("d");
  await page.mouse.move(sizeHandle.x + sizeHandle.width / 2, sizeHandle.y + sizeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(sizeHandle.x + sizeHandle.width / 2 + 40, sizeHandle.y + sizeHandle.height / 2, {
    steps: 5,
  });
  assert.notEqual(await page.locator(".semlo-editor-canvas-edge").first().getAttribute("d"), edgeBeforeGroupResize);
  await page.mouse.up();
  const scaledGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  assert.ok(scaledGroup.find((shape: any) => shape.id === "b").width > 120);
  const scaledShape = scaledGroup.find((shape: any) => shape.id === "b");
  assert.ok(
    Math.abs(scaledShape.width / originalGroupShape.width - scaledShape.height / originalGroupShape.height) < 1e-9,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const rotateGroupHandle = await page.getByRole("button", { name: "旋转编组" }).boundingBox();
  assert.ok(rotateGroupHandle);
  await page.mouse.move(
    rotateGroupHandle.x + rotateGroupHandle.width / 2,
    rotateGroupHandle.y + rotateGroupHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    rotateGroupHandle.x + rotateGroupHandle.width / 2 + 30,
    rotateGroupHandle.y + rotateGroupHandle.height / 2 + 30,
    { steps: 5 },
  );
  await page.mouse.up();
  const rotatedGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  assert.ok(Math.abs(rotatedGroup.find((shape: any) => shape.id === "b").rotation) > 0);
  assert.notEqual(await page.locator(".semlo-editor-canvas-edge").first().getAttribute("d"), edgeBeforeGroupResize);
  const rotatedEdges = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.edges,
  );
  assert.ok(rotatedEdges.some((edge: any) => edge.from === "a" && edge.to === "b"));
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await groupShapes.nth(1).press("Shift+ArrowRight");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    selected.dispatchEvent(paste);
  });
  const groupsAfterCopy = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.groups,
  );
  assert.equal(groupsAfterCopy.length, 2);
  assert.notEqual(groupsAfterCopy[0].id, groupsAfterCopy[1].id);
  assert.ok(groupsAfterCopy[1].members.every((id: string) => !groupsAfterCopy[0].members.includes(id)));
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  const dragGroupBox = await groupShapes.nth(1).boundingBox();
  assert.ok(dragGroupBox);
  const beforeGroupDrag = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  await page.mouse.move(dragGroupBox.x + dragGroupBox.width / 2, dragGroupBox.y + dragGroupBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragGroupBox.x + dragGroupBox.width / 2 + 25, dragGroupBox.y + dragGroupBox.height / 2 + 10, {
    steps: 4,
  });
  await page.mouse.up();
  const afterGroupDrag = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes,
  );
  const dxFirst =
    afterGroupDrag.find((shape: any) => shape.id === "b").x - beforeGroupDrag.find((shape: any) => shape.id === "b").x;
  const dxSecond =
    afterGroupDrag.find((shape: any) => shape.id === "c").x - beforeGroupDrag.find((shape: any) => shape.id === "c").x;
  assert.ok(dxFirst > 0 && Math.abs(dxFirst - dxSecond) < 0.001);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await groupShapes.nth(1).click();
  await groupShapes.nth(1).press("Backspace");
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.groups.length,
    ),
    0,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await groupShapes.nth(1).click();
  await page.getByRole("button", { name: "取消编组" }).click();
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  await groupShapes.nth(1).click();
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 1);
  await groupShapes.nth(2).click({ modifiers: ["Shift"] });
  await groupShapes.nth(2).press("Shift+ArrowRight");
  let grouped = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(grouped.shapes.find((shape: any) => shape.id === "b").x, 260);
  assert.equal(grouped.shapes.find((shape: any) => shape.id === "c").x, 530);
  assert.equal(grouped.shapes.find((shape: any) => shape.id === "include-label").x, 380);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  const groupBefore = await groupShapes.nth(1).boundingBox();
  if (!groupBefore) throw new Error("missing selected group");
  await page.mouse.move(groupBefore.x + groupBefore.width / 2, groupBefore.y + groupBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(groupBefore.x + groupBefore.width / 2 + 30, groupBefore.y + groupBefore.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  grouped = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.ok(grouped.shapes.find((shape: any) => shape.id === "b").x > 270);
  assert.ok(grouped.shapes.find((shape: any) => shape.id === "c").x > 540);
  assert.equal(grouped.shapes.find((shape: any) => shape.id === "include-label").x, 380);
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  await groupShapes.nth(1).press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 7);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 5);
  assert.equal(await page.getByRole("button", { name: "图形：<<Include>>" }).count(), 1);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 9);
  await setKind("flowchart");
  const shapes = page.locator(".semlo-editor-canvas-shape");
  await shapes.nth(3).click();
  await shapes.nth(3).press("Backspace");
  const flowEdge = page.getByRole("button", { name: "连接线：否" });
  const lineBox = await flowEdge.boundingBox();
  if (!lineBox) throw new Error("missing connection line");
  await page.mouse.click(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2);
  await page.getByRole("button", { name: "线条样式", exact: true }).click();
  await page.getByLabel("连线路径").selectOption("curved");
  await page.getByRole("button", { name: "起点", exact: true }).click();
  await page.getByRole("button", { name: "起点箭头" }).click();
  await page.getByRole("button", { name: "起点", exact: true }).click();
  const endpoint = page.getByRole("button", { name: "连接线终点" });
  const endpointBox = await endpoint.boundingBox(),
    targetBox = await shapes.first().boundingBox();
  if (!endpointBox || !targetBox) throw new Error("missing connection endpoint or target");
  await page.mouse.move(endpointBox.x + endpointBox.width / 2, endpointBox.y + endpointBox.height / 2);
  await page.mouse.down();
  const beforeEndpointDrag = await flowEdge.getAttribute("d");
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  assert.notEqual(await flowEdge.getAttribute("d"), beforeEndpointDrag);
  assert.match((await flowEdge.getAttribute("d")) ?? "", / C /);
  assert.ok(await page.locator("[data-edge-start-arrow-id]").getAttribute("d"));
  await page.mouse.up();
  const attached = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.find((edge: any) => edge.text === "否"),
  );
  assert.equal(attached.to, "a");
  assert.equal(attached.toPoint, undefined);
  const connectedPath = await flowEdge.getAttribute("d");
  const startNode = page.getByRole("button", { name: "图形：开始" });
  await startNode.click();
  await startNode.press("Shift+ArrowLeft");
  assert.notEqual(await flowEdge.getAttribute("d"), connectedPath);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const restoredEndpoint = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.find((edge: any) => edge.text === "否"),
  );
  assert.equal(restoredEndpoint.to, "");
  assert.ok(restoredEndpoint.toPoint);
  const restoredLineBox = await flowEdge.boundingBox();
  if (!restoredLineBox) throw new Error("missing restored connection");
  await page.mouse.click(restoredLineBox.x + restoredLineBox.width / 2, restoredLineBox.y + restoredLineBox.height / 2);
  const freeHandle = await page.getByRole("button", { name: "连接线终点" }).boundingBox();
  const canvasBox = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  if (!freeHandle || !canvasBox) throw new Error("missing detached endpoint");
  await page.mouse.move(freeHandle.x + freeHandle.width / 2, freeHandle.y + freeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.85, canvasBox.y + canvasBox.height * 0.35, { steps: 5 });
  await page.mouse.up();
  const movedEndpoint = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.edges.find((edge: any) => edge.text === "否"),
  );
  assert.equal(movedEndpoint.to, "");
  assert.notDeepEqual(movedEndpoint.toPoint, restoredEndpoint.toPoint);
  const detachedSnapshot = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML(), text: e.getText() };
  });
  assert.match(detachedSnapshot.text, /否/);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    detachedSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    detachedSnapshot.json,
  );
  await setKind("board");
  await chooseShape("roundedRect");
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 150, y: 100 } });
  assert.equal(await page.locator(".semlo-editor-canvas-shape-roundedRect").count(), 1);
  const roundedRadius = await page.evaluate(() => {
    const html = window.__semloRequireFixture("mindmapTest").editor.getHTML();
    return new DOMParser().parseFromString(html, "text/html").querySelector("svg rect")?.getAttribute("rx");
  });
  assert.equal(roundedRadius, "8");
  for (const shape of [
    "triangle",
    "parallelogram",
    "trapezoid",
    "pentagon",
    "star",
    "leftArrow",
    "rightArrow",
    "doubleArrow",
    "cross",
    "callout",
    "callout2",
    "fiveArrow",
    "flowArrow",
  ]) {
    await setKind("board");
    await chooseShape(shape);
    await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 180, y: 90 } });
    const polygon = page.locator(".semlo-editor-canvas-shape-polygon polygon");
    assert.equal(await polygon.count(), 1, shape);
    await page.getByRole("button", { name: "填充", exact: true }).click();
    await page.getByLabel("图形填充颜色").fill("#aabbcc");
    assert.equal(await polygon.getAttribute("fill"), "#aabbcc");
    if (shape === "triangle") {
      await page.getByRole("button", { name: "描边", exact: true }).click();
      await page.getByLabel("图形描边粗细").fill("6");
      await page.getByLabel("图形描边粗细").press("Tab");
      await page.getByRole("button", { name: "虚线描边" }).click();
      assert.equal(await polygon.evaluate((element) => getComputedStyle(element).strokeDasharray), "5px, 4px");
    }
    const snapshot = await page.evaluate(() => {
      const e = window.__semloRequireFixture("mindmapTest").editor;
      return { json: e.getJSON(), html: e.getHTML() };
    });
    const staticPolygon = await page.evaluate(
      (html) =>
        new DOMParser()
          .parseFromString(html, "text/html")
          .querySelector("figure[data-semlo-editor-canvas] svg polygon")
          ?.getAttribute("fill"),
      snapshot.html,
    );
    assert.equal(staticPolygon, "#aabbcc");
    if (shape === "triangle") {
      const exportedStroke = await page.evaluate((html) => {
        const polygon = new DOMParser().parseFromString(html, "text/html").querySelector("svg polygon");
        return { width: polygon?.getAttribute("stroke-width"), dash: polygon?.getAttribute("stroke-dasharray") };
      }, snapshot.html);
      assert.deepEqual(exportedStroke, { width: "6", dash: "5 4" });
    }
    await page.evaluate(
      (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
      snapshot.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      snapshot.json,
    );
  }
  await setKind("board");
  await chooseShape("cloud");
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 180, y: 90 } });
  const cloud = page.locator(".semlo-editor-canvas-shape-polygon path");
  assert.equal(await cloud.count(), 1);
  assert.match((await cloud.getAttribute("d")) ?? "", / C /);
  await page.getByRole("button", { name: "填充", exact: true }).click();
  await page.getByRole("button", { name: "填充颜色 #a287e1" }).click();
  assert.equal(await cloud.getAttribute("fill"), "#a287e1");
  const cloudSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  assert.match(cloudSnapshot.html, /vector-effect="non-scaling-stroke"/);
  for (const content of [cloudSnapshot.json, cloudSnapshot.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      cloudSnapshot.json,
    );
  }
  await chooseShape("rectangle");
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 440, y: 90 } });
  await page.getByRole("button", { name: "连线", exact: true }).click();
  const cloudShape = page.locator(".semlo-editor-canvas-shape-cloud");
  const rectangleShape = page.locator(".semlo-editor-canvas-shape-rectangle");
  await cloudShape.click();
  await rectangleShape.click();
  const cloudEdge = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.edges[0],
  );
  assert.equal(cloudEdge.from, await cloudShape.getAttribute("data-shape-id"));
  assert.equal(cloudEdge.to, await rectangleShape.getAttribute("data-shape-id"));
  assert.ok(await page.locator(".semlo-editor-canvas-edge").getAttribute("d"));
  for (const bracket of ["leftBracket", "rightBracket"]) {
    await setKind("board");
    await chooseShape(bracket);
    await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 180, y: 90 } });
    const curve = page.locator(".semlo-editor-canvas-shape-polygon path");
    assert.equal(await curve.getAttribute("fill"), "none");
    assert.ok((await curve.getAttribute("d"))?.startsWith(bracket === "leftBracket" ? "M 98 " : "M 2 "));
    const snapshot = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    assert.match(snapshot.html, /fill="none"/);
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      snapshot.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      snapshot.json,
    );
  }
  await setKind("board");
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 100, y: 80 } });
  await page.getByRole("button", { name: "图形：文本" }).dblclick();
  await page.getByLabel("编辑图形文字").fill("甲");
  await page.getByLabel("编辑图形文字").press("Enter");
  await page.getByLabel("编辑图形文字").pressSequentially("乙");
  await page.getByLabel("编辑图形文字").press("Tab");
  const multiline = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML() };
  });
  assert.equal(requireCanvasAttrs(multiline.json).data.shapes[0].text, "甲\n乙");
  const tspans = await page.evaluate(
    (html) =>
      Array.from(
        new DOMParser()
          .parseFromString(html, "text/html")
          .querySelectorAll("figure[data-semlo-editor-canvas] svg text tspan"),
      ).map((node) => node.textContent),
    multiline.html,
  );
  assert.deepEqual(tspans, ["甲", "乙"]);
  for (const content of [multiline.json, multiline.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      multiline.json,
    );
  }
  await page.getByRole("button", { name: /图形：甲/ }).dblclick();
  await page.getByLabel("编辑图形文字").fill("变化");
  await page.getByLabel("编辑图形文字").press("Tab");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const multilineShape = page.getByRole("button", { name: /图形：甲/ });
  assert.equal(await multilineShape.count(), 1);
  await multilineShape.click();
  await page.getByRole("button", { name: "文字样式", exact: true }).click();
  await page.getByLabel("文字字号").selectOption("22");
  await page.getByLabel("文字颜色").fill("#cc3355");
  await page.getByRole("button", { name: "加粗", exact: true }).click();
  await page.getByRole("button", { name: "斜体", exact: true }).click();
  await page.getByRole("button", { name: "下划线", exact: true }).click();
  await page.getByRole("button", { name: "删除线", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.notEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes[0].strike,
    ),
    true,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.getByLabel("文字对齐").selectOption("left");
  await page.getByLabel("文字竖直对齐").selectOption("bottom");
  const styled = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML() };
  });
  const styledItem = requireCanvasAttrs(styled.json).data.shapes[0];
  assert.equal(styledItem.fontSize, 22);
  assert.equal(styledItem.textColor, "#cc3355");
  assert.equal(styledItem.bold, true);
  assert.equal(styledItem.italic, true);
  assert.equal(styledItem.underline, true);
  assert.equal(styledItem.strike, true);
  assert.equal(styledItem.textAlign, "left");
  assert.equal(styledItem.verticalAlign, "bottom");
  const textStyle = await multilineShape
    .locator("span")
    .first()
    .evaluate((element) => ({
      style: getComputedStyle(element).fontStyle,
      decoration: getComputedStyle(element).textDecorationLine,
      position: getComputedStyle(element).position,
    }));
  assert.deepEqual(textStyle, { style: "italic", decoration: "underline line-through", position: "absolute" });
  const styledSvg = await page.evaluate((html) => {
    const text = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("figure[data-semlo-editor-canvas] svg text");
    return {
      size: text?.getAttribute("font-size"),
      weight: text?.getAttribute("font-weight"),
      style: text?.getAttribute("font-style"),
      decoration: text?.getAttribute("text-decoration"),
      color: text?.getAttribute("fill"),
      align: text?.getAttribute("text-anchor"),
      y: Number(text?.getAttribute("y")),
    };
  }, styled.html);
  assert.deepEqual(styledSvg, {
    size: "22",
    weight: "bold",
    style: "italic",
    decoration: "underline line-through",
    color: "#cc3355",
    align: "start",
    y: styledItem.y + styledItem.height - 8 - 22 * 0.2 - 22 * 1.2,
  });
  await page.getByRole("button", { name: "文字样式", exact: true }).click();
  await multilineShape.dblclick();
  const textEditor = page.getByLabel("编辑图形文字");
  assert.ok(await textEditor.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop) > 0));
  await textEditor.press("Escape");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  for (const content of [styled.json, styled.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      styled.json,
    );
  }
  await setKind("board");
  await page.getByLabel("放大画布").click();
  assert.equal(await page.locator(".semlo-editor-canvas-zoom").textContent(), "110%");
  await page.getByLabel("缩小画布").click();
  assert.equal(await page.locator(".semlo-editor-canvas-zoom").textContent(), "100%");
  await chooseShape("rectangle");
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 200, y: 120 } });
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 1);
  const first = page.getByRole("button", { name: "图形：空白" });
  await first.dblclick();
  await page.getByLabel("编辑图形文字").fill("测试 <节点>");
  await page.getByLabel("编辑图形文字").press("Tab");
  const named = page.getByRole("button", { name: "图形：测试 <节点>" });
  assert.equal(await named.count(), 1);
  await named.click();
  await page.getByRole("button", { name: "填充", exact: true }).click();
  await page.getByRole("button", { name: "填充颜色 #a287e1" }).press("Escape");
  assert.equal(await page.getByRole("button", { name: "填充", exact: true }).getAttribute("aria-expanded"), "false");
  await page.getByRole("button", { name: "填充", exact: true }).click();
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 500, y: 300 } });
  await named.click();
  assert.equal(await page.getByRole("button", { name: "填充", exact: true }).getAttribute("aria-expanded"), "false");
  await page.getByRole("button", { name: "填充", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "填充颜色 #ffffff" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "填充颜色 #a287e1" }).click();
  assert.equal(await named.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(162, 135, 225)");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.getByLabel("图形填充颜色").fill("#aa88dd");
  assert.equal(await named.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(170, 136, 221)");
  await page.getByRole("button", { name: "描边", exact: true }).click();
  await page.getByLabel("图形边框颜色").fill("#224466");
  assert.equal(await named.evaluate((element) => getComputedStyle(element).borderColor), "rgb(34, 68, 102)");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.notEqual(await named.evaluate((element) => getComputedStyle(element).borderColor), "rgb(34, 68, 102)");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await page.getByLabel("图形描边粗细").fill("6");
  await page.getByLabel("图形描边粗细").press("Tab");
  await page.getByRole("button", { name: "虚线描边" }).click();
  assert.equal(await named.evaluate((element) => getComputedStyle(element).borderStyle), "dashed");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await named.evaluate((element) => getComputedStyle(element).borderStyle), "solid");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await named.press("ControlOrMeta+z");
  const afterKeyboardUndo = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.shapes[0],
  );
  assert.notEqual(afterKeyboardUndo.strokeDashed, true);
  assert.equal(afterKeyboardUndo.strokeWidth, 6);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  const strokeExport = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const rect = new DOMParser().parseFromString(editor.getHTML(), "text/html").querySelector("svg rect");
    return { width: rect?.getAttribute("stroke-width"), dashed: rect?.getAttribute("stroke-dasharray") };
  });
  assert.equal(strokeExport.width, "6");
  assert.equal(strokeExport.dashed, "5 4");
  await chooseShape("ellipse");
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 420, y: 220 } });
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 2);
  await page.getByRole("button", { name: "连线", exact: true }).click();
  await named.click();
  await page.getByRole("button", { name: "图形：空白" }).click();
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 1);
  const edgeHit = page.getByRole("button", { name: "连接线", exact: true });
  const edgePoint = await edgeHit.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(10).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await page.getByRole("button", { name: "线条样式", exact: true }).click();
  await page.getByRole("button", { name: "虚线", exact: true }).click();
  assert.equal(await page.locator(".semlo-editor-canvas-edge").getAttribute("stroke-dasharray"), "5 4");
  await page.getByRole("button", { name: "终点", exact: true }).click();
  await page.getByRole("button", { name: "箭头", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "箭头", exact: true }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "连线标签", exact: true }).click();
  await page.getByLabel("连线文字").fill("条件");
  await page.getByLabel("连线文字").press("Enter");
  assert.equal(await page.locator(".semlo-editor-canvas-edges text").textContent(), "条件");
  const namedEdge = page.getByRole("button", { name: "连接线：条件" });
  await namedEdge.press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 1);
  const edgeBefore = await page.locator(".semlo-editor-canvas-edge").getAttribute("d");
  assert.match(edgeBefore ?? "", /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L /);
  assert.deepEqual(
    await page
      .locator(".semlo-editor-canvas-viewport")
      .evaluate((viewport) => [viewport.scrollLeft, viewport.scrollTop]),
    [0, 0],
  );
  await named.scrollIntoViewIfNeeded();
  const before = await named.boundingBox();
  if (!before) throw new Error("missing shape");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 50, before.y + before.height / 2 + 25, { steps: 5 });
  assert.notEqual(await page.locator(".semlo-editor-canvas-edge").getAttribute("d"), edgeBefore);
  await page.mouse.up();
  const after = await named.boundingBox();
  assert.ok(after && after.x > before.x + 40);
  assert.notEqual(await page.locator(".semlo-editor-canvas-edge").getAttribute("d"), edgeBefore);
  const beforeKey = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.shapes.find((shape: any) => shape.text === "测试 <节点>"),
  );
  await named.click();
  await named.press("ArrowRight");
  await named.press("Shift+ArrowDown");
  const afterKey = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.shapes.find((shape: any) => shape.text === "测试 <节点>"),
  );
  assert.equal(afterKey.x, beforeKey.x + 1);
  assert.equal(afterKey.y, beforeKey.y + 10);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  await named.click();
  await named.locator('.semlo-editor-canvas-resize[data-corner="se"]').scrollIntoViewIfNeeded();
  const beforeResize = await named.boundingBox();
  const handle = await named.locator('.semlo-editor-canvas-resize[data-corner="se"]').boundingBox();
  if (!beforeResize || !handle) throw new Error("missing resize handle");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 35, handle.y + handle.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  const afterResize = await named.boundingBox();
  assert.ok(afterResize && afterResize.width > beforeResize.width + 25);
  const nw = named.locator('.semlo-editor-canvas-resize[data-corner="nw"]');
  await nw.scrollIntoViewIfNeeded();
  const nwBox = await nw.boundingBox(),
    beforeNorthwest = await named.boundingBox();
  if (!nwBox || !beforeNorthwest) throw new Error("missing northwest resize handle");
  await page.mouse.move(nwBox.x + nwBox.width / 2, nwBox.y + nwBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nwBox.x + nwBox.width / 2 - 20, nwBox.y + nwBox.height / 2 - 15, { steps: 4 });
  await page.mouse.up();
  const afterNorthwest = await named.boundingBox();
  assert.ok(afterNorthwest && afterNorthwest.x < beforeNorthwest.x - 15 && afterNorthwest.y < beforeNorthwest.y - 10);
  assert.ok(
    afterNorthwest &&
      Math.abs(afterNorthwest.x + afterNorthwest.width - (beforeNorthwest.x + beforeNorthwest.width)) < 2,
  );
  for (const [corner, dx, dy] of [
    ["ne", 15, -10],
    ["sw", -15, 10],
  ] as const) {
    const cornerHandle = named.locator(`.semlo-editor-canvas-resize[data-corner="${corner}"]`);
    await cornerHandle.scrollIntoViewIfNeeded();
    const position = await cornerHandle.boundingBox(),
      beforeCorner = await named.boundingBox();
    if (!position || !beforeCorner) throw new Error(`missing ${corner} resize handle`);
    await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
    await page.mouse.down();
    await page.mouse.move(position.x + position.width / 2 + dx, position.y + position.height / 2 + dy, { steps: 4 });
    await page.mouse.up();
    const afterCorner = await named.boundingBox();
    assert.ok(
      afterCorner && afterCorner.width > beforeCorner.width + 10 && afterCorner.height > beforeCorner.height + 5,
    );
  }
  const rotate = named.locator(".semlo-editor-canvas-rotate");
  await rotate.scrollIntoViewIfNeeded();
  const rotateBox = await rotate.boundingBox(),
    shapeBox = await named.boundingBox();
  if (!rotateBox || !shapeBox) throw new Error("missing rotation handle");
  const sx = rotateBox.x + rotateBox.width / 2,
    sy = rotateBox.y + rotateBox.height / 2;
  const cx = shapeBox.x + shapeBox.width / 2,
    cy = shapeBox.y + shapeBox.height / 2;
  const angle = Math.PI / 3,
    tx = cx + (sx - cx) * Math.cos(angle) - (sy - cy) * Math.sin(angle),
    ty = cy + (sx - cx) * Math.sin(angle) + (sy - cy) * Math.cos(angle);
  const beforeRotatePath = await page.locator(".semlo-editor-canvas-edge").getAttribute("d");
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 8 });
  assert.notEqual(await page.locator(".semlo-editor-canvas-edge").getAttribute("d"), beforeRotatePath);
  await page.mouse.up();
  const rotated = await page.evaluate(
    () =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        )
        .data.shapes.find((shape: any) => shape.text === "测试 <节点>").rotation,
  );
  assert.ok(rotated >= 58 && rotated <= 62);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  const rotatedBefore = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.shapes.find((shape: any) => shape.text === "测试 <节点>"),
  );
  const rotatedCorner = named.locator('.semlo-editor-canvas-resize[data-corner="se"]');
  await rotatedCorner.scrollIntoViewIfNeeded();
  const cornerBox = await rotatedCorner.boundingBox();
  if (!cornerBox) throw new Error("missing rotated corner");
  const radians = (rotatedBefore.rotation * Math.PI) / 180;
  const moveX = 25 * Math.cos(radians) - 15 * Math.sin(radians);
  const moveY = 25 * Math.sin(radians) + 15 * Math.cos(radians);
  await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cornerBox.x + cornerBox.width / 2 + moveX, cornerBox.y + cornerBox.height / 2 + moveY, {
    steps: 5,
  });
  await page.mouse.up();
  const rotatedAfter = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.shapes.find((shape: any) => shape.text === "测试 <节点>"),
  );
  const fixedCorner = (shape: any) => {
    const angle = (shape.rotation * Math.PI) / 180;
    return {
      x: shape.x + shape.width / 2 - (shape.width / 2) * Math.cos(angle) + (shape.height / 2) * Math.sin(angle),
      y: shape.y + shape.height / 2 - (shape.width / 2) * Math.sin(angle) - (shape.height / 2) * Math.cos(angle),
    };
  };
  assert.ok(rotatedAfter.width > rotatedBefore.width + 5 && rotatedAfter.height > rotatedBefore.height + 5);
  assert.ok(
    Math.hypot(
      fixedCorner(rotatedAfter).x - fixedCorner(rotatedBefore).x,
      fixedCorner(rotatedAfter).y - fixedCorner(rotatedBefore).y,
    ) < 0.01,
  );
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page.getByLabel("画笔颜色").fill("#cc3355");
  await page.getByLabel("画笔粗细").fill("7");
  await page.locator(".semlo-editor-canvas-viewport").evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });
  const stageBox = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  if (!stageBox) throw new Error("missing canvas stage");
  await page.mouse.move(stageBox.x + 80, stageBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 150, stageBox.y + 210, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 1);
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").getAttribute("stroke"), "#cc3355");
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").getAttribute("stroke-width"), "7");
  await page.locator(".semlo-editor-canvas-stage").press("ControlOrMeta+z");
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 0);
  await page.locator(".semlo-editor-canvas-stage").press("ControlOrMeta+Shift+z");
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 1);
  await page.getByRole("button", { name: "橡皮", exact: true }).click();
  await page.mouse.move(stageBox.x + 105, stageBox.y + 191);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 130, stageBox.y + 202, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 0);
  await page.locator(".semlo-editor-canvas-stage").press("ControlOrMeta+z");
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 1);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const strokeHit = page.getByRole("button", { name: "笔迹" });
  const strokeBox = await strokeHit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  if (!strokeBox) throw new Error("missing stroke");
  await page.mouse.move(strokeBox.x - 20, strokeBox.y - 20);
  await page.mouse.down();
  await page.mouse.move(strokeBox.x + strokeBox.width + 20, strokeBox.y + strokeBox.height + 20, { steps: 5 });
  await page.mouse.up();
  assert.equal(await strokeHit.getAttribute("aria-pressed"), "true");
  const beforeNudge = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points[0],
  );
  await strokeHit.press("Shift+ArrowRight");
  const afterNudge = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points[0],
  );
  assert.equal(afterNudge.x, beforeNudge.x + 10);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const movableStroke = await strokeHit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.move(movableStroke.x + movableStroke.width / 2, movableStroke.y + movableStroke.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    movableStroke.x + movableStroke.width / 2 + 20,
    movableStroke.y + movableStroke.height / 2 + 10,
    { steps: 5 },
  );
  await page.mouse.up();
  const draggedStroke = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points[0],
  );
  assert.ok(draggedStroke.x > beforeNudge.x + 5 && draggedStroke.y > beforeNudge.y + 2);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const selectStroke = await strokeHit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.click(selectStroke.x + selectStroke.width / 2, selectStroke.y + selectStroke.height / 2);
  await named.click({ modifiers: ["Shift"] });
  assert.equal(await strokeHit.getAttribute("aria-pressed"), "true");
  assert.equal(await named.getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "顶端对齐", exact: true }).click();
  const alignedMixed = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  const alignedShape = alignedMixed.shapes.find((shape: any) => shape.text === "测试 <节点>");
  const alignedAngle = ((alignedShape.rotation ?? 0) * Math.PI) / 180;
  const alignedHeight =
    Math.abs(Math.sin(alignedAngle)) * alignedShape.width + Math.abs(Math.cos(alignedAngle)) * alignedShape.height;
  const shapeTop = alignedShape.y + (alignedShape.height - alignedHeight) / 2;
  const strokeTop =
    Math.min(...alignedMixed.strokes[0].points.map((point: any) => point.y)) - (alignedMixed.strokes[0].width ?? 3) / 2;
  assert.ok(Math.abs(shapeTop - strokeTop) < 0.01);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "编组", exact: true }).click();
  const mixedGroup = await page.evaluate(() =>
    window
      .__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      )
      .data.groups.at(-1),
  );
  assert.equal(mixedGroup.members.length, 1);
  assert.equal(mixedGroup.strokes.length, 1);
  const mixedGroupSnapshot = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    return { json: editor.getJSON(), html: editor.getHTML() };
  });
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    mixedGroupSnapshot.html,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    mixedGroupSnapshot.json,
  );
  await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 10, y: 260 } });
  await named.click();
  assert.equal(await strokeHit.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".semlo-editor-canvas-group-outline").count(), 1);
  const mixedResize = await page.locator('.semlo-editor-canvas-group-resize[data-corner="se"]').boundingBox();
  assert.ok(mixedResize);
  const mixedPointsBeforeScale = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points,
  );
  await page.mouse.move(mixedResize.x + mixedResize.width / 2, mixedResize.y + mixedResize.height / 2);
  await page.mouse.down();
  await page.mouse.move(mixedResize.x + mixedResize.width / 2 + 25, mixedResize.y + mixedResize.height / 2 + 25, {
    steps: 4,
  });
  await page.mouse.up();
  const mixedPointsAfterScale = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points,
  );
  assert.notDeepEqual(mixedPointsAfterScale, mixedPointsBeforeScale);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const mixedRotate = await page.getByRole("button", { name: "旋转编组" }).boundingBox();
  assert.ok(mixedRotate);
  await page.mouse.move(mixedRotate.x + mixedRotate.width / 2, mixedRotate.y + mixedRotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(mixedRotate.x + mixedRotate.width / 2 + 25, mixedRotate.y + mixedRotate.height / 2 + 25, {
    steps: 4,
  });
  await page.mouse.up();
  assert.notDeepEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.strokes[0].points,
    ),
    mixedPointsBeforeScale,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const mixedBeforeGroupMove = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  await named.press("Shift+ArrowRight");
  const mixedAfterGroupMove = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(mixedAfterGroupMove.strokes[0].points[0].x, mixedBeforeGroupMove.strokes[0].points[0].x + 10);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const clipboard = copy.clipboardData!;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    selected.dispatchEvent(paste);
  });
  const copiedMixed = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(copiedMixed.groups.length, 2);
  assert.notEqual(copiedMixed.groups[0].strokes[0], copiedMixed.groups[1].strokes[0]);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await named.click();
  await named.press("Backspace");
  const deletedMixed = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(deletedMixed.groups.length, 0);
  assert.equal(deletedMixed.strokes.length, 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "橡皮", exact: true }).click();
  const groupedStrokeBox = await strokeHit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.click(
    groupedStrokeBox.x + groupedStrokeBox.width / 2,
    groupedStrokeBox.y + groupedStrokeBox.height / 2,
  );
  const erasedGroup = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data,
  );
  assert.equal(erasedGroup.strokes.length, 0);
  assert.equal(erasedGroup.groups.length, 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await strokeHit.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  assert.equal(await named.getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "取消编组" }).click();
  await named.click();
  await strokeHit.evaluate((element) =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })),
  );
  const groupedBefore = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points[0],
  );
  await named.press("Shift+ArrowRight");
  const groupedAfter = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points[0],
  );
  assert.equal(groupedAfter.x, groupedBefore.x + 10);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const mixedShape = await named.boundingBox();
  if (!mixedShape) throw new Error("missing mixed selection shape");
  await page.mouse.move(mixedShape.x + mixedShape.width / 2, mixedShape.y + mixedShape.height / 2);
  await page.mouse.down();
  await page.mouse.move(mixedShape.x + mixedShape.width / 2 + 25, mixedShape.y + mixedShape.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.up();
  const movedMixed = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.strokes[0].points[0],
  );
  assert.ok(movedMixed.x > groupedBefore.x + 5);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const strokeGeometry = await strokeHit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.click(strokeGeometry.x + strokeGeometry.width / 2, strokeGeometry.y + strokeGeometry.height / 2);
  await strokeHit.press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 1);
  const heightHandle = page.getByRole("separator", { name: "调整画布高度" });
  await heightHandle.focus();
  await heightHandle.press("ArrowDown");
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "470");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "460");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  assert.equal(await heightHandle.getAttribute("aria-valuenow"), "470");
  const snapshot = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML() };
  });
  const staticView = await page.evaluate((html) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const svg = parsed.querySelector("figure[data-semlo-editor-canvas] svg");
    return {
      namespace: svg?.namespaceURI,
      shapes: svg?.querySelectorAll("rect, ellipse").length,
      paths: svg?.querySelectorAll("path").length,
      text: svg?.textContent,
      color: svg?.querySelector("rect")?.getAttribute("fill"),
      rotation: svg?.querySelector("g[transform]")?.getAttribute("transform"),
    };
  }, snapshot.html);
  assert.equal(staticView.namespace, "http://www.w3.org/2000/svg");
  assert.equal(staticView.shapes, 2);
  assert.ok((staticView.paths ?? 0) >= 2);
  assert.match(staticView.text ?? "", /测试 <节点>/);
  assert.equal(staticView.color, "#aa88dd");
  assert.match(staticView.rotation ?? "", /^rotate\(/);
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      snapshot.json,
    );
    assert.equal(await heightHandle.getAttribute("aria-valuenow"), "470");
    assert.equal(await named.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(170, 136, 221)");
    assert.equal(await named.evaluate((element) => getComputedStyle(element).borderColor), "rgb(34, 68, 102)");
    assert.equal(await page.locator(".semlo-editor-canvas-stroke").count(), 1);
    assert.equal(await page.locator(".semlo-editor-canvas-stroke").getAttribute("stroke"), "#cc3355");
    assert.equal(await page.locator(".semlo-editor-canvas-stroke").getAttribute("stroke-width"), "7");
  }
  await named.click();
  await named.press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 1);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 1);
  assert.equal(await page.locator(".semlo-editor-canvas-edges text").textContent(), "条件");
  const detached = await page.evaluate(() => {
    const e = window.__semloRequireFixture("mindmapTest").editor;
    return { json: e.getJSON(), html: e.getHTML() };
  });
  assert.ok(requireCanvasAttrs(detached.json).data.edges[0].fromPoint);
  for (const content of [detached.json, detached.html]) {
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      content,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      detached.json,
    );
    assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 1);
  }
  const remaining = page.getByRole("button", { name: "图形：空白" });
  await remaining.click();
  await remaining.press("Backspace");
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 0);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 1);
  const bothDetached = await page.evaluate(
    () =>
      window.__semloRequireValue(
        window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
        "canvas document attributes",
      ).data.edges[0],
  );
  assert.ok(bothDetached.fromPoint && bothDetached.toPoint);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 1);
  // Restore the pre-deletion document before checking that deletion is undoable.
  await page.evaluate(
    (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
    snapshot.json,
  );
  await named.click();
  await named.press("Backspace");
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await page.locator(".semlo-editor-canvas-shape").count(), 2);
  assert.equal(await page.locator(".semlo-editor-canvas-edge").count(), 1);
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(false));
  await named.dblclick();
  assert.equal(await page.getByLabel("编辑图形文字").count(), 0);
  assert.equal(await page.getByRole("button", { name: "更多形状", exact: true }).isDisabled(), true);
  await page.locator(".semlo-editor-canvas-stage").press("ControlOrMeta+a");
  assert.equal(await page.locator('.semlo-editor-canvas-shape[aria-pressed="true"]').count(), 2);
  assert.equal(await page.locator('.semlo-editor-canvas-edge-hit[aria-pressed="true"]').count(), 1);
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.setEditable(true));
  assert.equal(await page.getByRole("button", { name: "更多形状", exact: true }).isEnabled(), true);
  const futureData = { shapes: [], edges: [], futureFeature: { value: 42 } };
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    futureData,
  );
  assert.equal(await page.getByRole("status").textContent(), "画布数据格式不受支持，暂无法编辑。");
  assert.equal(await page.getByRole("button", { name: "更多形状", exact: true }).count(), 0);
  const unsupportedHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.match(unsupportedHtml, /画布数据格式不受支持/);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    unsupportedHtml,
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data,
    ),
    futureData,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mindmapTest")
      .editor.commands.setContent('<figure data-semlo-editor-canvas data-canvas="{bad"></figure>'),
  );
  assert.equal(await page.getByRole("status").textContent(), "画布数据格式不受支持，暂无法编辑。");
  const malformedHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    malformedHtml,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data,
    ),
    "{bad",
  );
  const invalidGroupData = {
    shapes: [
      { id: "a", shape: "rectangle", x: 0, y: 0, width: 80, height: 40, text: "A" },
      { id: "b", shape: "rectangle", x: 100, y: 0, width: 80, height: 40, text: "B" },
      { id: "c", shape: "rectangle", x: 200, y: 0, width: 80, height: 40, text: "C" },
    ],
    edges: [],
    groups: [{ id: "outer", members: ["a", "b"], children: [{ id: "inner", members: ["a", "c"] }] }],
  };
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    invalidGroupData,
  );
  assert.equal(await page.getByRole("status").textContent(), "画布数据格式不受支持，暂无法编辑。");
  const invalidGroupHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    invalidGroupHtml,
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data,
    ),
    invalidGroupData,
  );
  const invalidLaneParent = {
    shapes: [
      { id: "orphan", shape: "rectangle", x: 10, y: 10, width: 80, height: 50, text: "成员", parentLane: "missing" },
    ],
    edges: [],
  };
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }],
      }),
    invalidLaneParent,
  );
  assert.equal(await page.getByRole("status").textContent(), "画布数据格式不受支持，暂无法编辑。");
  const invalidLaneHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    invalidLaneHtml,
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data,
    ),
    invalidLaneParent,
  );
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [
                {
                  id: "wrapped",
                  shape: "rectangle",
                  x: 100,
                  y: 100,
                  width: 120,
                  height: 180,
                  text: "甲",
                  verticalAlign: "bottom",
                },
              ],
              edges: [],
            },
          },
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "图形：甲" }).dblclick();
  const wrappingEditor = page.getByLabel("编辑图形文字");
  const shortPadding = await wrappingEditor.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
  await wrappingEditor.fill("需要自动换行的较长文字需要自动换行的较长文字");
  const wrappedPadding = await wrappingEditor.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
  assert.ok(wrappedPadding < shortPadding);
  await wrappingEditor.press("Escape");
  for (const kind of ["swimlaneVertical", "swimlaneHorizontal"]) {
    await setKind("board");
    await chooseShape(kind);
    await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 20, y: 20 } });
    assert.deepEqual(await page.locator(".semlo-editor-canvas-lane-title").allTextContents(), [
      "Lane 1",
      "Lane 2",
      "Lane 3",
    ]);
    const initialLane = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes[0],
    );
    await page.getByLabel("泳道数量").fill("4");
    await page.getByLabel("泳道数量").press("Tab");
    const expandedLane = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes[0],
    );
    assert.ok(
      Math.abs(
        (kind === "swimlaneVertical"
          ? expandedLane.width / initialLane.width
          : expandedLane.height / initialLane.height) -
          4 / 3,
      ) < 1e-9,
    );
    assert.deepEqual(await page.locator(".semlo-editor-canvas-lane-title").allTextContents(), [
      "Lane 1",
      "Lane 2",
      "Lane 3",
      "Lane 4",
    ]);
    await page.locator(".semlo-editor-canvas-lane-title").first().dblclick();
    assert.equal(await page.getByLabel("编辑泳道 1 名称").evaluate((input) => input.closest("button") === null), true);
    const inputClipboard = await page.getByLabel("编辑泳道 1 名称").evaluate((input) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "文本");
      const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: clipboard });
      input.dispatchEvent(event);
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: clipboard });
      input.dispatchEvent(paste);
      return {
        prevented: event.defaultPrevented,
        pastePrevented: paste.defaultPrevented,
        text: clipboard.getData("text/plain"),
      };
    });
    assert.deepEqual(inputClipboard, { prevented: false, pastePrevented: false, text: "文本" });
    await page.getByLabel("编辑泳道 1 名称").fill("设计");
    await page.getByLabel("编辑泳道 1 名称").evaluate((input) => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    });
    assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 1);
    await page.getByLabel("编辑泳道 1 名称").press("Enter");
    assert.equal(await page.locator(".semlo-editor-canvas-lane-title").first().textContent(), "设计");
    assert.equal(
      await page.getByRole("button", { name: /泳道：/ }).evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.equal(await page.locator(".semlo-editor-canvas-lane-title").first().textContent(), "Lane 1");
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
    await page.locator(".semlo-editor-canvas-lane-title").first().dblclick();
    await page.getByLabel("编辑泳道 1 名称").fill("未保存");
    await page.getByLabel("编辑泳道 1 名称").press("Escape");
    assert.equal(await page.locator(".semlo-editor-canvas-lane-title").first().textContent(), "设计");
    assert.equal(
      await page.getByRole("button", { name: /泳道：/ }).evaluate((element) => element === document.activeElement),
      true,
    );
    await page.evaluate(() => {
      const outside = document.createElement("button");
      outside.textContent = "外部焦点目标";
      document.body.append(outside);
    });
    await page.locator(".semlo-editor-canvas-lane-title").first().dblclick();
    await page.getByLabel("编辑泳道 1 名称").fill("失焦保存");
    await page.getByRole("button", { name: "外部焦点目标" }).focus();
    assert.equal(await page.locator(".semlo-editor-canvas-lane-title").first().textContent(), "失焦保存");
    assert.equal(
      await page
        .getByRole("button", { name: "外部焦点目标" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: "外部焦点目标" }).evaluate((element) => element.remove());
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    await page.getByRole("button", { name: "泳道标题", exact: true }).click();
    await page.getByLabel("泳道 2 名称").fill("开发");
    await page.getByLabel("泳道 2 名称").evaluate((input) => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    });
    assert.equal(await page.getByLabel("泳道 2 名称").inputValue(), "开发");
    assert.equal(await page.getByLabel("泳道 2 名称").isVisible(), true);
    await page.getByLabel("泳道 2 名称").press("Enter");
    assert.equal(await page.locator(".semlo-editor-canvas-lane-title").nth(1).textContent(), "开发");
    await page.getByLabel("泳道数量").fill("2");
    await page.getByLabel("泳道数量").press("Tab");
    assert.equal(await page.locator(".semlo-editor-canvas-lane-title").count(), 2);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(await page.locator(".semlo-editor-canvas-lane-title").allTextContents(), [
      "设计",
      "开发",
      "Lane 3",
      "Lane 4",
    ]);
    await page.getByRole("button", { name: "描边", exact: true }).click();
    await page.getByRole("button", { name: "虚线描边" }).click();
    await page.getByRole("button", { name: "文字样式", exact: true }).click();
    await page.getByRole("button", { name: "加粗", exact: true }).click();
    assert.equal(
      await page
        .locator(".semlo-editor-canvas-lane-title")
        .first()
        .evaluate((element) => getComputedStyle(element).fontWeight),
      "400",
    );
    const laneSnapshot = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    assert.match(laneSnapshot.html, /设计/);
    assert.match(laneSnapshot.html, /stroke-dasharray="5 4"/);
    assert.match(laneSnapshot.html, /font-weight="normal"/);
    for (const content of [laneSnapshot.json, laneSnapshot.html]) {
      await page.evaluate(
        (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
        content,
      );
      assert.deepEqual(
        await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
        laneSnapshot.json,
      );
    }
    await chooseShape("rectangle");
    await page.locator(".semlo-editor-canvas-stage").click({ position: { x: 150, y: 180 } });
    const innerShape = page.locator(".semlo-editor-canvas-shape-rectangle").first();
    assert.equal(await innerShape.count(), 1);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      const document = structuredClone(editor.getJSON());
      window.__semloRequireValue(document.content?.[0]?.attrs, "canvas document attributes").data.shapes.push({
        id: "covered",
        shape: "rectangle",
        x: 670,
        y: 180,
        width: 80,
        height: 50,
        text: "已有图形",
      });
      editor.commands.setContent(document);
    });
    await page.locator(".semlo-editor-canvas-lane-title").first().click();
    assert.equal(await page.getByLabel("泳道数量").inputValue(), "4");
    await innerShape.click();
    assert.equal(await innerShape.getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: /泳道：/ }).press("Space");
    assert.equal(await page.getByLabel("泳道数量").inputValue(), "4");
    const beforeMove = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.equal(beforeMove[1].parentLane, beforeMove[0].id);
    assert.equal(beforeMove[2].parentLane, undefined);
    const withMember = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("mindmapTest").editor;
      return { json: editor.getJSON(), html: editor.getHTML() };
    });
    await page.evaluate(
      (value) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(value),
      withMember.html,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      withMember.json,
    );
    await page.locator(".semlo-editor-canvas-lane-title").first().click();
    await page.getByRole("button", { name: "图形：已有图形" }).click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "右对齐", exact: true }).click();
    const afterAlignment = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.ok(afterAlignment[0].x > beforeMove[0].x);
    assert.ok(Math.abs(afterAlignment[1].x - beforeMove[1].x - (afterAlignment[0].x - beforeMove[0].x)) < 1e-9);
    assert.equal(afterAlignment[2].x, beforeMove[2].x);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    await page.locator(".semlo-editor-canvas-lane-title").first().click();
    await page.evaluate(() => {
      const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
      const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
      selected.dispatchEvent(copy);
      const clipboard = copy.clipboardData!;
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: clipboard });
      selected.dispatchEvent(paste);
    });
    const copiedLaneData = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.equal(copiedLaneData.length, 5);
    assert.equal(copiedLaneData[4].parentLane, copiedLaneData[3].id);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    await page.locator(".semlo-editor-canvas-lane-title").first().click();
    const laneBorder = await page.locator(".semlo-editor-canvas-lane-border.is-top").boundingBox();
    assert.ok(laneBorder);
    await page.mouse.move(laneBorder.x + 25, laneBorder.y + laneBorder.height / 2);
    await page.mouse.down();
    await page.mouse.move(laneBorder.x + 55, laneBorder.y + laneBorder.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    const afterMove = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.ok(afterMove[0].x > beforeMove[0].x);
    assert.ok(Math.abs(afterMove[1].x - beforeMove[1].x - (afterMove[0].x - beforeMove[0].x)) < 1e-9);
    assert.ok(Math.abs(afterMove[1].y - beforeMove[1].y - (afterMove[0].y - beforeMove[0].y)) < 1e-9);
    assert.equal(afterMove[2].x, beforeMove[2].x);
    assert.equal(afterMove[2].y, beforeMove[2].y);
    const laneTitle = await page.locator(".semlo-editor-canvas-lane-title").first().boundingBox();
    assert.ok(laneTitle);
    await page.mouse.move(laneTitle.x + laneTitle.width / 2, laneTitle.y + laneTitle.height / 2);
    await page.mouse.down();
    await page.mouse.move(laneTitle.x + laneTitle.width / 2 + 20, laneTitle.y + laneTitle.height / 2, { steps: 4 });
    await page.mouse.up();
    const afterHeaderDrag = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.ok(afterHeaderDrag[0].x > afterMove[0].x);
    assert.ok(Math.abs(afterHeaderDrag[1].x - afterMove[1].x - (afterHeaderDrag[0].x - afterMove[0].x)) < 1e-9);
    assert.equal(afterHeaderDrag[2].x, beforeMove[2].x);
    const laneResize = await page
      .locator('.semlo-editor-canvas-shape[aria-pressed="true"] .semlo-editor-canvas-resize[data-corner="nw"]')
      .boundingBox();
    assert.ok(laneResize);
    await page.mouse.move(laneResize.x + laneResize.width / 2, laneResize.y + laneResize.height / 2);
    await page.mouse.down();
    await page.mouse.move(laneResize.x + laneResize.width / 2 + 10, laneResize.y + laneResize.height / 2 + 10, {
      steps: 4,
    });
    await page.mouse.up();
    const afterLaneResize = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.notEqual(afterLaneResize[0].width, afterHeaderDrag[0].width);
    assert.equal(afterLaneResize[1].x, afterHeaderDrag[1].x);
    assert.equal(afterLaneResize[1].y, afterHeaderDrag[1].y);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    await page.locator(".semlo-editor-canvas-lane-title").first().click();
    await innerShape.click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "编组", exact: true }).click();
    const laneGroup = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.groups[0],
    );
    assert.equal(laneGroup.members.length, 2);
    const groupBefore = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    const groupedHeader = await page.locator(".semlo-editor-canvas-lane-title").first().boundingBox();
    assert.ok(groupedHeader);
    await page.mouse.move(groupedHeader.x + groupedHeader.width / 2, groupedHeader.y + groupedHeader.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupedHeader.x + groupedHeader.width / 2 + 20, groupedHeader.y + groupedHeader.height / 2, {
      steps: 4,
    });
    await page.mouse.up();
    const groupAfter = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.ok(groupAfter[0].x > groupBefore[0].x);
    assert.ok(Math.abs(groupAfter[1].x - groupBefore[1].x - (groupAfter[0].x - groupBefore[0].x)) < 1e-9);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    const groupResize = await page.locator('.semlo-editor-canvas-group-resize[data-corner="nw"]').boundingBox();
    assert.ok(groupResize);
    await page.mouse.move(groupResize.x + groupResize.width / 2, groupResize.y + groupResize.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupResize.x + groupResize.width / 2 - 20, groupResize.y + groupResize.height / 2 - 20, {
      steps: 4,
    });
    await page.mouse.up();
    const groupScaled = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.notEqual(groupScaled[0].width, groupBefore[0].width);
    assert.notEqual(groupScaled[1].width, groupBefore[1].width);
    assert.equal(groupScaled[1].parentLane, groupScaled[0].id);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__semloRequireValue(
            window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
            "canvas document attributes",
          ).data.shapes,
      ),
      groupBefore,
    );
    await page.getByRole("button", { name: "适应画布" }).click();
    const groupRotate = await page.getByRole("button", { name: "旋转编组" }).boundingBox();
    assert.ok(groupRotate);
    await page.mouse.move(groupRotate.x + groupRotate.width / 2, groupRotate.y + groupRotate.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupRotate.x + groupRotate.width / 2 + 30, groupRotate.y + groupRotate.height / 2 + 10, {
      steps: 4,
    });
    await page.mouse.up();
    const groupRotated = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.ok(groupRotated[0].rotation);
    assert.equal(groupRotated[0].rotation, groupRotated[1].rotation);
    assert.equal(groupRotated[1].parentLane, groupRotated[0].id);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__semloRequireValue(
            window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
            "canvas document attributes",
          ).data.shapes,
      ),
      groupBefore,
    );
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    await page.locator(".semlo-editor-canvas-lane-title").first().click();
    await page.getByRole("button", { name: /泳道：/ }).press("Backspace");
    const afterLaneDelete = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.equal(afterLaneDelete.length, 2);
    assert.equal(afterLaneDelete[0].parentLane, undefined);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    const afterLaneUndo = await page.evaluate(
      () =>
        window.__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        ).data.shapes,
    );
    assert.equal(afterLaneUndo[1].parentLane, afterLaneUndo[0].id);
    await innerShape.click();
    await page.evaluate(() => {
      const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
      const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
      selected.dispatchEvent(copy);
      const clipboard = copy.clipboardData!;
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: clipboard });
      selected.dispatchEvent(paste);
    });
    const copiedMember = await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        )
        .data.shapes.at(-1),
    );
    assert.equal(copiedMember.parentLane, undefined);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    const covered = page.getByRole("button", { name: "图形：已有图形" });
    const coveredBox = await covered.boundingBox();
    const stageBox = await page.locator(".semlo-editor-canvas-stage").boundingBox();
    assert.ok(coveredBox && stageBox);
    await page.mouse.move(coveredBox.x + coveredBox.width / 2, coveredBox.y + coveredBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + stageBox.width * 0.4, stageBox.y + stageBox.height * 0.5, { steps: 4 });
    await page.mouse.up();
    const adopted = await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        )
        .data.shapes.find((shape: any) => shape.id === "covered"),
    );
    assert.equal(adopted.parentLane, afterLaneUndo[0].id);
    const adoptedBox = await covered.boundingBox();
    assert.ok(adoptedBox);
    await page.mouse.move(adoptedBox.x + adoptedBox.width / 2, adoptedBox.y + adoptedBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + stageBox.width * 0.95, stageBox.y + stageBox.height * 0.5, { steps: 4 });
    await page.mouse.up();
    const released = await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
          "canvas document attributes",
        )
        .data.shapes.find((shape: any) => shape.id === "covered"),
    );
    assert.equal(released.parentLane, undefined);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
    assert.equal(
      await page.evaluate(
        () =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("mindmapTest").editor.getJSON().content?.[0]?.attrs,
              "canvas document attributes",
            )
            .data.shapes.find((shape: any) => shape.id === "covered").parentLane,
      ),
      afterLaneUndo[0].id,
    );
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [{ id: "edge", shape: "rectangle", x: 680, y: 360, width: 80, height: 50, text: "边缘" }],
              edges: [],
            },
          },
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "图形：边缘" }).click();
  await page.getByRole("button", { name: "文字样式" }).click();
  const smallCanvas = await page.locator(".semlo-editor-canvas").boundingBox();
  const smallPanel = await page.locator(".semlo-editor-canvas-style-panel:visible").boundingBox();
  assert.ok(smallCanvas && smallPanel);
  assert.ok(smallPanel.x >= smallCanvas.x && smallPanel.x + smallPanel.width <= smallCanvas.x + smallCanvas.width);
  assert.ok(smallPanel.y >= smallCanvas.y && smallPanel.y + smallPanel.height <= smallCanvas.y + smallCanvas.height);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    editor.commands.setContent(editor.getJSON());
  });
  assert.equal(await page.getByRole("button", { name: "图形：边缘" }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "图形：边缘" }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    editor.commands.setContent(editor.getHTML());
  });
  assert.equal(await page.getByRole("button", { name: "图形：边缘" }).getAttribute("aria-pressed"), "false");
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [{ id: "edge", shape: "rectangle", x: 300, y: 200, width: 80, height: 50, text: "新文档" }],
              edges: [],
            },
          },
        },
      ],
    }),
  );
  assert.equal(await page.getByRole("button", { name: "图形：新文档" }).getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".semlo-editor-canvas-style-panel:visible").count(), 0);
  await page.locator(".semlo-editor-canvas-stage").press("Backspace");
  assert.equal(await page.getByRole("button", { name: "图形：新文档" }).count(), 1);
  const replaceLaneDocument = (label: string) =>
    page.evaluate(
      (value) =>
        window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
          type: "doc",
          content: [
            {
              type: "semloEditorCanvas",
              attrs: {
                kind: "board",
                data: {
                  shapes: [
                    {
                      id: "same-lane",
                      shape: "swimlaneVertical",
                      x: 100,
                      y: 80,
                      width: 300,
                      height: 220,
                      text: "",
                      lanes: [value],
                    },
                  ],
                  edges: [],
                },
              },
            },
          ],
        }),
      label,
    );
  await replaceLaneDocument("旧标题");
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("旧草稿");
  await replaceLaneDocument("新标题");
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").count(), 1);
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").textContent(), "新标题");
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("实体草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { replaceFirstWithSelf(): void };
    fixture.replaceFirstWithSelf();
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 1);
  assert.equal(await page.getByLabel("编辑泳道 1 名称").inputValue(), "实体草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      rebuildFirstNode(reentrant?: boolean): void;
    };
    fixture.rebuildFirstNode(true);
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  assert.equal(await page.getByRole("button", { name: /泳道：/ }).getAttribute("aria-pressed"), "false");
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("追加事务草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplace(content: unknown): void;
    };
    fixture.appendReplace(fixture.editor.getJSON());
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  assert.equal(await page.getByRole("button", { name: /泳道：/ }).getAttribute("aria-pressed"), "false");
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("追加事务草稿");
  const reusedLane = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReuse(intermediate?: boolean): void;
    };
    const previous = fixture.editor.state.doc.child(0);
    fixture.appendReuse();
    return fixture.editor.state.doc.child(0) === previous;
  });
  assert.equal(reusedLane, true);
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 1);
  assert.equal(await page.getByLabel("编辑泳道 1 名称").inputValue(), "追加事务草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplace(content: unknown): void;
    };
    const canvas = fixture.editor.getJSON().content![0];
    fixture.appendReplace({
      type: "doc",
      content: [canvas, { type: "paragraph", content: [{ type: "text", text: "追加后的正文" }] }],
    });
  });
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").count(), 1);
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").textContent(), "新标题");
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("事务还原草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      appendReuseAfterEdit(): void;
    };
    fixture.appendReuseAfterEdit();
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 1);
  assert.equal(await page.getByLabel("编辑泳道 1 名称").inputValue(), "事务还原草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      appendReuse(intermediate?: boolean): void;
    };
    fixture.appendReuse(true);
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 1);
  assert.equal(await page.getByLabel("编辑泳道 1 名称").inputValue(), "事务还原草稿");
  await page.getByLabel("编辑泳道 1 名称").press("Escape");
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("多步追加草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      editor: import("@tiptap/core").Editor;
      appendReplaceWithIntermediate(content: unknown): void;
    };
    const canvas = fixture.editor.getJSON().content![0];
    fixture.appendReplaceWithIntermediate({
      type: "doc",
      content: [canvas, { type: "paragraph", content: [{ type: "text", text: "多步替换后" }] }],
    });
  });
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").count(), 1);
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").textContent(), "新标题");
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const canvas = editor.getJSON().content![0];
    editor.commands.setContent({
      type: "doc",
      content: [canvas, { type: "paragraph", content: [{ type: "text", text: "正文 A" }] }],
    });
  });
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("局部替换草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { replaceFirstWithSelf(): void };
    fixture.replaceFirstWithSelf();
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").inputValue(), "局部替换草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as {
      rebuildFirstNode(reentrant: "edit"): void;
    };
    fixture.rebuildFirstNode("edit");
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  assert.equal(await page.getByRole("button", { name: /泳道：/ }).getAttribute("aria-pressed"), "false");
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("未提交草稿");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const canvas = editor.getJSON().content![0];
    editor.commands.setContent({
      type: "doc",
      content: [canvas, { type: "paragraph", content: [{ type: "text", text: "正文 B" }] }],
    });
  });
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").textContent(), "新标题");
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  await page.locator(".semlo-editor-canvas-lane-title").click();
  await page.getByRole("button", { name: "泳道标题" }).click();
  await page.getByLabel("泳道 1 名称").fill("面板未提交草稿");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mindmapTest").editor;
    const canvas = editor.getJSON().content![0];
    editor.commands.setContent({
      type: "doc",
      content: [canvas, { type: "paragraph", content: [{ type: "text", text: "正文 C" }] }],
    });
  });
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").textContent(), "新标题");
  await page.locator(".semlo-editor-canvas-lane-title").click();
  await page.getByRole("button", { name: "泳道标题" }).click();
  await page.getByLabel("泳道 1 名称").fill("面板旧草稿");
  await replaceLaneDocument("面板新标题");
  assert.equal(await page.locator(".semlo-editor-canvas-lane-title").textContent(), "面板新标题");
  const replaceShapeDocument = (text: string) =>
    page.evaluate(
      (value) =>
        window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
          type: "doc",
          content: [
            {
              type: "semloEditorCanvas",
              attrs: {
                kind: "board",
                data: {
                  shapes: [
                    { id: "same-shape", shape: "rectangle", x: 100, y: 80, width: 160, height: 100, text: value },
                  ],
                  edges: [],
                },
              },
            },
          ],
        }),
      text,
    );
  await replaceShapeDocument("旧图形");
  await page.getByRole("button", { name: "图形：旧图形" }).dblclick();
  await page.getByLabel("编辑图形文字").fill("图形旧草稿");
  await replaceShapeDocument("新图形");
  assert.equal(await page.getByRole("button", { name: "图形：新图形" }).count(), 1);
  assert.equal(await page.getByLabel("编辑图形文字").count(), 0);
  const replaceEdgeDocument = (text: string) =>
    page.evaluate(
      (value) =>
        window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
          type: "doc",
          content: [
            {
              type: "semloEditorCanvas",
              attrs: {
                kind: "board",
                data: {
                  shapes: [
                    { id: "a", shape: "rectangle", x: 100, y: 80, width: 100, height: 60, text: "A" },
                    { id: "b", shape: "rectangle", x: 350, y: 80, width: 100, height: 60, text: "B" },
                  ],
                  edges: [{ id: "same-edge", from: "a", to: "b", text: value, dashed: false, arrow: true }],
                },
              },
            },
          ],
        }),
      text,
    );
  await replaceEdgeDocument("旧连线");
  await page
    .locator(".semlo-editor-canvas-edge-hit")
    .evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.getByRole("button", { name: "连线标签" }).click();
  await page.getByLabel("连线文字").fill("连线旧草稿");
  await replaceEdgeDocument("新连线");
  assert.equal(await page.getByRole("button", { name: "连接线：新连线" }).count(), 1);
  await replaceLaneDocument("新标题");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { duplicateFirstNode(): void };
    fixture.duplicateFirstNode();
  });
  const twoCanvases = page.locator(".semlo-editor-canvas");
  assert.equal(await twoCanvases.count(), 2);
  assert.equal(
    await page.evaluate(() => {
      const doc = window.__semloRequireFixture("mindmapTest").editor.state.doc;
      return doc.child(0) === doc.child(2);
    }),
    true,
  );
  await twoCanvases.nth(0).locator(".semlo-editor-canvas-lane-title").click();
  await twoCanvases.nth(1).locator(".semlo-editor-canvas-lane-title").dblclick();
  await twoCanvases.nth(1).getByLabel("编辑泳道 1 名称").fill("第二个草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { rebuildLastNode(): void };
    fixture.rebuildLastNode();
  });
  assert.equal(await twoCanvases.nth(1).getByLabel("编辑泳道 1 名称").count(), 0);
  assert.equal(
    await twoCanvases
      .nth(1)
      .getByRole("button", { name: /泳道：/ })
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await twoCanvases.nth(0).locator(".semlo-editor-canvas-lane-title").textContent(), "新标题");
  assert.equal(
    await twoCanvases
      .nth(0)
      .getByRole("button", { name: /泳道：/ })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { moveFirstAfterParagraph(): void };
    fixture.moveFirstAfterParagraph();
  });
  await page.locator(".semlo-editor-canvas-lane-title").dblclick();
  await page.getByLabel("编辑泳道 1 名称").fill("位置变化草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { editLeadingText(): void };
    fixture.editLeadingText();
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").inputValue(), "位置变化草稿");
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("mindmapTest") as unknown as { rebuildNodeAfterTextEdit(): void };
    fixture.rebuildNodeAfterTextEdit();
  });
  assert.equal(await page.getByLabel("编辑泳道 1 名称").count(), 0);
  assert.equal(await page.getByRole("button", { name: /泳道：/ }).getAttribute("aria-pressed"), "false");
  await setKind("board");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("选择画布图片").setInputFiles({ name: "示例.png", mimeType: "image/png", buffer: png });
  const imageShape = page.getByRole("button", { name: "图片：示例.png" });
  await imageShape.waitFor();
  assert.equal(await imageShape.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth), 1);
  const imageDoc = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  const savedImage = requireCanvasAttrs(imageDoc).data.shapes[0];
  assert.match(savedImage.imageSrc, /^data:image\/png;base64,/);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.equal(await imageShape.count(), 0);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").redo()), true);
  assert.equal(await imageShape.count(), 1);
  await imageShape.press("ArrowRight");
  assert.equal(
    requireCanvasAttrs(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON())).data
      .shapes[0].x,
    savedImage.x + 1,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await imageShape.click();
  const imageResize = imageShape.locator('.semlo-editor-canvas-resize[data-corner="se"]');
  const resizeBox = await imageResize.boundingBox();
  assert.ok(resizeBox);
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 20, resizeBox.y + resizeBox.height / 2 + 20);
  await page.mouse.up();
  assert.ok(
    requireCanvasAttrs(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON())).data
      .shapes[0].width > savedImage.width,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await imageShape.click();
  const imageRotationHandle = await imageShape.locator(".semlo-editor-canvas-rotate").boundingBox();
  const imageBox = await imageShape.boundingBox();
  assert.ok(imageRotationHandle && imageBox);
  const rx = imageRotationHandle.x + imageRotationHandle.width / 2;
  const ry = imageRotationHandle.y + imageRotationHandle.height / 2;
  const imageCx = imageBox.x + imageBox.width / 2;
  const imageCy = imageBox.y + imageBox.height / 2;
  await page.mouse.move(rx, ry);
  await page.mouse.down();
  await page.mouse.move(imageCx - (ry - imageCy), imageCy + (rx - imageCx));
  await page.mouse.up();
  assert.ok(
    Math.abs(
      requireCanvasAttrs(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON())).data
        .shapes[0].rotation,
    ) > 80,
  );
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  const imageHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.match(imageHtml, /<image[^>]+href="data:image\/png;base64,/);
  await page.evaluate(
    (html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html),
    imageHtml,
  );
  assert.equal(await page.getByRole("button", { name: "图片：示例.png" }).count(), 1);
  await page.getByRole("button", { name: "图片：示例.png" }).click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: copy.clipboardData });
    document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(paste);
  });
  assert.equal(await page.getByRole("button", { name: "图片：示例.png" }).count(), 2);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.evaluate((doc) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(doc), imageDoc);
  assert.equal(await page.getByRole("button", { name: "图片：示例.png" }).count(), 1);
  await page
    .getByLabel("选择画布图片")
    .setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  assert.match((await page.getByRole("status").textContent()) ?? "", /不超过 4 MB/);
  await page
    .getByLabel("选择画布图片")
    .setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  assert.match((await page.getByRole("status").textContent()) ?? "", /PNG、JPEG、GIF 或 WebP/);
  await page.evaluate((doc) => {
    const source = structuredClone(doc);
    source.content![0].attrs!.data.shapes[0].imageSrc = "https://example.com/image.png";
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent(source);
  }, imageDoc);
  assert.match((await page.getByRole("status").last().textContent()) ?? "", /不受支持/);
  const encodedFormats = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/jpeg");
  });
  const formats = [
    { name: "image.jpg", mimeType: "image/jpeg", data: encodedFormats },
    {
      name: "image.webp",
      mimeType: "image/webp",
      data: "data:image/webp;base64,UklGRgYCAABXRUJQVlA4WAoAAAAgAAAAAQAAAQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggGAAAADABAJ0BKgIAAgABQCYlpAADcAD+/TZoAA==",
    },
    {
      name: "image.gif",
      mimeType: "image/gif",
      data: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    },
  ];
  for (const format of formats) {
    assert.ok(format.data.startsWith(`data:${format.mimeType};base64,`));
    await setKind("board");
    await page.getByLabel("选择画布图片").setInputFiles({
      name: format.name,
      mimeType: format.mimeType,
      buffer: Buffer.from(format.data.split(",")[1], "base64"),
    });
    await page.getByRole("button", { name: `图片：${format.name}` }).waitFor();
    assert.equal(
      requireCanvasAttrs(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON())).data
        .shapes[0].imageSrc,
      format.data,
    );
  }
  await setKind("board");
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  const pasteImage = await page.evaluate((base64) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    let bubbled = false;
    const listener = () => {
      bubbled = true;
    };
    document.addEventListener("paste", listener);
    document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(event);
    document.removeEventListener("paste", listener);
    return { prevented: event.defaultPrevented, bubbled };
  }, png.toString("base64"));
  assert.deepEqual(pasteImage, { prevented: true, bubbled: false });
  await page.getByRole("button", { name: "图片：pasted.png" }).waitFor();
  await setKind("board");
  const dropImage = await page.evaluate((base64) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    const stage = document.querySelector(".semlo-editor-canvas-stage")!;
    const box = stage.getBoundingClientRect();
    const drag = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer });
    const drop = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: box.left + box.width / 4,
      clientY: box.top + box.height / 4,
    });
    let bubbled = false;
    const listener = () => {
      bubbled = true;
    };
    document.addEventListener("drop", listener);
    stage.dispatchEvent(drag);
    stage.dispatchEvent(drop);
    document.removeEventListener("drop", listener);
    return {
      dragPrevented: drag.defaultPrevented,
      dropPrevented: drop.defaultPrevented,
      bubbled,
      x: ((drop.clientX - box.left) * 800) / box.width,
      y: ((drop.clientY - box.top) * 440) / box.height,
    };
  }, png.toString("base64"));
  assert.equal(dropImage.dragPrevented, true);
  assert.equal(dropImage.dropPrevented, true);
  assert.equal(dropImage.bubbled, false);
  await page.getByRole("button", { name: "图片：dropped.png" }).waitFor();
  const dropped = requireCanvasAttrs(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
  ).data.shapes[0];
  assert.ok(Math.abs(dropped.x + dropped.width / 2 - dropImage.x) < 0.01);
  assert.ok(Math.abs(dropped.y + dropped.height / 2 - dropImage.y) < 0.01);
  await setKind("board");
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="选择画布图片"]')!;
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [{ type: "semloEditorCanvas", attrs: { kind: "flowchart" } }],
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File(["<svg/>"], "late.svg", { type: "image/svg+xml" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.getByRole("status").count(), 0);
  await setKind("board");
  await page.evaluate((base64) => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      if (blob instanceof File && blob.name === "pending.png") {
        window.canvasReleasePending = () =>
          new Promise<void>((resolve) => {
            FileReader.prototype.readAsDataURL = read;
            this.addEventListener("loadend", () => resolve(), { once: true });
            read.call(this, blob);
          });
      } else read.call(this, blob);
    };
    const input = document.querySelector<HTMLInputElement>('input[aria-label="选择画布图片"]')!;
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    transfer.items.add(new File([bytes], "pending.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [{ type: "semloEditorCanvas", attrs: { kind: "flowchart" } }],
    });
    const nextInput = document.querySelector<HTMLInputElement>('input[aria-label="选择画布图片"]')!;
    const nextTransfer = new DataTransfer();
    nextTransfer.items.add(new File([bytes], "current.png", { type: "image/png" }));
    nextInput.files = nextTransfer.files;
    nextInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, png.toString("base64"));
  await page.getByRole("button", { name: "图片：current.png" }).waitFor();
  await page.evaluate(() => window.canvasReleasePending!());
  assert.equal(await page.getByRole("button", { name: "图片：pending.png" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /图片：/ }).count(), 1);
  await page.setViewportSize({ width: 1280, height: 900 });
  const laneDocument = {
    type: "doc",
    content: [
      {
        type: "semloEditorCanvas",
        attrs: {
          kind: "board",
          data: {
            shapes: [
              {
                id: "lane",
                shape: "swimlaneVertical",
                x: 100,
                y: 80,
                width: 300,
                height: 220,
                text: "",
                lanes: ["一", "二"],
              },
            ],
            strokes: [
              {
                id: "inside-stroke",
                points: [
                  { x: 160, y: 150 },
                  { x: 210, y: 170 },
                ],
                parentLane: "lane",
              },
              {
                id: "outside-stroke",
                points: [
                  { x: 500, y: 100 },
                  { x: 550, y: 120 },
                ],
              },
            ],
            edges: [
              {
                id: "inside-edge",
                from: "",
                to: "",
                fromPoint: { x: 180, y: 210 },
                toPoint: { x: 230, y: 230 },
                text: "",
                dashed: false,
                arrow: true,
                parentLane: "lane",
              },
              {
                id: "outside-edge",
                from: "",
                to: "",
                fromPoint: { x: 500, y: 200 },
                toPoint: { x: 550, y: 220 },
                text: "",
                dashed: false,
                arrow: true,
              },
            ],
          },
        },
      },
    ],
  };
  await page.evaluate(
    (content) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(content),
    laneDocument,
  );
  const laneState = () =>
    page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON().content![0].attrs!.data);
  const laneBefore = await laneState();
  assert.equal(laneBefore.strokes[0].parentLane, "lane");
  assert.equal(laneBefore.edges[0].parentLane, "lane");
  const laneHtml = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getHTML());
  assert.match(laneHtml, /data-canvas=/);
  assert.match(laneHtml, /<svg/);
  assert.match(laneHtml, /d="M 160 150 L 210 170"/);
  await page.evaluate((html) => window.__semloRequireFixture("mindmapTest").editor.commands.setContent(html), laneHtml);
  assert.deepEqual(await laneState(), laneBefore);
  await page.locator(".semlo-editor-canvas-lane-title").first().click();
  await page.getByRole("button", { name: "泳道：一、二" }).press("Shift+ArrowRight");
  const laneAfter = await laneState();
  assert.equal(laneAfter.shapes[0].x, laneBefore.shapes[0].x + 10);
  assert.equal(laneAfter.strokes[0].points[0].x, laneBefore.strokes[0].points[0].x + 10);
  assert.equal(laneAfter.edges[0].fromPoint.x, laneBefore.edges[0].fromPoint.x + 10);
  assert.deepEqual(laneAfter.strokes[1], laneBefore.strokes[1]);
  assert.deepEqual(laneAfter.edges[1], laneBefore.edges[1]);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.locator(".semlo-editor-canvas-lane-title").first().click();
  const memberLaneBorder = await page.locator(".semlo-editor-canvas-lane-border.is-top").boundingBox();
  assert.ok(memberLaneBorder);
  await page.mouse.move(memberLaneBorder.x + 40, memberLaneBorder.y + memberLaneBorder.height / 2);
  await page.mouse.down();
  await page.mouse.move(memberLaneBorder.x + 70, memberLaneBorder.y + memberLaneBorder.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  const draggedLane = await laneState();
  const deltaX = draggedLane.shapes[0].x - laneBefore.shapes[0].x;
  const deltaY = draggedLane.shapes[0].y - laneBefore.shapes[0].y;
  assert.ok(deltaX > 0);
  assert.ok(Math.abs(draggedLane.strokes[0].points[0].x - laneBefore.strokes[0].points[0].x - deltaX) < 1e-6);
  assert.ok(Math.abs(draggedLane.strokes[0].points[0].y - laneBefore.strokes[0].points[0].y - deltaY) < 1e-6);
  assert.ok(Math.abs(draggedLane.edges[0].fromPoint.x - laneBefore.edges[0].fromPoint.x - deltaX) < 1e-6);
  assert.ok(Math.abs(draggedLane.edges[0].fromPoint.y - laneBefore.edges[0].fromPoint.y - deltaY) < 1e-6);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  await page.locator(".semlo-editor-canvas-lane-title").first().click();
  await page.evaluate(() => {
    const selected = document.querySelector('.semlo-editor-canvas-shape[aria-pressed="true"]')!;
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    selected.dispatchEvent(copy);
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: copy.clipboardData });
    selected.dispatchEvent(paste);
  });
  const laneCopied = await laneState();
  assert.equal(laneCopied.shapes.length, 2);
  assert.equal(laneCopied.strokes.length, 3);
  assert.equal(laneCopied.edges.length, 3);
  assert.equal(laneCopied.strokes[2].parentLane, laneCopied.shapes[1].id);
  assert.equal(laneCopied.edges[2].parentLane, laneCopied.shapes[1].id);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  for (const [selector, collection] of [
    ['.semlo-editor-canvas-stroke-hit[data-stroke-id="inside-stroke"]', "strokes"],
    ['.semlo-editor-canvas-edge-hit[data-edge-id="inside-edge"]', "edges"],
  ] as const) {
    await page.locator(selector).evaluate((item) => item.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.evaluate((selector) => {
      const item = document.querySelector(selector)!;
      const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
      item.dispatchEvent(copy);
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: copy.clipboardData });
      document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(paste);
    }, selector);
    const copy = (await laneState())[collection].at(-1);
    assert.equal(copy.parentLane, undefined);
    assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  }
  await page.locator(".semlo-editor-canvas-lane-title").first().click();
  await page.getByRole("button", { name: "泳道：一、二" }).press("Delete");
  const laneDeleted = await laneState();
  assert.equal(laneDeleted.shapes.length, 0);
  assert.equal(laneDeleted.strokes[0].parentLane, undefined);
  assert.equal(laneDeleted.edges[0].parentLane, undefined);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(await laneState(), laneBefore);
  await page.evaluate((content) => {
    const document = structuredClone(content);
    document.content[0].attrs.data.strokes = [];
    document.content[0].attrs.data.edges = [];
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent(document);
  }, laneDocument);
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page.locator(".semlo-editor-canvas-stage").scrollIntoViewIfNeeded();
  const laneStageBox = await page.locator(".semlo-editor-canvas-stage").boundingBox();
  assert.ok(laneStageBox);
  const point = (x: number, y: number) => ({
    x: laneStageBox.x + (x * laneStageBox.width) / 800,
    y: laneStageBox.y + (y * laneStageBox.height) / 440,
  });
  const strokeStart = point(260, 220),
    strokeEnd = point(320, 240);
  await page.mouse.move(strokeStart.x, strokeStart.y);
  await page.mouse.down();
  await page.mouse.move(strokeEnd.x, strokeEnd.y, { steps: 4 });
  await page.mouse.up();
  assert.equal((await laneState()).strokes[0].parentLane, "lane");
  await page.getByRole("button", { name: "连线", exact: true }).click();
  const lineStart = point(160, 250),
    lineEnd = point(210, 270);
  await page.mouse.move(lineStart.x, lineStart.y);
  await page.mouse.down();
  await page.mouse.move(lineEnd.x, lineEnd.y, { steps: 4 });
  await page.mouse.up();
  assert.equal((await laneState()).edges[0].parentLane, "lane");
  const drawn = await laneState();
  await page.getByRole("button", { name: "泳道：一、二" }).press("Space");
  await page.getByRole("button", { name: "泳道：一、二" }).press("Shift+ArrowRight");
  const movedLane = await laneState();
  assert.equal(movedLane.strokes[0].points[0].x, drawn.strokes[0].points[0].x + 10);
  assert.equal(movedLane.edges[0].fromPoint.x, drawn.edges[0].fromPoint.x + 10);
  const laneStrokeHit = page.locator(".semlo-editor-canvas-stroke-hit[data-stroke-id]");
  const hitPoint = await laneStrokeHit.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(hitPoint.x, hitPoint.y);
  await page.mouse.down();
  await page.mouse.move(hitPoint.x + (300 * laneStageBox.width) / 800, hitPoint.y, { steps: 5 });
  await page.mouse.up();
  assert.equal((await laneState()).strokes[0].parentLane, undefined);
  await page
    .locator(".semlo-editor-canvas-edge-hit")
    .evaluate((edge) => edge.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.evaluate(() => {
    const stage = document.querySelector(".semlo-editor-canvas-stage")!;
    for (let index = 0; index < 25; index++)
      stage.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }),
      );
  });
  assert.equal((await laneState()).edges[0].parentLane, undefined);
  await page.evaluate((base64) => {
    const stage = document.querySelector(".semlo-editor-canvas-stage")!;
    const box = stage.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "lane.png", { type: "image/png" }),
    );
    stage.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: box.left + (200 * box.width) / 800,
        clientY: box.top + (180 * box.height) / 440,
      }),
    );
  }, png.toString("base64"));
  await page.getByRole("button", { name: "图片：lane.png" }).waitFor();
  assert.equal(
    (await laneState()).shapes.find((shape: { shape: string }) => shape.shape === "image").parentLane,
    "lane",
  );
  await page.evaluate((content) => {
    const document = structuredClone(content);
    document.content[0].attrs.data.shapes.push({
      id: "outside",
      shape: "rectangle",
      x: 520,
      y: 100,
      width: 80,
      height: 60,
      text: "外部",
    } as never);
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent(document);
  }, laneDocument);
  await page.locator(".semlo-editor-canvas-lane-title").first().click();
  await page.getByRole("button", { name: "图形：外部" }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "编组", exact: true }).click();
  const laneGroupedBefore = await laneState();
  const laneGroupResize = await page.locator('.semlo-editor-canvas-group-resize[data-corner="nw"]').boundingBox();
  assert.ok(laneGroupResize);
  await page.mouse.move(laneGroupResize.x + laneGroupResize.width / 2, laneGroupResize.y + laneGroupResize.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    laneGroupResize.x + laneGroupResize.width / 2 - 30,
    laneGroupResize.y + laneGroupResize.height / 2 - 30,
    { steps: 5 },
  );
  await page.mouse.up();
  const laneGroupedScaled = await laneState();
  assert.notDeepEqual(laneGroupedScaled.strokes[0].points, laneGroupedBefore.strokes[0].points);
  assert.notDeepEqual(laneGroupedScaled.edges[0].fromPoint, laneGroupedBefore.edges[0].fromPoint);
  assert.deepEqual(laneGroupedScaled.strokes[1], laneGroupedBefore.strokes[1]);
  assert.deepEqual(laneGroupedScaled.edges[1], laneGroupedBefore.edges[1]);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(await laneState(), laneGroupedBefore);
  const laneGroupRotate = await page.getByRole("button", { name: "旋转编组" }).boundingBox();
  assert.ok(laneGroupRotate);
  await page.mouse.move(laneGroupRotate.x + laneGroupRotate.width / 2, laneGroupRotate.y + laneGroupRotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    laneGroupRotate.x + laneGroupRotate.width / 2 + 30,
    laneGroupRotate.y + laneGroupRotate.height / 2 + 10,
    { steps: 5 },
  );
  await page.mouse.up();
  const laneGroupedRotated = await laneState();
  assert.notDeepEqual(laneGroupedRotated.strokes[0].points, laneGroupedBefore.strokes[0].points);
  assert.notDeepEqual(laneGroupedRotated.edges[0].fromPoint, laneGroupedBefore.edges[0].fromPoint);
  assert.deepEqual(laneGroupedRotated.strokes[1], laneGroupedBefore.strokes[1]);
  assert.deepEqual(laneGroupedRotated.edges[1], laneGroupedBefore.edges[1]);
  assert.equal(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").undo()), true);
  assert.deepEqual(await laneState(), laneGroupedBefore);
  await page.evaluate((content) => {
    const document = structuredClone(content);
    document.content[0].attrs.data.shapes.push({
      id: "attached",
      shape: "rectangle",
      x: 200,
      y: 150,
      width: 80,
      height: 50,
      text: "待删除",
      parentLane: "lane",
    } as never);
    document.content[0].attrs.data.edges = [
      {
        id: "detached",
        from: "attached",
        to: "",
        toPoint: { x: 320, y: 210 },
        text: "",
        dashed: false,
        arrow: true,
      } as never,
    ];
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent(document);
  }, laneDocument);
  await page.getByRole("button", { name: "图形：待删除" }).click();
  await page.getByRole("button", { name: "图形：待删除" }).press("Delete");
  const detachedInLane = (await laneState()).edges[0];
  assert.equal(detachedInLane.from, "");
  assert.equal(detachedInLane.to, "");
  assert.equal(detachedInLane.parentLane, "lane");
  await page.getByRole("button", { name: "泳道：一、二" }).press("Space");
  await page.getByRole("button", { name: "泳道：一、二" }).press("Shift+ArrowRight");
  assert.equal((await laneState()).edges[0].fromPoint.x, detachedInLane.fromPoint.x + 10);
  for (const bad of ["stroke", "edge"] as const) {
    await page.evaluate(
      ({ content, bad }) => {
        const document = structuredClone(content);
        if (bad === "stroke") document.content[0].attrs.data.strokes[0].parentLane = "missing";
        else document.content[0].attrs.data.edges[0].from = "lane";
        window.__semloRequireFixture("mindmapTest").editor.commands.setContent(document);
      },
      { content: laneDocument, bad },
    );
    assert.match((await page.getByRole("status").textContent()) ?? "", /不受支持/);
    const unsupported = await laneState();
    if (bad === "stroke") assert.equal(unsupported.strokes[0].parentLane, "missing");
    else assert.equal(unsupported.edges[0].from, "lane");
  }
  for (const mode of ["select", "pan"] as const) {
    await page.evaluate(() =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data: { shapes: [], edges: [] } } }],
      }),
    );
    if (mode === "pan") await page.getByRole("button", { name: "平移", exact: true }).click();
    const stage = page.locator(".semlo-editor-canvas-stage");
    const target = mode === "pan" ? page.locator(".semlo-editor-canvas-viewport") : stage;
    const box = await stage.boundingBox();
    assert.ok(box);
    const before = await stage.evaluate((element) => (element as HTMLElement).style.transform);
    const original = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
    await target.evaluate((element) =>
      element.addEventListener(
        "pointerdown",
        (event) => {
          window.canvasNavigationPointerId = (event as PointerEvent).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 130);
    if (mode === "pan")
      assert.notEqual(await stage.evaluate((element) => (element as HTMLElement).style.transform), before);
    else assert.equal(await page.locator(".semlo-editor-canvas-marquee").count(), 1);
    await target.evaluate((element) => element.releasePointerCapture(window.canvasNavigationPointerId!));
    await page.mouse.move(1, 1);
    await page.mouse.up();
    if (mode === "pan")
      assert.equal(await stage.evaluate((element) => (element as HTMLElement).style.transform), before);
    else assert.equal(await page.locator(".semlo-editor-canvas-marquee").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), original);
  }
  for (const name of ["画笔", "连线"] as const) {
    await page.evaluate(() =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data: { shapes: [], edges: [] } } }],
      }),
    );
    await page.getByRole("button", { name, exact: true }).click();
    const drawStage = page.locator(".semlo-editor-canvas-stage");
    const drawSvg = drawStage.locator("svg").first();
    const beforePaths = await drawSvg.locator("path").count();
    const drawBox = await drawStage.boundingBox();
    assert.ok(drawBox);
    const original = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
    await drawStage.evaluate((element) =>
      element.addEventListener(
        "pointerdown",
        (event) => {
          window.canvasDrawPointerId = (event as PointerEvent).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(drawBox.x + 100, drawBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(drawBox.x + 160, drawBox.y + 130);
    assert.ok((await drawSvg.locator("path").count()) > beforePaths);
    await drawStage.evaluate((element) => element.releasePointerCapture(window.canvasDrawPointerId!));
    await page.mouse.move(1, 1);
    await page.mouse.up();
    assert.equal(await drawSvg.locator("path").count(), beforePaths);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), original);
  }
  for (const mode of ["resize", "rotate"] as const) {
    await page.evaluate(() =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "semloEditorCanvas",
            attrs: {
              kind: "board",
              data: {
                shapes: [
                  { id: "a", shape: "rectangle", x: 150, y: 130, width: 120, height: 80, text: "A" },
                  { id: "b", shape: "rectangle", x: 350, y: 130, width: 120, height: 80, text: "B" },
                ],
                edges: [],
              },
            },
          },
        ],
      }),
    );
    const a = page.getByRole("button", { name: "图形：A" });
    const b = page.getByRole("button", { name: "图形：B" });
    await a.click();
    await b.click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "编组", exact: true }).click();
    const before = await a.boundingBox();
    assert.ok(before);
    const original = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
    const handle =
      mode === "resize"
        ? page.locator('.semlo-editor-canvas-group-resize[data-corner="se"]')
        : page.getByRole("button", { name: "旋转编组" });
    const position = await handle.boundingBox();
    assert.ok(position);
    await handle.evaluate((element) =>
      element.addEventListener(
        "pointerdown",
        (event) => {
          window.canvasGroupPointerId = (event as PointerEvent).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
    await page.mouse.down();
    await page.mouse.move(position.x + position.width / 2 + 60, position.y + position.height / 2 + 30);
    const preview = await a.boundingBox();
    assert.ok(preview);
    assert.notDeepEqual(preview, before);
    await handle.evaluate((element) => element.releasePointerCapture(window.canvasGroupPointerId!));
    await page.mouse.move(1, 1);
    await page.mouse.up();
    const after = await a.boundingBox();
    assert.ok(after);
    assert.ok(Math.abs(after.x - before.x) < 1 && Math.abs(after.width - before.width) < 1);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), original);
  }
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data: { shapes: [], edges: [] } } }],
    }),
  );
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  const eraserStage = page.locator(".semlo-editor-canvas-stage");
  const eraserBox = await eraserStage.boundingBox();
  assert.ok(eraserBox);
  await page.mouse.move(eraserBox.x + 100, eraserBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(eraserBox.x + 160, eraserBox.y + 100);
  await page.mouse.up();
  const beforeErase = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  await page.getByRole("button", { name: "橡皮", exact: true }).click();
  await eraserStage.evaluate((element) =>
    element.addEventListener(
      "pointerdown",
      (event) => {
        window.canvasDrawPointerId = (event as PointerEvent).pointerId;
      },
      { once: true },
    ),
  );
  await page.mouse.move(eraserBox.x + 120, eraserBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(eraserBox.x + 125, eraserBox.y + 100);
  assert.equal(
    await eraserStage
      .locator(".semlo-editor-canvas-stroke")
      .first()
      .evaluate((element) => (element as SVGElement).style.opacity),
    "0.2",
  );
  await eraserStage.evaluate((element) => element.releasePointerCapture(window.canvasDrawPointerId!));
  await page.mouse.move(1, 1);
  await page.mouse.up();
  assert.notEqual(
    await eraserStage
      .locator(".semlo-editor-canvas-stroke")
      .first()
      .evaluate((element) => (element as SVGElement).style.opacity),
    "0.2",
  );
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    beforeErase,
  );
  await page.mouse.move(eraserBox.x + 120, eraserBox.y + 100);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(await eraserStage.locator(".semlo-editor-canvas-stroke").count(), 0);
  for (const mode of ["stroke", "endpoint", "bend", "connect"] as const) {
    await page.evaluate(() =>
      window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "semloEditorCanvas",
            attrs: {
              kind: "board",
              data: {
                shapes: [{ id: "a", shape: "rectangle", x: 150, y: 130, width: 120, height: 80, text: "A" }],
                edges: [],
              },
            },
          },
        ],
      }),
    );
    const lineStage = page.locator(".semlo-editor-canvas-stage");
    const box = await lineStage.boundingBox();
    assert.ok(box);
    if (mode !== "connect") {
      await page.getByRole("button", { name: mode === "stroke" ? "画笔" : "连线", exact: true }).click();
      await page.mouse.move(box.x + 300, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 450, box.y + 150);
      await page.mouse.up();
    }
    if (mode === "stroke") await page.getByRole("button", { name: "选择", exact: true }).click();
    if (mode === "connect") await page.getByRole("button", { name: "连线", exact: true }).click();
    const target =
      mode === "stroke"
        ? lineStage.locator(".semlo-editor-canvas-stroke-hit").first()
        : mode === "endpoint"
          ? page.getByRole("button", { name: "连接线终点" })
          : mode === "bend"
            ? page.getByRole("button", { name: "调整折线拐点" })
            : page.getByRole("button", { name: "图形：A" });
    const original = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
    const path = lineStage
      .locator(mode === "stroke" ? ".semlo-editor-canvas-stroke" : ".semlo-editor-canvas-edge")
      .first();
    const before = (await path.count()) ? await path.getAttribute("d") : null;
    const pathCount = await lineStage.locator("svg path").count();
    const targetBox = await target.boundingBox();
    assert.ok(targetBox);
    const x = targetBox.x + targetBox.width / 2,
      y = targetBox.y + targetBox.height / 2;
    await target.evaluate((element) =>
      element.addEventListener(
        "pointerdown",
        (event) => {
          window.canvasDrawPointerId = (event as PointerEvent).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 30);
    if (mode === "connect") assert.ok((await lineStage.locator("svg path").count()) > pathCount);
    else assert.notEqual(await path.getAttribute("d"), before);
    await target.evaluate((element) => element.releasePointerCapture(window.canvasDrawPointerId!));
    await page.mouse.move(1, 1);
    await page.mouse.up();
    if (mode === "connect") assert.equal(await lineStage.locator("svg path").count(), pathCount);
    else assert.equal(await path.getAttribute("d"), before);
    assert.deepEqual(await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()), original);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 30);
    await page.mouse.up();
    assert.notDeepEqual(
      await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
      original,
    );
  }
  await page.evaluate(() =>
    window.__semloRequireFixture("mindmapTest").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorCanvas",
          attrs: {
            kind: "board",
            data: {
              shapes: [{ id: "a", shape: "rectangle", x: 150, y: 130, width: 120, height: 80, text: "A" }],
              edges: [],
            },
          },
        },
      ],
    }),
  );
  const edgeStage = page.locator(".semlo-editor-canvas-stage");
  const edgeStageBox = await edgeStage.boundingBox();
  assert.ok(edgeStageBox);
  await page.getByRole("button", { name: "连线", exact: true }).click();
  await page.mouse.move(edgeStageBox.x + 300, edgeStageBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(edgeStageBox.x + 450, edgeStageBox.y + 150);
  await page.mouse.up();
  await page.getByRole("button", { name: "图形：A" }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "编组", exact: true }).click();
  const groupedEdgeHit = edgeStage.locator(".semlo-editor-canvas-edge-hit").first();
  const edgePath = edgeStage.locator(".semlo-editor-canvas-edge").first();
  const groupedEdgeBefore = await edgePath.getAttribute("d");
  const edgeOriginal = await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON());
  await groupedEdgeHit.evaluate((element) =>
    element.addEventListener(
      "pointerdown",
      (event) => {
        window.canvasDrawPointerId = (event as PointerEvent).pointerId;
      },
      { once: true },
    ),
  );
  const edgeX = edgeStageBox.x + 330,
    edgeY = edgeStageBox.y + 100;
  await page.mouse.move(edgeX, edgeY);
  await page.mouse.down();
  await page.mouse.move(edgeX + 40, edgeY + 30);
  assert.notEqual(await edgePath.getAttribute("d"), groupedEdgeBefore);
  await groupedEdgeHit.evaluate((element) => element.releasePointerCapture(window.canvasDrawPointerId!));
  await page.mouse.move(1, 1);
  await page.mouse.up();
  assert.equal(await edgePath.getAttribute("d"), groupedEdgeBefore);
  assert.deepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    edgeOriginal,
  );
  await page.mouse.move(edgeX, edgeY);
  await page.mouse.down();
  await page.mouse.move(edgeX + 40, edgeY + 30);
  await page.mouse.up();
  assert.notDeepEqual(
    await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.getJSON()),
    edgeOriginal,
  );
  await page.evaluate(() => window.__semloRequireFixture("mindmapTest").editor.destroy());
  console.log("canvas: templates, create, edit, connect, drag, delete, undo, JSON/HTML and read-only passed");
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
