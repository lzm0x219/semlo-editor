import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import type {} from "../../fixtures/browser/core-source-entry";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";

declare global {
  interface Window {
    canvasFocusTest: { first: EditorController; second: EditorController };
  }
}

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
test.beforeAll(async () => {
  server = await startCoreSourceServer();
});
test.afterAll(async () => server.stop());

async function mount(page: Page, kind: "board" | "flowchart" | "uml" = "uml") {
  await page.goto(server.origin);
  await page.waitForFunction(() => Boolean(window.semloSourceCreateEditor));
  await page.evaluate((kind) => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    first.id = "canvas-focus-first";
    second.id = "canvas-focus-second";
    document.body.append(first, second);
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "画布前的正文" }] },
        {
          type: "semloEditorCanvas",
          attrs: {
            kind,
            data: {
              shapes: [
                { id: "a", shape: "actor", x: 150, y: 150, width: 100, height: 80, text: "参与者" },
                { id: "b", shape: "ellipse", x: 350, y: 190, width: 130, height: 70, text: "用例" },
              ],
              edges: [],
            },
          },
        },
        { type: "paragraph", content: [{ type: "text", text: "画布后的正文" }] },
      ],
    };
    window.canvasFocusTest = {
      first: window.semloSourceCreateEditor({ element: first, outline: false, content }),
      second: window.semloSourceCreateEditor({ element: second, outline: false, content }),
    };
  }, kind);
  return {
    first: page.locator("#canvas-focus-first"),
    second: page.locator("#canvas-focus-second"),
    dialog: page.getByRole("dialog", { name: "画布专注编辑" }),
  };
}

test("UML focus editing shares the canvas, document history and saved content", async ({ page }) => {
  const { first, second, dialog } = await mount(page);
  const snapshot = () => page.evaluate(() => window.canvasFocusTest.first.getSnapshot());
  const original = await snapshot();
  const other = await page.evaluate(() => window.canvasFocusTest.second.getSnapshot());
  const stage = await first.locator(".semlo-editor-canvas-stage").elementHandle();
  const inline = await first.locator(".semlo-editor-canvas-viewport").boundingBox();
  const entry = first.getByRole("button", { name: "专注编辑" });
  await entry.press("Enter");
  const back = dialog.getByRole("button", { name: "返回文档" });
  await expect(back).toBeFocused();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  expect(await stage!.evaluate((element) => Boolean(element.closest("dialog[open]")))).toBe(true);
  const expanded = await dialog.locator(".semlo-editor-canvas-viewport").boundingBox();
  expect(expanded!.height).toBeGreaterThan(inline!.height);
  expect(await snapshot()).toEqual(original);
  await second.locator(".semlo-editor-prose").evaluate((element) => (element as HTMLElement).focus());
  await expect(back).toBeFocused();

  const actor = dialog.getByRole("button", { name: "图形：参与者", exact: true });
  await actor.click();
  await expect(actor).toHaveAttribute("aria-pressed", "true");
  await actor.dblclick();
  const field = dialog.getByRole("textbox", { name: "编辑图形文字" });
  await field.fill("不保存的文字");
  await field.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(actor).toBeVisible();
  await actor.dblclick();
  await field.fill("验收参与者");
  await back.click();
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await entry.press("Enter");
  const edited = dialog.getByRole("button", { name: "图形：验收参与者", exact: true });
  await expect(edited).toBeVisible();
  await dialog.getByRole("button", { name: "连线", exact: true }).click();
  await edited.click();
  await dialog.getByRole("button", { name: "图形：用例", exact: true }).click();

  await back.click();
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  expect(await stage!.evaluate((element) => element.isConnected && !element.closest("dialog"))).toBe(true);
  const saved = await snapshot();
  expect(saved.json.content![1].attrs!.data.shapes[0].text).toBe("验收参与者");
  expect(saved.json.content![1].attrs!.data.edges).toMatchObject([{ from: "a", to: "b" }]);
  expect(await page.evaluate(() => window.canvasFocusTest.second.getSnapshot())).toEqual(other);
  const after = first.locator(".semlo-editor-prose > p").last();
  await after.click();
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot()).json.content![1].attrs!.data.edges).toHaveLength(0);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot()).toEqual(original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await snapshot()).toEqual(saved);

  const restored = await page.evaluate(() => {
    const { first } = window.canvasFocusTest;
    const saved = first.getSnapshot();
    first.destroy();
    const host = document.querySelector<HTMLElement>("#canvas-focus-first")!;
    const json = window.semloSourceCreateEditor({ element: host, content: saved.json });
    const fromJson = json.getSnapshot();
    json.destroy();
    const html = window.semloSourceCreateEditor({ element: host, content: saved.html });
    const fromHtml = html.getSnapshot();
    html.destroy();
    return [fromJson, fromHtml];
  });
  expect(restored).toEqual([saved, saved]);
});

