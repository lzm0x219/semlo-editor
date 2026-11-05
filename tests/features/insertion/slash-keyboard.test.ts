import { test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    slashKeyboardTest?: EditorController;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("insertion menu keyboard follows the rendered layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("SEMLO_TEST_ORIGIN is required");
  await page.goto(origin);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      localStorage.removeItem('semlo-editor.recent-commands.v1')
      const host = document.createElement('div')
      host.id = 'slash-keyboard-test'
      document.body.prepend(host)
      window.slashKeyboardTest = createEditor({ element: host, content: '<p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.slashKeyboardTest));

  const host = page.locator("#slash-keyboard-test");
  const editor = host.locator(".semlo-editor-prose");
  const reset = async () => {
    await page.evaluate(() => {
      localStorage.removeItem("semlo-editor.recent-commands.v1");
      window.__semloRequireFixture("slashKeyboardTest").setContent("<p></p>");
      window.__semloRequireFixture("slashKeyboardTest").editor.commands.focus("end");
    });
  };
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("slashKeyboardTest").getSnapshot().json);
  const toolbarMenu = async () => {
    await host.getByRole("button", { name: "插入内容" }).click();
    const menu = page.getByRole("dialog", { name: "插入内容" });
    await menu.getByLabel("搜索插入内容").focus();
    return menu;
  };
  const selected = async (menu: ReturnType<typeof page.locator>, expected: string, recent = false) => {
    const active = menu.locator(".semlo-editor-card-item.selected, .semlo-editor-recent-item.selected");
    if ((await active.count()) !== 1) throw new Error("Expected exactly one selected card");
    if (
      (await active.getAttribute("data-command")) !== expected ||
      (await active.getAttribute(recent ? "aria-current" : "aria-selected")) !== "true"
    ) {
      throw new Error(`Expected selected card ${expected}, got ${await active.getAttribute("data-command")}`);
    }
  };
  const assertDatabaseCardOrder = async (menu: ReturnType<typeof page.locator>) => {
    const ids = ["status", "canvas", "mindmap", "flowchart", "database", "album", "kanban", "code"];
    const cards = await Promise.all(
      ids.map(async (id) => {
        const card = menu.locator(`.semlo-editor-card-item[data-command="${id}"]`);
        return { id, bounds: await card.boundingBox(), enabled: await card.isEnabled() };
      }),
    );
    if (
      cards.some((card) => !card.bounds || !card.enabled) ||
      cards.some((card, index) => index > 0 && card.bounds!.y <= cards[index - 1].bounds!.y)
    ) {
      throw new Error(`Enabled cards are not in their expected visual order: ${JSON.stringify(cards)}`);
    }
  };
  const nodes = async (type: string) => ((await snapshot()).content ?? []).filter((node) => node.type === type);

  await reset();
  await page.evaluate(() => localStorage.setItem("semlo-editor.recent-commands.v1", '["link"]'));
  let menu = await toolbarMenu();
  if (await menu.locator(".selected").count()) throw new Error("Unfiltered menu unexpectedly selected a card");
  const unchanged = JSON.stringify(await snapshot());
  await page.keyboard.press("Enter");
  if (!(await menu.isVisible()) || JSON.stringify(await snapshot()) !== unchanged) {
    throw new Error("Enter without a selection changed the document or closed the menu");
  }
  await page.keyboard.press("ArrowDown");
  await selected(menu, "link", true);
  await page.keyboard.press("ArrowDown");
  await selected(menu, "image");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "attachment");
  await page.keyboard.press("ArrowRight");
  await selected(menu, "status");
  await assertDatabaseCardOrder(menu);
  await page.keyboard.press("ArrowDown");
  await selected(menu, "canvas");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "mindmap");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "flowchart");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "database");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "album");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "kanban");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "code");
  await page.keyboard.press("Enter");
  if ((await nodes("codeBlock")).length !== 1)
    throw new Error("Enter executed a different card than the selected code block");

  await reset();
  menu = await toolbarMenu();
  const search = menu.getByLabel("搜索插入内容");
  await search.fill("fl");
  await selected(menu, "flowchart");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "columns");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "columns3");
  await page.keyboard.press("Enter");
  const threeColumns = await nodes("semloEditorColumns");
  if (threeColumns.length !== 1 || threeColumns[0].content?.length !== 3)
    throw new Error("Filtered Enter did not insert three columns");

  await reset();
  menu = await toolbarMenu();
  await menu.getByLabel("搜索插入内容").fill("does-not-exist");
  if (await menu.locator(".semlo-editor-card-item.selected").count())
    throw new Error("An empty result retained a selection");
  const before = JSON.stringify(await snapshot());
  await page.keyboard.press("Enter");
  if (JSON.stringify(await snapshot()) !== before) throw new Error("Enter with no results changed the document");
  await page.keyboard.press("Escape");
  if (await menu.count()) throw new Error("Escape did not close the card menu");

  await reset();
  menu = await toolbarMenu();
  await menu.getByLabel("搜索插入内容").fill("biaoge");
  await selected(menu, "table");
  await page.keyboard.press("Enter");
  const defaultTables = await nodes("table");
  if (
    defaultTables.length !== 1 ||
    defaultTables[0].content?.length !== 3 ||
    defaultTables[0].content?.[0]?.content?.length !== 3
  ) {
    throw new Error("Keyboard table insertion did not preserve the default 3×3 table");
  }

  await reset();
  menu = await toolbarMenu();
  await menu.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
  await selected(menu, "table");
  await page.getByLabel("2行4列").click();
  const chosenTables = await nodes("table");
  if (
    chosenTables.length !== 1 ||
    chosenTables[0].content?.length !== 2 ||
    chosenTables[0].content?.[0]?.content?.length !== 4
  ) {
    throw new Error("Mouse table size selection changed");
  }

  await reset();
  await editor.locator("p").click();
  await page.keyboard.type("/");
  menu = page.getByRole("listbox", { name: "插入内容" });
  await selected(menu, "image");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "attachment");
  await page.keyboard.press("ArrowRight");
  await selected(menu, "status");
  await assertDatabaseCardOrder(menu);
  await page.keyboard.press("ArrowDown");
  await selected(menu, "canvas");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "mindmap");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "flowchart");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "database");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "album");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "kanban");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "code");
  await page.keyboard.press("Enter");
  if ((await nodes("codeBlock")).length !== 1 || (await editor.innerText()).includes("/")) {
    throw new Error("Slash Enter did not execute the visible selection and remove the trigger");
  }

  await reset();
  menu = await toolbarMenu();
  await page.keyboard.press("ArrowDown");
  await selected(menu, "image");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "attachment");
  await page.keyboard.press("ArrowRight");
  await selected(menu, "status");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "canvas");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "mindmap");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "flowchart");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "database");
  await page.keyboard.press("Enter");
  const database = await nodes("semloEditorDatabase");
  if (database.length !== 1 || database[0].attrs?.data?.views?.[0]?.kind !== "table") {
    throw new Error("Keyboard selection did not insert the data table view");
  }

  await reset();
  await editor.locator("p").click();
  await page.keyboard.type("/");
  menu = page.getByRole("listbox", { name: "插入内容" });
  await selected(menu, "image");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "attachment");
  await page.keyboard.press("ArrowRight");
  await selected(menu, "status");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "canvas");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "mindmap");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "flowchart");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "database");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "album");
  await page.keyboard.press("ArrowDown");
  await selected(menu, "kanban");
  await page.keyboard.press("Enter");
  const kanban = await nodes("semloEditorDatabase");
  if (
    kanban.length !== 1 ||
    kanban[0].attrs?.data?.views?.[0]?.kind !== "kanban" ||
    (await editor.innerText()).includes("/")
  ) {
    throw new Error("Slash keyboard selection did not insert a kanban view");
  }

  await reset();
  await editor.locator("p").click();
  await page.keyboard.type("/fl3");
  menu = page.getByRole("listbox", { name: "插入内容" });
  await selected(menu, "columns3");
  await page.keyboard.press("Enter");
  const slashColumns = await nodes("semloEditorColumns");
  if (slashColumns.length !== 1 || slashColumns[0].content?.length !== 3)
    throw new Error("Slash filtering selected the wrong columns");

  await reset();
  await page.evaluate(() => localStorage.setItem("semlo-editor.recent-commands.v1", '["link"]'));
  await editor.locator("p").click();
  await page.keyboard.type("/");
  menu = page.getByRole("listbox", { name: "插入内容" });
  await selected(menu, "link", true);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "插入链接" }).waitFor();
  if ((await editor.innerText()).includes("/")) throw new Error("Recent slash command did not remove the trigger");
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.__semloRequireFixture("slashKeyboardTest").destroy());
  if (errors.length) throw new Error(errors.join("; "));
});

