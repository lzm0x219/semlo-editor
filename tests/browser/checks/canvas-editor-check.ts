// Build with tests/config/canvas-editor-rsbuild.config.ts and set CANVAS_EDITOR_TEST_DIR.
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize } from "node:path";

import { chromium } from "playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime.ts";

declare global {
  interface Window {
    canvasReplacementCount?: number;
    canvasReplacementListener?: EventListener;
    canvasUploadCount(): number;
  }
}

const root = process.env.CANVAS_EDITOR_TEST_DIR!;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^\/+/, "") || "index.html";
  try {
    const data = await readFile(join(root, path));
    const mime = path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
    res.setHeader("Content-Type", mime);
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
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForSelector(".semlo-editor-prose p");
  const cases = [
    ["canvas", "board", 0],
    ["mindmap", "mindmap", 4],
    ["flowchart", "flowchart", 5],
    ["uml", "uml", 9],
  ] as const;
  for (const [command, kind, count] of cases) {
    await page.evaluate(() => window.__semloRequireFixture("canvasEditor").setContent("<p>正文</p>"));
    await page.locator(".semlo-editor-prose p").first().click();
    await page.getByRole("button", { name: "插入内容" }).click();
    const menu = page.getByRole("dialog", { name: "插入内容" });
    const item = menu.locator(`[data-command="${command}"]`);
    assert.equal(await item.isEnabled(), true, `${kind} menu entry`);
    await item.click();
    const node = page.locator(kind === "mindmap" ? ".semlo-editor-mindmap" : ".semlo-editor-canvas");
    await node.waitFor({ state: "visible" });
    assert.equal(
      await node.locator(kind === "mindmap" ? ".semlo-editor-mindmap-label" : ".semlo-editor-canvas-shape").count(),
      count,
    );
    const inserted = await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot());
    const insertedNode = inserted.json.content?.find(
      (entry) => entry.type === (kind === "mindmap" ? "semloEditorMindmap" : "semloEditorCanvas"),
    );
    assert.ok(insertedNode?.attrs?.[kind === "mindmap" ? "tree" : "data"], `${kind} initial data frozen`);
    for (const initialContent of [inserted.json, inserted.html]) {
      await page.evaluate((value) => window.__semloRequireFixture("canvasEditor").setContent(value), initialContent);
      assert.deepEqual(
        await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot().json),
        inserted.json,
        `${kind} untouched round trip`,
      );
    }
    if (kind === "mindmap") {
      await node.locator(".semlo-editor-mindmap-label").nth(1).dblclick();
      await node.getByLabel("编辑节点").fill("验证分支");
      await node.getByLabel("编辑节点").press("Enter");
      await node.getByRole("button", { name: "节点：验证分支" }).press("Tab");
      await node.getByLabel("编辑节点").fill("下级");
      await node.getByLabel("编辑节点").press("Enter");
      await node.getByRole("button", { name: "折叠分支" }).click();
      assert.equal(await node.getByRole("button", { name: "展开分支" }).textContent(), "1");
    } else if (kind === "board") {
      await node.getByRole("button", { name: "更多形状", exact: true }).click();
      await node.getByRole("dialog", { name: "图形库" }).locator('[data-shape-tool="rectangle"]').first().click();
      await node.locator(".semlo-editor-canvas-stage").click({ position: { x: 200, y: 100 } });
      assert.equal(await node.locator(".semlo-editor-canvas-shape").count(), 1);
      await node.getByRole("button", { name: "画笔", exact: true }).click();
      const box = await node.locator(".semlo-editor-canvas-stage").boundingBox();
      if (!box) throw new Error("missing canvas");
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 60, { steps: 6 });
      await page.mouse.up();
      assert.equal(await node.locator(".semlo-editor-canvas-stroke").count(), 1);
    } else {
      await node.locator(".semlo-editor-canvas-shape").first().dblclick();
      await node.getByLabel("编辑图形文字").fill("验证图形");
      await node.getByLabel("编辑图形文字").press("Tab");
    }
    const height = node.getByRole("separator", { name: "调整画布高度" });
    await height.focus();
    await height.press("ArrowDown");
    assert.equal(await height.getAttribute("aria-valuenow"), "470");
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot());
    {
      const staticSvg = await page.evaluate(
        ({ html, kind }) => {
          const selector =
            kind === "mindmap" ? "figure[data-semlo-editor-mindmap] svg" : "figure[data-semlo-editor-canvas] svg";
          const element = new DOMParser().parseFromString(html, "text/html").querySelector(selector);
          return { namespace: element?.namespaceURI, count: element?.children.length };
        },
        { html: snapshot.html, kind },
      );
      assert.equal(staticSvg.namespace, "http://www.w3.org/2000/svg");
      assert.ok((staticSvg.count ?? 0) > 0);
    }
    assert.equal(
      await page.evaluate(() => window.__semloRequireFixture("canvasEditor").editor.commands.undo()),
      true,
      `${kind} undo`,
    );
    assert.equal(
      await page.evaluate(() => window.__semloRequireFixture("canvasEditor").editor.commands.redo()),
      true,
      `${kind} redo`,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot().json),
      snapshot.json,
      `${kind} redo restores edit`,
    );
    for (const content of [snapshot.json, snapshot.html]) {
      await page.reload();
      await page.waitForSelector(".semlo-editor-prose p");
      await page.evaluate((value) => window.__semloRequireFixture("canvasEditor").setContent(value), content);
      const restored = await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot());
      assert.deepEqual(restored.json, snapshot.json, `${kind} round trip`);
      assert.equal(await height.getAttribute("aria-valuenow"), "470");
      if (kind === "mindmap") assert.equal(await node.getByRole("button", { name: "展开分支" }).textContent(), "1");
      if (kind === "board") assert.equal(await node.locator(".semlo-editor-canvas-stroke").count(), 1);
    }
    await page.evaluate(() => window.__semloRequireFixture("canvasEditor").setEditable(false));
    if (kind === "mindmap") {
      await node.locator(".semlo-editor-mindmap-label").nth(1).dblclick();
      assert.equal(await node.getByLabel("编辑节点").count(), 0);
      assert.equal(await node.getByLabel("添加下级节点").count(), 0);
    } else {
      assert.equal(await node.getByRole("button", { name: "更多形状", exact: true }).isDisabled(), true);
      assert.equal(await node.getByRole("button", { name: "放大画布" }).isEnabled(), true);
    }
    await page.evaluate(() => window.__semloRequireFixture("canvasEditor").setEditable(true));
    if (kind !== "mindmap")
      assert.equal(await node.getByRole("button", { name: "更多形状", exact: true }).isEnabled(), true);
    console.log(`${kind}: menu insertion, editing, undo/redo, reload JSON/HTML restore, read-only passed`);
  }
  for (const kind of ["board", "mindmap"] as const) {
    await page.evaluate((value) => {
      const controller = window.__semloRequireFixture("canvasEditor");
      const canvas =
        value === "board"
          ? {
              type: "semloEditorCanvas",
              attrs: {
                kind: "board",
                data: {
                  shapes: [{ id: "same", shape: "rectangle", x: 100, y: 100, width: 160, height: 80, text: "原图形" }],
                  edges: [],
                },
              },
            }
          : {
              type: "semloEditorMindmap",
              attrs: { tree: { text: "根节点", children: [{ text: "原节点", children: [] }] } },
            };
      controller.setContent({
        type: "doc",
        content: [canvas, { type: "paragraph", content: [{ type: "text", text: "正文 A" }] }],
      });
      window.canvasReplacementCount = 0;
      const previous = window.canvasReplacementListener;
      if (previous) controller.editor.view.dom.removeEventListener("semlo-editor:document-replace", previous);
      const listener = () => {
        window.canvasReplacementCount = (window.canvasReplacementCount ?? 0) + 1;
      };
      window.canvasReplacementListener = listener;
      controller.editor.view.dom.addEventListener("semlo-editor:document-replace", listener);
    }, kind);
    const target =
      kind === "board"
        ? page.getByRole("button", { name: "图形：原图形" })
        : page.getByRole("button", { name: "节点：原节点" });
    const input = page.getByLabel(kind === "board" ? "编辑图形文字" : "编辑节点");
    await target.dblclick();
    await input.fill("未提交草稿");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("canvasEditor");
      const snapshot = controller.getSnapshot();
      controller.setContent(snapshot.json);
      controller.setContent(snapshot.html);
    });
    assert.equal(await input.inputValue(), "未提交草稿", `${kind} equal controller writes preserve draft`);
    assert.equal(await page.evaluate(() => window.canvasReplacementCount), 0);
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("canvasEditor");
      const canvas = controller.getSnapshot().json.content![0];
      controller.setContent({
        type: "doc",
        content: [canvas, { type: "paragraph", content: [{ type: "text", text: "正文 B" }] }],
      });
    });
    assert.equal(await page.evaluate(() => window.canvasReplacementCount), 1);
    assert.equal(await target.count(), 1, `${kind} replacement must not commit the old draft`);
    assert.equal(await input.count(), 0);
    assert.equal(await target.getAttribute("aria-pressed"), "false");
  }
  const laneData = {
    shapes: [
      { id: "lane", shape: "swimlaneVertical", x: 100, y: 80, width: 300, height: 220, text: "", lanes: ["一"] },
    ],
    strokes: [
      {
        id: "stroke",
        points: [
          { x: 150, y: 150 },
          { x: 200, y: 170 },
        ],
        parentLane: "lane",
      },
    ],
    edges: [
      {
        id: "edge",
        from: "",
        to: "",
        fromPoint: { x: 180, y: 200 },
        toPoint: { x: 220, y: 220 },
        text: "",
        dashed: false,
        arrow: true,
        parentLane: "lane",
      },
    ],
  };
  await page.evaluate(
    (data) =>
      window
        .__semloRequireFixture("canvasEditor")
        .setContent({ type: "doc", content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }] }),
    laneData,
  );
  await page.getByRole("button", { name: "泳道：一" }).press("Space");
  await page.getByRole("button", { name: "泳道：一" }).press("Shift+ArrowRight");
  const laneSnapshot = await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot());
  const laneActual = laneSnapshot.json.content![0].attrs!.data;
  assert.equal(laneActual.strokes[0].points[0].x, 160);
  assert.equal(laneActual.edges[0].fromPoint.x, 190);
  await page.reload();
  await page.waitForSelector(".semlo-editor-prose p");
  await page.evaluate((html) => window.__semloRequireFixture("canvasEditor").setContent(html), laneSnapshot.html);
  assert.deepEqual(
    (await page.evaluate(() => window.__semloRequireFixture("canvasEditor").getSnapshot())).json,
    laneSnapshot.json,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("canvasEditor")
      .setContent({ type: "doc", content: [{ type: "semloEditorCanvas", attrs: { kind: "board" } }] }),
  );
  const pngData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII=";
  await page
    .getByLabel("选择画布图片")
    .setInputFiles({ name: "local.png", mimeType: "image/png", buffer: Buffer.from(pngData, "base64") });
  await page.getByRole("button", { name: "图片：local.png" }).waitFor();
  for (const kind of ["paste", "drop"] as const) {
    await page.evaluate(
      ({ base64, kind }) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], `${kind}.png`, { type: "image/png" }));
        const event =
          kind === "paste"
            ? new ClipboardEvent("paste", { bubbles: true, cancelable: true })
            : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
        if (kind === "paste") Object.defineProperty(event, "clipboardData", { value: transfer });
        document.querySelector(".semlo-editor-canvas-stage")!.dispatchEvent(event);
      },
      { base64: pngData, kind },
    );
    await page.getByRole("button", { name: `图片：${kind}.png` }).waitFor();
  }
  assert.equal(await page.evaluate(() => window.canvasUploadCount()), 0);
  await page.evaluate((data) => {
    const controller = window.__semloRequireFixture("canvasEditor");
    controller.setContent({ type: "doc", content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }] });
    const replace = () => {
      controller.editor.off("update", replace);
      controller.setContent("<p>替换后的文档</p>");
    };
    controller.editor.on("update", replace);
  }, laneData);
  await page.getByRole("button", { name: "泳道：一" }).press("Space");
  await page.getByRole("button", { name: "泳道：一" }).press("Shift+ArrowRight");
  assert.equal(await page.locator(".semlo-editor-canvas").count(), 0);
  assert.match((await page.locator(".semlo-editor-prose").textContent()) ?? "", /替换后的文档/);
  await page.evaluate((data) => {
    const controller = window.__semloRequireFixture("canvasEditor");
    controller.setContent({ type: "doc", content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }] });
    const replace = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      if (!transaction.docChanged) return;
      controller.editor.off("transaction", replace);
      controller.setContent("<p>事务中的新文档</p>");
    };
    controller.editor.on("transaction", replace);
  }, laneData);
  await page.getByRole("button", { name: "泳道：一" }).press("Space");
  await page.getByRole("button", { name: "泳道：一" }).press("Shift+ArrowRight");
  assert.equal(await page.locator(".semlo-editor-canvas").count(), 0);
  assert.match((await page.locator(".semlo-editor-prose").textContent()) ?? "", /事务中的新文档/);
  await page.evaluate((data) => {
    const controller = window.__semloRequireFixture("canvasEditor");
    controller.setContent({ type: "doc", content: [{ type: "semloEditorCanvas", attrs: { kind: "board", data } }] });
    const replace = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      if (!transaction.docChanged) return;
      controller.editor.off("transaction", replace);
      controller.setContent("<p>拖动后的新文档</p>");
    };
    controller.editor.on("transaction", replace);
  }, laneData);
  const movingBorder = await page.locator(".semlo-editor-canvas-lane-border.is-top").boundingBox();
  assert.ok(movingBorder);
  await page.mouse.move(movingBorder.x + 20, movingBorder.y + movingBorder.height / 2);
  await page.mouse.down();
  await page.mouse.move(movingBorder.x + 60, movingBorder.y + movingBorder.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.locator(".semlo-editor-canvas").count(), 0);
  assert.match((await page.locator(".semlo-editor-prose").textContent()) ?? "", /拖动后的新文档/);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__semloRequireFixture("canvasEditor").destroy());
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
