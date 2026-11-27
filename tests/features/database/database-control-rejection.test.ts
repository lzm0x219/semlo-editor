import { expect, test, type Page } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseControlRejectEditor?: EditorController;
    databaseControlRejectNext?: boolean;
  }
}

async function mountDatabase(page: Page, data: DatabaseData) {
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseControlRejectContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Plugin } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'database-control-reject'
      document.body.prepend(host)
      const controller = createEditor({
        element: host,
        outline: false,
        content: window.databaseControlRejectContent,
        searchMentions: async () => [
          { id: 'account:one', label: '甲', kind: 'person' },
          { id: 'account:two', label: '乙', kind: 'person' },
        ],
      })
      controller.editor.registerPlugin(new Plugin({
        filterTransaction(transaction) {
          if (!window.databaseControlRejectNext || !transaction.docChanged) return true
          window.databaseControlRejectNext = false
          return false
        },
      }))
      window.databaseControlRejectEditor = controller
    `,
  });
  const root = page.locator("#database-control-reject .semlo-editor-database");
  await expect(root).toBeVisible();
  return {
    root,
    snapshot: () => page.evaluate(() => window.__semloRequireFixture("databaseControlRejectEditor").getSnapshot()),
    readData: async () =>
      (await page.evaluate(
        () => window.__semloRequireFixture("databaseControlRejectEditor").getSnapshot().json.content![0].attrs!.data,
      )) as DatabaseData,
    undo: () => page.evaluate(() => window.__semloRequireFixture("databaseControlRejectEditor").editor.commands.undo()),
    redo: () => page.evaluate(() => window.__semloRequireFixture("databaseControlRejectEditor").editor.commands.redo()),
    rejectNext: () => page.evaluate(() => (window.databaseControlRejectNext = true)),
    rejectedCleared: () => page.evaluate(() => window.databaseControlRejectNext === false),
  };
}

test("宿主拒绝复选框、选项、人员和文件删除写入时恢复控件并支持重试与撤销", async ({ page }) => {
  await installFixtureGuards(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const data = createDatabaseData();
  const [text, select] = data.fields;
  const checkField = createDatabaseField("完成", "checkbox");
  const personField = createDatabaseField("负责人", "person");
  personField.options = [{ id: "person-1", externalId: "account:one", label: "甲", color: 0 }];
  const fileField = createDatabaseField("附件", "attachment");
  data.fields.push(checkField, personField, fileField);
  data.records.forEach((record, index) => {
    record.values[text.id] = ["B", "C", "A"][index];
    record.values[checkField.id] = false;
    record.values[personField.id] = index === 0 ? ["person-1"] : [];
    record.values[fileField.id] =
      index === 0
        ? [
            {
              id: "file-1",
              name: "spec.pdf",
              url: "https://example.com/spec.pdf",
              size: 128,
              mimeType: "application/pdf",
            },
          ]
        : [];
  });

  const ctx = await mountDatabase(page, data);
  const original = await ctx.snapshot();

  // 1. 复选框单元格
  const checkbox = ctx.root.getByLabel("第 1 行 完成");
  await ctx.rejectNext();
  await checkbox.click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(original);
  await expect(checkbox).not.toBeChecked();

  await checkbox.click();
  await expect(checkbox).toBeChecked();
  expect((await ctx.readData()).records[0].values[checkField.id]).toBe(true);
  expect(await ctx.undo()).toBe(true);
  expect(await ctx.snapshot()).toEqual(original);
  await expect(checkbox).not.toBeChecked();
  expect(await ctx.redo()).toBe(true);
  await expect(checkbox).toBeChecked();

  // 2. 单选弹出层
  const selectCell = ctx.root.getByLabel(`第 1 行 ${select.name}`);
  await selectCell.click();
  const optionDialog = ctx.root.getByRole("dialog", { name: `${select.name} 选项` });
  const firstOption = select.options[0];
  const beforeOption = await ctx.snapshot();
  await ctx.rejectNext();
  await optionDialog.getByRole("button", { name: firstOption.label }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeOption);
  await expect(optionDialog).toBeVisible();
  await optionDialog.getByRole("button", { name: firstOption.label }).click();
  await expect(optionDialog).toHaveCount(0);
  expect((await ctx.readData()).records[0].values[select.id]).toBe(firstOption.id);

  // 3. 人员移除与添加
  const personCell = ctx.root.getByLabel("第 1 行 负责人");
  await personCell.click();
  const personDialog = ctx.root.getByRole("dialog", { name: "负责人 人员" });
  await expect(personDialog.locator(".semlo-editor-database-person-results")).toContainText("乙", { timeout: 5000 });
  const beforeRemovePerson = await ctx.snapshot();
  await ctx.rejectNext();
  await personDialog.getByRole("button", { name: "移除 甲" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeRemovePerson);
  await expect(personDialog).toBeVisible();
  await personDialog.getByRole("button", { name: "移除 甲" }).click();
  await expect(personDialog).toHaveCount(0);
  expect((await ctx.readData()).records[0].values[personField.id]).toEqual([]);

  await personCell.click();
  await expect(personDialog.locator(".semlo-editor-database-person-results")).toContainText("乙", { timeout: 5000 });
  const beforePickPerson = await ctx.snapshot();
  await ctx.rejectNext();
  await personDialog.getByRole("button", { name: "乙", exact: true }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforePickPerson);
  await expect(personDialog).toBeVisible();
  await personDialog.getByRole("button", { name: "乙", exact: true }).click();
  await expect(personDialog).toHaveCount(0);
  expect((await ctx.readData()).records[0].values[personField.id]).toHaveLength(1);

  // 4. 删除文件
  const fileCell = ctx.root.getByLabel("第 1 行 附件");
  await fileCell.click();
  const fileDialog = ctx.root.getByRole("dialog", { name: "附件 文件" });
  const beforeDeleteFile = await ctx.snapshot();
  await ctx.rejectNext();
  await fileDialog.getByRole("button", { name: "删除文件 spec.pdf" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeDeleteFile);
  await expect(fileDialog).toBeVisible();
  await fileDialog.getByRole("button", { name: "删除文件 spec.pdf" }).click();
  await expect(fileDialog).toHaveCount(0);
  expect((await ctx.readData()).records[0].values[fileField.id]).toEqual([]);
  expect(errors).toEqual([]);
});

test("宿主拒绝字段配置、日历设置、视图与行高修改时恢复控件并保持重试入口", async ({ page }) => {
  await installFixtureGuards(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const data = createDatabaseData();
  const [text, select, date] = data.fields;
  const extraText = createDatabaseField("备注", "text");
  data.fields.push(extraText);
  const galleryView = createDatabaseView("画册视图", "gallery");
  const calendarView = createDatabaseView("日历视图", "calendar");
  calendarView.calendar.titleFieldId = text.id;
  calendarView.calendar.startFieldId = date.id;
  calendarView.calendar.endFieldId = date.id;
  data.views = [data.views[0], galleryView, calendarView];
  data.activeViewId = galleryView.id;

  const ctx = await mountDatabase(page, data);

  // 1. 字段配置：显示字段名 & 隐藏字段
  await ctx.root.getByRole("button", { name: "字段配置" }).click();
  const fieldsDialog = ctx.root.getByRole("dialog", { name: "字段配置" });
  const showFieldNames = fieldsDialog.getByLabel("显示字段名");
  const showOption = fieldsDialog.getByLabel(`显示${select.name}`);
  const beforeFields = await ctx.snapshot();

  await ctx.rejectNext();
  await showFieldNames.click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeFields);
  await expect(showFieldNames).not.toBeChecked();
  await showFieldNames.click();
  await expect(showFieldNames).toBeChecked();
  expect((await ctx.readData()).views[1].showFieldNames).toBe(true);

  const beforeHide = await ctx.snapshot();
  await ctx.rejectNext();
  await showOption.click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeHide);
  await expect(showOption).toBeChecked();
  await showOption.click();
  await expect(showOption).not.toBeChecked();
  expect((await ctx.readData()).views[1].hiddenFields).toContain(select.id);

  // 2. 切换视图 & 新建视图 & 删除视图
  await ctx.root.getByRole("button", { name: "切换视图" }).click();
  const switchDialog = ctx.root.getByRole("dialog", { name: "切换视图" });
  const beforeSwitch = await ctx.snapshot();
  await ctx.rejectNext();
  await switchDialog.getByRole("button", { name: `切换到${calendarView.name}` }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeSwitch);
  await expect(switchDialog).toBeVisible();
  await switchDialog.getByRole("button", { name: `切换到${calendarView.name}` }).click();
  await expect(switchDialog).toHaveCount(0);
  expect((await ctx.readData()).activeViewId).toBe(calendarView.id);

  // 3. 日历设置
  await ctx.root.getByRole("button", { name: "日历设置" }).click();
  const calendarDialog = ctx.root.getByRole("dialog", { name: "日历设置" });
  const titleSelect = calendarDialog.getByLabel("标题展示");
  const colorMode = calendarDialog.getByLabel("颜色显示");
  const colorField = calendarDialog.getByLabel("颜色字段");
  const showLunar = calendarDialog.getByLabel("农历及节假日");
  const beforeCal = await ctx.snapshot();

  await ctx.rejectNext();
  await titleSelect.selectOption(extraText.id);
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeCal);
  await expect(titleSelect).toHaveValue(text.id);
  await titleSelect.selectOption(extraText.id);
  expect((await ctx.readData()).views[2].calendar.titleFieldId).toBe(extraText.id);

  const beforeColorMode = await ctx.snapshot();
  await ctx.rejectNext();
  await colorMode.selectOption("field");
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeColorMode);
  await expect(colorMode).toHaveValue("custom");
  await expect(colorField).toBeHidden();
  await colorMode.selectOption("field");
  await expect(colorMode).toHaveValue("field");
  await expect(colorField).toBeVisible();
  expect((await ctx.readData()).views[2].calendar.colorFieldId).toBe(select.id);

  const beforeLunar = await ctx.snapshot();
  await ctx.rejectNext();
  await showLunar.click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeLunar);
  await expect(showLunar).not.toBeChecked();
  await showLunar.click();
  await expect(showLunar).toBeChecked();
  expect((await ctx.readData()).views[2].calendar.showLunar).toBe(true);

  // 4. 视图名称、新建视图、删除视图、行高
  const viewName = ctx.root.getByLabel("视图名称");
  const beforeName = await ctx.snapshot();
  await ctx.rejectNext();
  await viewName.fill("新日历");
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeName);
  await expect(viewName).toHaveValue(calendarView.name);
  await viewName.fill("新日历");
  expect((await ctx.readData()).views[2].name).toBe("新日历");

  await ctx.root.getByRole("button", { name: "新建视图" }).click();
  const newViewDialog = ctx.root.getByRole("dialog", { name: "新建视图" });
  const beforeCreate = await ctx.snapshot();
  await ctx.rejectNext();
  await newViewDialog.getByRole("button", { name: "表格", exact: true }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeCreate);
  await expect(newViewDialog).toBeVisible();
  await newViewDialog.getByRole("button", { name: "表格", exact: true }).click();
  await expect(newViewDialog).toHaveCount(0);
  expect((await ctx.readData()).views).toHaveLength(4);

  await ctx.root.getByRole("button", { name: "行高" }).click();
  const heightDialog = ctx.root.getByRole("dialog", { name: "行高" });
  const beforeHeight = await ctx.snapshot();
  await ctx.rejectNext();
  await heightDialog.getByRole("button", { name: "宽松", exact: true }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeHeight);
  await expect(heightDialog).toBeVisible();
  await heightDialog.getByRole("button", { name: "宽松", exact: true }).click();
  await expect(heightDialog).toHaveCount(0);
  expect((await ctx.readData()).views[3].rowHeight).toBe("large");

  await ctx.root.getByRole("button", { name: "切换视图" }).click();
  const beforeDeleteView = await ctx.snapshot();
  await ctx.rejectNext();
  await switchDialog.getByRole("button", { name: "删除当前视图" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeDeleteView);
  await expect(switchDialog).toBeVisible();
  await switchDialog.getByRole("button", { name: "删除当前视图" }).click();
  await expect(switchDialog).toHaveCount(0);
  expect((await ctx.readData()).views).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("宿主拒绝列菜单、统计和记录删除写入时保留重试入口与选区", async ({ page }) => {
  await installFixtureGuards(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const data = createDatabaseData();
  const [text] = data.fields;
  const numberField = createDatabaseField("分值", "number");
  data.fields.push(numberField);
  data.records.forEach((record, index) => {
    record.values[text.id] = ["B", "C", "A"][index];
    record.values[numberField.id] = String((index + 1) * 10);
  });
  const galleryView = createDatabaseView("画册视图", "gallery");
  data.views.push(galleryView);

  const ctx = await mountDatabase(page, data);

  // 1. 列菜单：按本列分组、降序、复制列
  await ctx.root.getByRole("button", { name: `${text.name}列菜单` }).click();
  const fieldMenu = ctx.root.getByRole("menu", { name: `${text.name} 列菜单` });
  const beforeGroup = await ctx.snapshot();
  await ctx.rejectNext();
  await fieldMenu.getByRole("menuitem", { name: "按本列分组" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeGroup);
  await expect(fieldMenu).toBeVisible();
  await fieldMenu.getByRole("menuitem", { name: "按本列分组" }).click();
  await expect(fieldMenu).toHaveCount(0);
  expect((await ctx.readData()).views[0].groupFieldId).toBe(text.id);

  await ctx.root.getByRole("button", { name: `${numberField.name}列菜单` }).click();
  const numberMenu = ctx.root.getByRole("menu", { name: `${numberField.name} 列菜单` });
  const beforeSort = await ctx.snapshot();
  await ctx.rejectNext();
  await numberMenu.getByRole("menuitem", { name: "降序" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeSort);
  await expect(numberMenu).toBeVisible();
  await numberMenu.getByRole("menuitem", { name: "降序" }).click();
  await expect(numberMenu).toHaveCount(0);
  expect((await ctx.readData()).views[0].recordOrder).toEqual([
    data.records[2].id,
    data.records[1].id,
    data.records[0].id,
  ]);

  await ctx.root.getByRole("button", { name: `${numberField.name}列菜单` }).click();
  const beforeCopy = await ctx.snapshot();
  await ctx.rejectNext();
  await numberMenu.getByRole("menuitem", { name: "复制列" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeCopy);
  await expect(numberMenu).toBeVisible();
  await numberMenu.getByRole("menuitem", { name: "复制列" }).click();
  await expect(numberMenu).toHaveCount(0);
  expect((await ctx.readData()).fields).toHaveLength(5);

  // 2. 统计面板
  await ctx.root.getByRole("button", { name: `${numberField.name}统计`, exact: true }).click();
  const statDialog = ctx.root.getByRole("dialog", { name: `${numberField.name} 统计` });
  const beforeStat = await ctx.snapshot();
  await ctx.rejectNext();
  await statDialog.getByRole("button", { name: "求和" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeStat);
  await expect(statDialog).toBeVisible();
  await statDialog.getByRole("button", { name: "求和" }).click();
  await expect(statDialog).toHaveCount(0);
  expect((await ctx.readData()).views[0].statistics[numberField.id]).toBe("sum");

  // 3. 表格行勾选后拒绝行删除与批量删除时保留选区
  await ctx.root.getByLabel("选择第 1 条记录").click();
  const batchDelete = ctx.root.getByRole("button", { name: "删除选中记录" });
  await expect(batchDelete).toHaveText("删除 1 条");
  const beforeRowDelete = await ctx.snapshot();
  await ctx.rejectNext();
  await ctx.root.getByRole("button", { name: "删除第 1 条记录" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeRowDelete);
  await expect(ctx.root.getByLabel("选择第 1 条记录")).toBeChecked();
  await expect(batchDelete).toHaveText("删除 1 条");

  await ctx.rejectNext();
  await batchDelete.click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeRowDelete);
  await expect(ctx.root.getByLabel("选择第 1 条记录")).toBeChecked();
  await batchDelete.click();
  expect((await ctx.readData()).records).toHaveLength(2);
  await expect(batchDelete).toHaveCount(0);

  // 4. 记录详情弹窗删除记录
  await ctx.root.getByRole("button", { name: "切换视图" }).click();
  await ctx.root.getByRole("button", { name: `切换到${galleryView.name}` }).click();
  await ctx.root.locator(".semlo-editor-database-card").first().click();
  const recordDialog = ctx.root.getByRole("dialog", { name: "记录详情" });
  const beforeCardDelete = await ctx.snapshot();
  await ctx.rejectNext();
  await recordDialog.getByRole("button", { name: "删除记录" }).click();
  expect(await ctx.rejectedCleared()).toBe(true);
  expect(await ctx.snapshot()).toEqual(beforeCardDelete);
  await expect(recordDialog).toBeVisible();
  await recordDialog.getByRole("button", { name: "删除记录" }).click();
  await expect(recordDialog).toHaveCount(0);
  expect((await ctx.readData()).records).toHaveLength(1);
  expect(errors).toEqual([]);
});