test("search results match the toolbar and slash menu states", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("SEMLO_TEST_ORIGIN is required");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  await page.evaluate(() => localStorage.removeItem("semlo-editor.recent-commands.v1"));
  const editor = page.locator("#editor-host .semlo-editor-prose");
  await editor.locator("p").last().click();
  await page.getByRole("button", { name: "插入内容" }).click();
  let menu = page.getByRole("dialog", { name: "插入内容" });
  const normalBounds = await menu.boundingBox();
  if (!normalBounds || normalBounds.height < 590 || normalBounds.y + normalBounds.height > 900) {
    throw new Error(`Toolbar menu is not at its reference height within the viewport: ${JSON.stringify(normalBounds)}`);
  }
  const search = menu.getByLabel("搜索插入内容");
  await search.fill("代码");
  const groups = await menu.locator(".semlo-editor-card-section").allTextContents();
  const resultBounds = await menu.boundingBox();
  if (groups.join("|") !== "搜索结果" || !resultBounds || Math.abs(resultBounds.height - normalBounds.height) > 1) {
    throw new Error(
      `Toolbar search changed grouping or panel height: ${groups.join("|")} ${JSON.stringify(resultBounds)}`,
    );
  }
  if ((await menu.locator(".semlo-editor-card-item.selected").getAttribute("data-command")) !== "code") {
    throw new Error("Search did not select the first visible result");
  }

  await search.fill("图片");
  const imageOption = menu.locator('.semlo-editor-card-item[data-command="image"]');
  const imageResult = await imageOption.boundingBox();
  if (!imageResult || imageResult.width < normalBounds.width * 0.75) {
    throw new Error(`Basic search result did not use the full row: ${JSON.stringify(imageResult)}`);
  }
  if (await imageOption.locator(".semlo-editor-card-desc").count())
    throw new Error("Basic image search result showed a description");

  await search.fill("不存在的项目");
  const emptyBounds = await menu.boundingBox();
  const emptyArt = menu.locator(".semlo-editor-search-empty-art");
  const artBounds = await emptyArt.boundingBox();
  const messageBounds = await menu.getByText("暂无匹配的搜索结果").boundingBox();
  if (
    !(await menu.getByText("暂无匹配的搜索结果").isVisible()) ||
    (await menu.locator(".semlo-editor-card-section").count()) ||
    !emptyBounds ||
    !artBounds ||
    !messageBounds ||
    (await emptyArt.getAttribute("aria-hidden")) !== "true" ||
    Math.abs(emptyBounds.height - 372) > 1 ||
    Math.abs(artBounds.width - 218) > 1 ||
    Math.abs(artBounds.height - 136) > 1 ||
    Math.abs(artBounds.x + artBounds.width / 2 - emptyBounds.x - emptyBounds.width / 2) > 4 ||
    Math.abs(messageBounds.y - artBounds.y - artBounds.height - 12) > 1
  ) {
    throw new Error(
      `Toolbar empty state did not match its reference layout: ${JSON.stringify({ emptyBounds, artBounds, messageBounds })}`,
    );
  }
  await search.fill("");
  if (!(await menu.getByText("基础", { exact: true }).isVisible()))
    throw new Error("Clearing search did not restore groups");
  await search.fill("表格");
  await menu.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
  await page.getByLabel("2行4列").waitFor();
  await search.fill("分栏");
  if (await page.getByLabel("2行4列").count()) throw new Error("Search left the table picker open");
  await menu.getByRole("option", { name: /分栏卡片/ }).hover();
  await page.getByRole("menu", { name: "选择分栏数" }).getByRole("menuitem", { name: "三栏" }).click();
  if ((await editor.locator(".semlo-editor-column").count()) !== 3)
    throw new Error("Filtered column picker did not insert three columns");

  await page.setViewportSize({ width: 320, height: 300 });
  await page.goto(origin);
  await page.locator("#editor-host .semlo-editor-prose p").last().click();
  await page.getByRole("button", { name: "插入内容" }).click();
  menu = page.getByRole("dialog", { name: "插入内容" });
  await menu.getByLabel("搜索插入内容").fill("代码");
  const smallBounds = await menu.boundingBox();
  if (
    !smallBounds ||
    smallBounds.x < 0 ||
    smallBounds.y < 0 ||
    smallBounds.x + smallBounds.width > 320 ||
    smallBounds.y + smallBounds.height > 300
  ) {
    throw new Error(`Menu escaped the small viewport: ${JSON.stringify(smallBounds)}`);
  }
  await menu.getByLabel("搜索插入内容").fill("不存在的项目");
  const compactArt = await menu.locator(".semlo-editor-search-empty-art").boundingBox();
  const compactMessage = await menu.getByText("暂无匹配的搜索结果").boundingBox();
  const compactMenu = await menu.boundingBox();
  const compactInput = await menu.getByLabel("搜索插入内容").boundingBox();
  if (
    !compactArt ||
    !compactMessage ||
    !compactMenu ||
    !compactInput ||
    compactArt.width <= 0 ||
    compactArt.height <= 0 ||
    compactArt.y < compactInput.y + compactInput.height ||
    compactMessage.y < compactArt.y + compactArt.height ||
    compactMessage.y + compactMessage.height > compactMenu.y + compactMenu.height
  ) {
    throw new Error(
      `Empty state did not fit the small viewport: ${JSON.stringify({ compactMenu, compactInput, compactArt, compactMessage })}`,
    );
  }
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  const slashEditor = page.locator("#editor-host .semlo-editor-prose");
  await slashEditor.locator("p").last().click();
  await page.keyboard.type("/代码");
  const slashMenu = page.getByRole("listbox", { name: "插入内容" });
  await slashMenu.getByRole("option", { name: /代码块/ }).waitFor();
  const slashBounds = await slashMenu.boundingBox();
  const slashGroups = await slashMenu.locator(".semlo-editor-card-section").allTextContents();
  if (
    slashGroups.join("|") !== "搜索结果" ||
    (await slashMenu.locator(".semlo-editor-quick-grid, .semlo-editor-recent-section").count()) ||
    !slashBounds ||
    slashBounds.height >= 300
  ) {
    throw new Error(
      `Slash search did not collapse to its result: ${slashGroups.join("|")} ${JSON.stringify(slashBounds)}`,
    );
  }
  await page.keyboard.press("Escape");

  await page.goto(origin);
  const noMatchEditor = page.locator("#editor-host .semlo-editor-prose");
  await noMatchEditor.locator("p").last().click();
  await page.keyboard.type("/不存在的项目");
  await page.waitForFunction(() => !document.querySelector(".semlo-editor-slash-menu"));
  if (!(await noMatchEditor.innerText()).includes("/不存在的项目"))
    throw new Error("No-match slash query removed the typed text");
  for (const _character of "不存在的项目") await page.keyboard.press("Backspace");
  await page.waitForTimeout(100);
  if ((await page.locator(".semlo-editor-slash-menu").count()) || !(await noMatchEditor.innerText()).includes("/")) {
    throw new Error("Dismissed slash search reopened after deleting its unmatched query");
  }
});
