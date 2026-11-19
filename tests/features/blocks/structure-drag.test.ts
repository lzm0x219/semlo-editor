import { expect, test, type Locator, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    structureDragEditor?: EditorController;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

async function mount(page: Page, content: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const element = document.createElement('main');
      element.id = 'structure-drag';
      element.style.margin = '40px';
      document.body.replaceChildren(element);
      window.structureDragEditor = createEditor({
        element,
        outline: false,
        content: ${JSON.stringify(content)},
        onChange: snapshot => window.structureDragEditor?.setContent(snapshot.html),
      });
    `,
  });
  await page.waitForFunction(() => Boolean(window.structureDragEditor));
  return page.locator("#structure-drag .semlo-editor-prose");
}

const snapshot = (page: Page) => page.evaluate(() => window.structureDragEditor!.getSnapshot());
const handle = (page: Page) => page.locator(".semlo-editor-block-handle:visible");

async function drag(page: Page, from: Locator, to: Locator, after = false, sourcePosition?: { x: number; y: number }) {
  await from.hover({ position: sourcePosition });
  await expect(handle(page)).toBeVisible();
  const source = (await handle(page).boundingBox())!;
  const destination = (await to.boundingBox())!;
  const x = source.x + source.width / 2;
  const y = source.y + source.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y, { steps: 4 });
  await page.mouse.move(destination.x + 12, after ? destination.y + destination.height - 2 : destination.y + 2, {
    steps: 10,
  });
  await page.mouse.up();
}

const columns =
  '<div data-semlo-editor-columns data-widths="[0.4,0.6]">' +
  "<div data-semlo-editor-column><p><strong>左栏文字</strong></p></div>" +
  "<div data-semlo-editor-column><p>右栏文字</p></div></div>";

test("列内首段可移出、放回空栏或移入另一栏，保持宽度和历史", async ({ page }) => {
  const prose = await mount(page, "<p>前文</p>" + columns + "<p>后文</p>");
  const group = prose.locator("[data-semlo-editor-columns]");
  const left = group.locator("[data-semlo-editor-column]").first();
  const right = group.locator("[data-semlo-editor-column]").last();
  const front = prose.locator(":scope > p").filter({ hasText: "前文" });
  const before = await snapshot(page);
  await drag(page, left.locator("p"), front);
  await expect(prose.locator(":scope > p")).toHaveText(["左栏文字", "前文", "后文"]);
  await expect(prose.locator(":scope > p > strong")).toHaveText("左栏文字");
  await expect(left.locator("p")).toHaveText([""]);
  await expect(right.locator("p")).toHaveText(["右栏文字"]);
  const movedOut = await snapshot(page);
  expect(movedOut.json.content?.find((node) => node.type === "semloEditorColumns")?.attrs?.widths).toEqual([0.4, 0.6]);
  await drag(page, prose.locator(":scope > p").first(), left.locator("p"));
  await expect(left.locator("p")).toHaveText(["左栏文字"]);
  expect((await snapshot(page)).json).toEqual(before.json);
  await drag(page, left.locator("p"), right.locator("p"), true);
  await expect(left.locator("p")).toHaveText([""]);
  await expect(right.locator("p")).toHaveText(["右栏文字", "左栏文字"]);
  const crossed = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(movedOut);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await snapshot(page)).toEqual(crossed);
  await page.evaluate((value) => {
    window.structureDragEditor!.setContent("<p></p>");
    window.structureDragEditor!.setContent(value);
  }, crossed.html);
  expect(await snapshot(page)).toEqual(crossed);
  await drag(page, prose.locator(".semlo-editor-columns-node"), front, false, { x: 3, y: 2 });
  expect((await snapshot(page)).json.content?.map((node) => node.type)).toEqual([
    "semloEditorColumns",
    "paragraph",
    "paragraph",
  ]);
  await expect(right.locator("p")).toHaveText(["右栏文字", "左栏文字"]);
});

test("折叠标题移动整个收起的块，展开时正文段落可独立移出和移入", async ({ page }) => {
  const prose = await mount(
    page,
    '<p>前文</p><details><summary>折叠标题</summary><div data-type="detailsContent"><p>折叠正文</p></div></details><p>后文</p>',
  );
  const details = prose.locator('[data-type="details"]');
  const body = details.locator('[data-type="detailsContent"]');
  const snapshotOrder = async () => (await snapshot(page)).json.content?.map((node) => node.type);
  await expect(body).toBeHidden();
  const before = await snapshot(page);
  await drag(page, details.locator("summary"), prose.locator(":scope > p").last(), true);
  expect(await snapshotOrder()).toEqual(["paragraph", "paragraph", "details"]);
  await expect(body).toBeHidden();
  const moved = await snapshot(page);
  expect(moved.json.content?.[2]).toEqual(before.json.content?.[1]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await snapshot(page)).toEqual(moved);
  await details.getByRole("button", { name: "展开内容" }).click();
  await expect(body).toBeVisible();
  const expanded = await snapshot(page);
  const front = prose.locator(":scope > p").filter({ hasText: "前文" });
  await drag(page, front, body.locator("p").first());
  await expect(body.locator("p")).toHaveText(["前文", "折叠正文"]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(expanded);
  await drag(page, body.locator("p"), front);
  await expect(prose.locator(":scope > p")).toHaveText(["折叠正文", "前文", "后文"]);
  await expect(body.locator("p")).toHaveCount(0);
  await expect(details.locator("summary")).toHaveText("折叠标题");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(expanded);
  await page.evaluate((value) => {
    window.structureDragEditor!.setContent("<p></p>");
    window.structureDragEditor!.setContent(value);
  }, moved.html);
  await expect(body).toBeHidden();
  expect(await snapshot(page)).toEqual(moved);
});

test("从块菜单删除列内唯一段落时保留空栏和邻栏", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 760 });
  const prose = await mount(page, "<p>外部正文</p>" + columns);
  const group = prose.locator("[data-semlo-editor-columns]");
  const left = group.locator("[data-semlo-editor-column]").first();
  const right = group.locator("[data-semlo-editor-column]").last();
  const before = await snapshot(page);
  await left.locator("p").hover();
  await handle(page).click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(left.locator("p")).toHaveText([""]);
  await expect(right.locator("p")).toHaveText("右栏文字");
  await expect(prose.locator(":scope > p")).toHaveText("外部正文");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(before);
});