for (const kind of ["board", "flowchart"] as const) {
  test(`${kind} can enter and exit the focus workspace by touch on a narrow viewport`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 720 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      const { first, dialog } = await mount(page, kind);
      const snapshot = () => page.evaluate(() => window.canvasFocusTest.first.getSnapshot());
      const before = await snapshot();
      const entry = first.getByRole("button", { name: "专注编辑" });
      await entry.tap();
      const back = dialog.getByRole("button", { name: "返回文档" });
      await expect(back).toBeFocused();
      expect(await dialog.evaluate((element) => element.getBoundingClientRect().width)).toBe(375);
      await dialog.getByRole("button", { name: "图形：参与者" }).tap();
      await expect(dialog.getByRole("button", { name: "图形：参与者" })).toHaveAttribute("aria-pressed", "true");
      await dialog.getByRole("button", { name: "更多形状" }).tap();
      await expect(dialog.getByRole("dialog", { name: "图形库" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("dialog", { name: "图形库" })).toHaveCount(0);
      await back.tap();
      await expect(dialog).toHaveCount(0);
      await expect(entry).toBeFocused();
      expect(await snapshot()).toEqual(before);
    } finally {
      await context.close();
    }
  });
}

test("focus workspace closes on read-only changes, replacement and destruction", async ({ page }) => {
  const { first, second, dialog } = await mount(page);
  const firstEntry = first.getByRole("button", { name: "专注编辑" });
  const secondEntry = second.getByRole("button", { name: "专注编辑" });
  const original = await page.evaluate(() => window.canvasFocusTest.first.getSnapshot());
  await firstEntry.press("Enter");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(firstEntry).toBeFocused();
  await firstEntry.press("Space");
  await dialog.getByRole("button", { name: "图形：参与者" }).dblclick();
  await dialog.getByRole("textbox", { name: "编辑图形文字" }).fill("只读切换作废");
  await page.evaluate(() => window.canvasFocusTest.first.setEditable(false));
  await expect(first.locator("dialog")).toHaveCount(0);
  await expect(first.getByRole("button", { name: "放大画布" })).toBeVisible();
  await expect(firstEntry).toHaveCount(0);
  expect(await page.evaluate(() => window.canvasFocusTest.first.getSnapshot())).toEqual(original);

  await page.evaluate(() => window.canvasFocusTest.first.setEditable(true));
  await firstEntry.press("Enter");
  await dialog.getByRole("button", { name: "图形：参与者" }).dblclick();
  await dialog.getByRole("textbox", { name: "编辑图形文字" }).fill("替换后作废");
  await page.evaluate((content) => {
    content.content![2].content![0].text = "替换后的正文";
    window.canvasFocusTest.first.setContent(content);
  }, original.json);
  await expect(dialog).toHaveCount(0);
  await expect(first.getByText("替换后的正文", { exact: true })).toBeVisible();
  await expect(first.getByRole("button", { name: "图形：参与者" })).toBeVisible();

  await firstEntry.press("Enter");
  await page.evaluate(() => window.canvasFocusTest.first.destroy());
  await expect(dialog).toHaveCount(0);
  await secondEntry.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(secondEntry).toBeFocused();
});
