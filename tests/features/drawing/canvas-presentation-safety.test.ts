import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {} from "../../fixtures/browser/core-source-entry";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
beforeAll(async () => {
  server = await startCoreSourceServer();
});
afterAll(async () => server.stop());

test("unsupported canvas and mindmap presentation values survive HTML round trips", async ({ page }) => {
  await page.goto(server.origin);
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = window.semloSourceCreateEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "semloEditorCanvas",
            attrs: { kind: "future-kind", height: 5000, data: { shapes: [], edges: [] }, viewport: null },
          },
          { type: "semloEditorMindmap", attrs: { height: 99.5, tree: { text: "中心", children: [] } } },
        ],
      },
    });
    const before = editor.getSnapshot();
    editor.setContent(before.html);
    const after = editor.getSnapshot();
    const warnings = [...host.querySelectorAll('[role="status"]')].map((element) => element.textContent);
    editor.destroy();
    return { before: before.json, after: after.json, warnings };
  });
  expect(result.after).toEqual(result.before);
  expect(result.warnings.some((warning) => warning?.includes("不受支持"))).toBe(true);
});

test("adjusting the canvas viewport preserves unrecognized viewport fields", async ({ page }) => {
  await page.goto(server.origin);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "canvas-presentation-safety";
    document.body.append(host);
    Reflect.set(
      window,
      "canvasPresentationEditor",
      window.semloSourceCreateEditor({
        element: host,
        content: {
          type: "doc",
          content: [
            {
              type: "semloEditorCanvas",
              attrs: {
                kind: "board",
                data: { shapes: [], edges: [] },
                viewport: { zoom: 100, x: 0, y: 0, future: { preserve: "元数据" } },
              },
            },
          ],
        },
      }),
    );
  });
  await page.locator("#canvas-presentation-safety").getByRole("button", { name: "放大画布" }).click();
  const viewport = await page.evaluate(
    () => Reflect.get(window, "canvasPresentationEditor").getSnapshot().json.content[0].attrs.viewport,
  );
  expect(viewport.zoom).toBe(110);
  expect(viewport.future).toEqual({ preserve: "元数据" });
});

test("null and unfamiliar presentation values remain intact, while damaged metadata is rejected", async ({ page }) => {
  await page.goto(server.origin);
  const values: unknown[] = [null, "", "460", "损坏高度", 2500, 99.5, { future: "height" }];
  const result = await page.evaluate((inputs) => {
    const host = document.createElement("div");
    document.body.append(host);
    const errors: string[] = [];
    const editor = window.semloSourceCreateEditor({ element: host, onError: (error) => errors.push(error.message) });
    const roundTrips = inputs.map((height) => {
      editor.setContent({
        type: "doc",
        content: [{ type: "semloEditorCanvas", attrs: { kind: null, height, data: { shapes: [], edges: [] } } }],
      });
      const before = editor.getSnapshot();
      editor.setContent(before.html);
      const after = editor.getSnapshot();
      return { before: before.json.content![0].attrs, after: after.json.content![0].attrs };
    });
    editor.setContent("<p>保留原文</p>");
    const beforeInvalid = editor.getSnapshot();
    editor.setContent('<figure data-semlo-editor-canvas data-semlo-editor-presentation="broken"></figure>');
    const afterInvalid = editor.getSnapshot();
    editor.destroy();
    return { roundTrips, beforeInvalid, afterInvalid, errors };
  }, values);
  for (const [index, value] of values.entries()) {
    expect(result.roundTrips[index].before?.height).toEqual(value);
    expect(result.roundTrips[index].after).toEqual(result.roundTrips[index].before);
    expect(result.roundTrips[index].after?.kind).toBeNull();
  }
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("画布展示数据损坏");
  expect(result.afterInvalid).toEqual(result.beforeInvalid);
});

test("explicit edits to exported presentation attributes take effect", async ({ page }) => {
  await page.goto(server.origin);
  const attrs = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = window.semloSourceCreateEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "semloEditorCanvas",
            attrs: { kind: "future", height: 5000, data: { shapes: [], edges: [] } },
          },
        ],
      },
    });
    const parsed = new DOMParser().parseFromString(editor.getSnapshot().html, "text/html");
    const figure = parsed.querySelector("figure[data-semlo-editor-canvas]")!;
    figure.setAttribute("data-kind", "uml");
    figure.setAttribute("data-height", "600");
    editor.setContent(parsed.body.innerHTML);
    const result = editor.getSnapshot().json.content![0].attrs;
    editor.destroy();
    return result;
  });
  expect(attrs?.kind).toBe("uml");
  expect(attrs?.height).toBe(600);
});

test("unsupported viewport data is retained and cannot be edited as a default view", async ({ page }) => {
  await page.goto(server.origin);
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = window.semloSourceCreateEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "semloEditorCanvas",
            attrs: {
              kind: "board",
              data: { shapes: [], edges: [] },
              viewport: { zoom: 999, x: 0, y: 0, future: "需要保留" },
            },
          },
        ],
      },
    });
    const before = editor.getSnapshot();
    const warning = host.querySelector(".semlo-editor-canvas [role=status]")?.textContent;
    const controls = host.querySelectorAll('.semlo-editor-canvas button[aria-label="放大画布"]').length;
    editor.setContent(before.html);
    const after = editor.getSnapshot();
    editor.destroy();
    return { before: before.json, after: after.json, warning, controls };
  });
  expect(result.after).toEqual(result.before);
  expect(result.warning).toContain("不受支持");
  expect(result.controls).toBe(0);
});

test("unsupported canvas presentation warnings remain visible on a narrow touch viewport", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(server.origin);
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "canvas-mobile-safety";
      document.body.append(host);
      window.semloSourceCreateEditor({
        element: host,
        toolbar: false,
        outline: false,
        content: {
          type: "doc",
          content: [
            { type: "semloEditorCanvas", attrs: { kind: "future", data: { shapes: [], edges: [] } } },
            { type: "semloEditorMindmap", attrs: { height: 5000, tree: { text: "中心", children: [] } } },
          ],
        },
      });
    });
    const warnings = page.locator("#canvas-mobile-safety").getByRole("status");
    await expect(warnings).toHaveCount(2);
    for (const warning of await warnings.all()) {
      await warning.scrollIntoViewIfNeeded();
      await expect(warning).toBeVisible();
      const bounds = await warning.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    }
    await expect(page.locator("#canvas-mobile-safety .semlo-editor-canvas-height-handle")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(warnings.first()).toContainText("不受支持");
  } finally {
    await context.close();
  }
});
