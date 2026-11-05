import { expect, test, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import {
  createDatabaseData,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    boardTestEditor?: EditorController;
    boardOtherEditor?: EditorController;
    boardTestContent?: EditorContent;
  }
}

function makeContent() {
  const data = createDatabaseData();
  data.fields[0].name = "任务";
  data.fields[1].name = "状态";
  data.records.forEach((record, index) => {
    record.values[data.fields[0].id] = ["甲", "乙", "丙"][index];
  });
  const board = createDatabaseView("看板视图", "kanban");
  board.groupFieldId = data.fields[1].id;
  data.views.push(board);
  data.activeViewId = board.id;
  return {
    data,
    content: {
      type: "doc",
      content: [{ type: "paragraph" }, { type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }],
    } satisfies EditorContent,
  };
}

async function mount(page: Page, multiple = false) {
  const fixture = makeContent();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((content) => {
    window.boardTestContent = content;
  }, fixture.content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const style = document.createElement('style')
      style.textContent = '#board-main .semlo-editor-content, #board-other .semlo-editor-content { max-width: none; padding: 20px; margin: 0 }'
      document.head.append(style)
      const container = document.createElement('div')
      container.id = 'board-test-container'
      container.style.display = 'flex'
      container.style.alignItems = 'flex-start'
      document.body.prepend(container)
      const main = document.createElement('div')
      main.id = 'board-main'
      main.style.width = ${multiple ? "'50%'" : "'100%'"}
      container.append(main)
      if (${multiple}) {
        const other = document.createElement('div')
        other.id = 'board-other'
        other.style.width = '50%'
        container.append(other)
        window.boardOtherEditor = createEditor({ element: other, outline: false, content: structuredClone(window.boardTestContent) })
      }
      window.boardTestEditor = createEditor({ element: main, outline: false, content: structuredClone(window.boardTestContent) })
    `,
  });
  await page.waitForFunction(() => Boolean(window.boardTestEditor));
  const root = page.locator("#board-main .semlo-editor-database");
  await expect(root.locator(".semlo-editor-database-board")).toBeVisible();
  return { ...fixture, root, other: page.locator("#board-other .semlo-editor-database") };
}

async function data(page: Page, which: "main" | "other" = "main"): Promise<DatabaseData> {
  return page.evaluate((selected) => {
    const editor =
      selected === "main"
        ? window.__semloRequireFixture("boardTestEditor")
        : window.__semloRequireFixture("boardOtherEditor");
    const node = editor.getSnapshot().json.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing data table");
    return node.attrs.data as DatabaseData;
  }, which);
}

function group(root: Locator, id: string) {
  return root.locator(`.semlo-editor-database-board-column[data-group-id="${id}"]`);
}

function card(root: Locator, id: string) {
  return root.locator(`.semlo-editor-database-card[data-record-id="${id}"]`);
}

async function cards(column: Locator) {
  return column
    .locator(".semlo-editor-database-card")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.recordId));
}

async function startDrag(
  page: Page,
  source: Locator,
  target: Locator,
  position: "before" | "after" | "center" = "center",
) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing drag source or target bounds");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 4, { steps: 3 });
  await page.mouse.move(
    to.x + to.width / 2,
    position === "before" ? to.y + 8 : position === "after" ? to.y + to.height - 8 : to.y + to.height / 2,
    { steps: 12 },
  );
}

async function drag(page: Page, source: Locator, target: Locator, position: "before" | "after" | "center" = "center") {
  await startDrag(page, source, target, position);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("manual card order belongs to the board view and survives undo, redo and HTML round-trip", async ({ page }) => {
  const { root, data: initial } = await mount(page);
  const [first, second, third] = initial.records.map((record) => record.id);
  const ungrouped = group(root, "");
  expect(await cards(ungrouped)).toEqual([third, second, first]);
  await expect(card(root, first)).toHaveAttribute("draggable", "true");

  await drag(page, card(root, first), card(root, second), "before");
  await expect.poll(() => cards(ungrouped)).toEqual([third, first, second]);
  expect((await data(page)).records.map((record) => record.id)).toEqual([first, second, third]);
  expect(await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").editor.commands.undo())).toBe(true);
  expect(await cards(ungrouped)).toEqual([third, second, first]);
  expect(await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").editor.commands.redo())).toBe(true);
  expect(await cards(ungrouped)).toEqual([third, first, second]);

  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  for (const [index, name] of ["甲", "乙", "丙"].entries()) {
    await expect(root.getByLabel(`第 ${index + 1} 行 任务`)).toHaveValue(name);
  }
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到看板视图" }).click();
  expect(await cards(ungrouped)).toEqual([third, first, second]);
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("boardTestEditor");
    controller.setContent(controller.getSnapshot().html);
  });
  await expect.poll(() => cards(ungrouped)).toEqual([third, first, second]);
});

test("moving a card across columns updates the field without reordering table records", async ({ page }) => {
  const { root, data: initial } = await mount(page);
  const [first, second, third] = initial.records.map((record) => record.id);
  const status = initial.fields[1];
  const target = group(root, status.options[0].id);
  await drag(page, card(root, third), target);
  await expect.poll(() => cards(target)).toEqual([third]);
  let current = await data(page);
  expect(current.records.map((record) => record.id)).toEqual([first, second, third]);
  expect(current.records[2].values[status.id]).toBe(status.options[0].id);
  expect(await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").editor.commands.undo())).toBe(true);
  expect((await data(page)).records[2].values[status.id]).toBe("");
  expect(await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").editor.commands.redo())).toBe(true);
  current = await data(page);
  expect(current.records[2].values[status.id]).toBe(status.options[0].id);
  await expect.poll(() => cards(target)).toEqual([third]);

  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  for (const [index, name] of ["甲", "乙", "丙"].entries()) {
    await expect(root.getByLabel(`第 ${index + 1} 行 任务`)).toHaveValue(name);
  }
  await expect(root.getByLabel("第 3 行 状态")).toContainText("待开始");
});

test("dropping outside or becoming read-only during a drag leaves the document unchanged", async ({ page }) => {
  const { root, data: initial } = await mount(page);
  const source = card(root, initial.records[2].id);
  const target = group(root, initial.fields[1].options[0].id);
  const before = await data(page);
  await startDrag(page, source, target);
  await page.mouse.move(2, 2, { steps: 8 });
  await page.mouse.up();
  expect(await data(page)).toEqual(before);

  await startDrag(page, source, target);
  await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").setEditable(false));
  await page.mouse.up();
  expect(await data(page)).toEqual(before);
  await drag(page, source, target);
  expect(await data(page)).toEqual(before);
});

test("a document replacement during a drag cannot apply the old drop to the replacement", async ({ page }) => {
  const { root, data: initial } = await mount(page);
  const source = card(root, initial.records[2].id);
  const target = group(root, initial.fields[1].options[0].id);
  await startDrag(page, source, target);
  const replacement = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("boardTestEditor");
    const next = structuredClone(controller.getSnapshot().json);
    const entry = next.content?.find((node) => node.type === "semloEditorDatabase");
    if (!entry?.attrs?.data) throw new Error("Missing database content");
    const data = entry.attrs.data as DatabaseData;
    data.records[2].values[data.fields[0].id] = "替换后";
    controller.setContent(next);
    return next;
  });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").getSnapshot().json)).toEqual(
    replacement,
  );
  await expect(root.getByRole("button", { name: "记录：替换后" })).toBeVisible();
});

test("a drag cannot cross between separate editors, even with matching document identifiers", async ({ page }) => {
  const { root, other, data: initial } = await mount(page, true);
  await expect(other.locator(".semlo-editor-database-board")).toBeVisible();
  const source = card(root, initial.records[2].id);
  const target = group(other, "");
  const beforeMain = await data(page);
  const beforeOther = await data(page, "other");
  await drag(page, source, target);
  expect(await data(page)).toEqual(beforeMain);
  expect(await data(page, "other")).toEqual(beforeOther);

  await startDrag(page, source, target);
  await page.evaluate(() => window.__semloRequireFixture("boardTestEditor").destroy());
  await page.mouse.up();
  expect(await data(page, "other")).toEqual(beforeOther);
});
