import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    fieldDefaultsEditor?: EditorController;
  }
}

test("multi-select and checkbox defaults populate new records and survive history and reload", async ({ page }) => {
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "fieldDefaultsContent", initial), content);
  const mount = async () => {
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'field-defaults-test'
        document.body.prepend(host)
        window.fieldDefaultsEditor = createEditor({ element: host, outline: false, content: window.fieldDefaultsContent })
      `,
    });
  };
  await mount();
  const root = page.locator("#field-defaults-test .semlo-editor-database");
  await root.getByRole("button", { name: "添加列" }).click();
  let dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("标签");
  await dialog.getByLabel("列类型").selectOption("multiSelect");
  await dialog.getByRole("button", { name: "新增选项" }).click();
  await dialog.getByLabel("选项名称 1").fill("甲");
  await dialog.getByRole("button", { name: "新增选项" }).click();
  await dialog.getByLabel("选项名称 2").fill("乙");
  await dialog.getByLabel("默认选项 甲").check();
  await dialog.getByLabel("默认选项 乙").check();
  await dialog.getByRole("button", { name: "确定" }).click();
  await root.getByRole("button", { name: "添加列" }).click();
  dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("完成");
  await dialog.getByLabel("列类型").selectOption("checkbox");
  await dialog.getByLabel("默认勾选", { exact: true }).check();
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(root.getByLabel("第 1 行 完成")).not.toBeChecked();
  await expect(root.getByLabel("第 1 行 标签")).not.toContainText("甲");
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(root.getByLabel("第 4 行 完成")).toBeChecked();
  await expect(root.getByLabel("第 4 行 标签")).toContainText("甲");
  await expect(root.getByLabel("第 4 行 标签")).toContainText("乙");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("fieldDefaultsEditor").getSnapshot().json);
  const savedData = snapshot.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData;
  const tags = savedData.fields.find((field) => field.name === "标签")!;
  expect(tags.defaultValue).toEqual(tags.options.map((entry) => entry.id));
  expect(savedData.fields.find((field) => field.name === "完成")?.defaultValue).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("fieldDefaultsEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("第 4 行 完成")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("fieldDefaultsEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(root.getByLabel("第 4 行 完成")).toBeChecked();
  await page.evaluate((saved) => {
    window.__semloRequireFixture("fieldDefaultsEditor").destroy();
    Reflect.set(window, "fieldDefaultsContent", saved);
    document.getElementById("field-defaults-test")?.remove();
  }, snapshot);
  await mount();
  await expect(root.getByLabel("第 4 行 完成")).toBeChecked();
  await expect(root.getByLabel("第 4 行 标签")).toContainText("甲");
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(root.getByLabel("第 5 行 完成")).toBeChecked();
  await expect(root.getByLabel("第 5 行 标签")).toContainText("乙");
  await root.getByRole("button", { name: "标签列菜单" }).click();
  await root.getByRole("menu", { name: "标签 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const edit = root.getByRole("dialog", { name: "编辑列" });
  await expect(edit.getByLabel("默认选项 甲")).toBeChecked();
  await edit.getByLabel("默认选项 甲").uncheck();
  await edit.getByRole("button", { name: "确定" }).click();
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(root.getByLabel("第 6 行 标签")).toContainText("乙");
  await expect(root.getByLabel("第 6 行 标签")).not.toContainText("甲");
  await expect(root.getByLabel("第 5 行 标签")).toContainText("甲");
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  const filter = root.getByRole("dialog", { name: "筛选" });
  await filter.getByLabel("筛选列").selectOption({ label: "完成" });
  await expect(filter.getByLabel("筛选条件")).toHaveValue("notEmpty");
  await expect(filter.getByLabel("筛选值")).toBeHidden();
  await expect(
    root.locator(".semlo-editor-database-row:not(.semlo-editor-database-header):not(.semlo-editor-database-footer)"),
  ).toHaveCount(3);
  await filter.getByLabel("筛选条件").selectOption("empty");
  await expect(
    root.locator(".semlo-editor-database-row:not(.semlo-editor-database-header):not(.semlo-editor-database-footer)"),
  ).toHaveCount(3);
  await expect(root.getByLabel("第 1 行 完成")).not.toBeChecked();
});
