import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseQueryRejectEditor?: EditorController;
    databaseQueryRejectNext?: boolean;
  }
}

const actions = [
  "排序列",
  "排序方向",
  "添加排序",
  "删除排序",
  "启用保持排序",
  "停用保持排序",
  "一次性排序",
  "画册排序方向",
  "看板排序方向",
  "分组列",
  "分组方向",
  "移除分组",
] as const;

for (const action of actions) {
  test(`宿主拒绝${action}时恢复界面并允许重试`, async ({ page }) => {
    await installFixtureGuards(page);
    if (action === "一次性排序" || action === "分组列") await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    const [title, option, date] = data.fields;
    const view = data.views[0];
    const grouping = action === "分组列" || action === "分组方向" || action === "移除分组";
    const draft = action === "一次性排序" || action === "启用保持排序";
    if (action === "画册排序方向") view.kind = "gallery";
    if (action === "看板排序方向") view.kind = "kanban";
    if (grouping) view.groupFieldId = title.id;
    else if (!draft) view.sorts = [{ fieldId: title.id, direction: "asc" }];
    data.records.forEach((record, index) => {
      record.values[title.id] = ["B", "C", "A"][index];
      record.values[option.id] = option.options[view.kind === "kanban" ? 0 : [0, 2, 1][index]].id;
      record.values[date.id] = ["2026-11-01", "2026-11-03", "2026-11-02"][index];
    });

    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseQueryRejectContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor, Plugin } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'database-query-reject'; document.body.prepend(host)
        const controller = createEditor({element: host, outline: false, content: window.databaseQueryRejectContent})
        controller.editor.registerPlugin(new Plugin({
          filterTransaction(transaction) {
            if (!window.databaseQueryRejectNext || !transaction.docChanged) return true
            window.databaseQueryRejectNext = false
            return false
          }
        }))
        window.databaseQueryRejectEditor = controller
      `,
    });

    const root = page.locator("#database-query-reject .semlo-editor-database");
    const name = grouping ? "分组" : "排序";
    const open = () => root.getByRole("button", { name, exact: true }).click();
    const panel = root.getByRole("dialog", { name });
    const field = panel.getByLabel(grouping ? "分组列" : "排序列");
    const direction = panel.getByLabel(grouping ? "分组顺序" : "排序顺序");
    const keep = panel.getByLabel("保持排序");
    const add = panel.getByRole("button", { name: "添加排序" });
    const confirm = panel.getByRole("button", { name: "确定排序" });
    const rows = () =>
      root
        .locator('input[aria-label$=" 行 文本"], .semlo-editor-database-card-title strong')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node instanceof HTMLInputElement ? node.value : node.textContent)),
        );
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("databaseQueryRejectEditor").getSnapshot());
    const originalRows = draft ? ["B", "C", "A"] : ["A", "B", "C"];
    await expect(root).toBeVisible();
    const original = await snapshot();

    await open();
    if (draft) await add.click();
    if (action === "一次性排序") await direction.selectOption("desc");
    const perform = async () => {
      switch (action) {
        case "排序列":
          await field.selectOption(date.id);
          break;
        case "分组列":
          await field.selectOption(option.id);
          break;
        case "添加排序":
          await add.click();
          break;
        case "删除排序":
        case "移除分组":
          await panel.getByRole("button", { name: action }).click();
          break;
        case "启用保持排序":
        case "停用保持排序":
          await keep.click();
          break;
        case "一次性排序":
          await confirm.press("Enter");
          break;
        default:
          await direction.selectOption("desc");
      }
    };

    expect(await rows()).toEqual(originalRows);
    await page.evaluate(() => (window.databaseQueryRejectNext = true));
    await perform();
    expect(await page.evaluate(() => window.databaseQueryRejectNext)).toBe(false);
    expect(errors).toEqual([]);
    expect(await snapshot()).toEqual(original);
    expect(await rows()).toEqual(originalRows);

    expect(await panel.count()).toBe(1);
    expect(await field.count()).toBe(1);
    expect(await field.inputValue()).toBe(title.id);
    expect(await direction.inputValue()).toBe(action === "一次性排序" ? "desc" : "asc");
    if (grouping) await expect(direction.locator("option:checked")).toHaveText("升序");
    if (!grouping && view.kind === "table") expect(await keep.isChecked()).toBe(!draft);

    await perform();
    const saved = await snapshot();
    const savedView = (saved.json.content![0].attrs!.data as DatabaseData).views[0];
    let expectedRows = ["C", "B", "A"];
    switch (action) {
      case "排序列":
      case "分组列":
        expectedRows = ["B", "A", "C"];
        if (grouping) {
          expect(savedView.groupFieldId).toBe(option.id);
          await expect(direction.locator("option:checked")).toHaveText("选项顺序");
        } else {
          expect(savedView.sorts).toEqual([{ fieldId: date.id, direction: "asc" }]);
        }
        break;
      case "添加排序":
      case "启用保持排序":
        expectedRows = ["A", "B", "C"];
        expect(savedView.sorts).toHaveLength(action === "添加排序" ? 2 : 1);
        break;
      case "删除排序":
      case "移除分组":
        expectedRows = ["B", "C", "A"];
        expect(savedView.sorts).toEqual([]);
        expect(savedView.groupFieldId).toBe("");
        break;
      case "停用保持排序":
        expectedRows = ["A", "B", "C"];
        expect(savedView.sorts).toEqual([]);
        break;
      case "一次性排序":
        expect(savedView.sorts).toEqual([]);
        expect(savedView.recordOrder).toEqual([data.records[1].id, data.records[0].id, data.records[2].id]);
        break;
      case "分组方向":
        expect(savedView.groupDirection).toBe("desc");
        break;
      default:
        expect(savedView.sorts).toEqual([{ fieldId: title.id, direction: "desc" }]);
    }
    expect(await rows()).toEqual(expectedRows);
    if (action === "一次性排序" || action === "移除分组") await expect(panel).toHaveCount(0);
    if (view.kind === "gallery" || view.kind === "kanban") {
      await page.evaluate(() => (window.databaseQueryRejectNext = true));
      await direction.selectOption("asc");
      expect(await page.evaluate(() => window.databaseQueryRejectNext)).toBe(false);
      expect(await direction.inputValue()).toBe("desc");
      expect(await snapshot()).toEqual(saved);
      expect(await rows()).toEqual(expectedRows);
    }
    if (action === "一次性排序") {
      await open();
      await add.click();
      await direction.selectOption("desc");
      await confirm.click();
      await expect(panel).toHaveCount(0);
      expect(await snapshot()).toEqual(saved);
    }

    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseQueryRejectEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await snapshot()).toEqual(original);
    expect(await rows()).toEqual(originalRows);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseQueryRejectEditor").editor.commands.redo()),
    ).toBe(true);
    expect(await snapshot()).toEqual(saved);
    expect(await rows()).toEqual(expectedRows);
    expect(errors).toEqual([]);
  });
}
