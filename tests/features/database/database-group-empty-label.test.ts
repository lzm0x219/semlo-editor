import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  databaseGroupKey,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    groupEmptyLabelEditor?: EditorController;
  }
}

test("group identity does not collapse different people or multi-select options with equal labels", () => {
  for (const type of ["multiSelect", "person"] as const) {
    const field = createDatabaseField("字段", type);
    field.options = [
      { id: "one", label: "同名", color: 0 },
      { id: "two", label: "同名", color: 1 },
    ];
    expect(databaseGroupKey(field, ["one"])).not.toBe(databaseGroupKey(field, ["two"]));
  }
  const actor = createDatabaseField("创建人", "createdBy");
  expect(databaseGroupKey(actor, { id: "one", label: "旧名" })).toBe(
    databaseGroupKey(actor, { id: "one", label: "新名" }),
  );
  expect(databaseGroupKey(actor, { id: "one", label: "同名" })).not.toBe(
    databaseGroupKey(actor, { id: "two", label: "同名" }),
  );
});

test("literal empty placeholder text and missing values form separate groups", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[0];
  data.records[1].values[field.id] = "（空）";
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupEmptyLabelContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-empty-label-test'
    document.body.prepend(host)
    window.groupEmptyLabelEditor = createEditor({ element: host, outline: false, content: window.groupEmptyLabelContent })
  `,
  });
  const root = page.locator("#group-empty-label-test .semlo-editor-database");
  const groups = root.getByRole("button", { name: "折叠分组 （空）", exact: true });
  await expect(groups).toHaveCount(2);
  await expect(root.locator(".semlo-editor-database-record-index")).toHaveCount(3);
  await groups.first().click();
  await expect(groups.first()).toHaveAttribute("aria-expanded", "false");
  await expect(groups.last()).toHaveAttribute("aria-expanded", "true");
  await expect(root.locator(".semlo-editor-database-record-index")).toHaveCount(1);
  await expect(root.getByLabel("第 3 行 文本")).toHaveValue("（空）");
});

test("same-named options remain separate groups and dragging updates the option identity", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.options = [
    { id: "first", label: "相同", color: 0 },
    { id: "second", label: "相同", color: 1 },
  ];
  data.records[0].values[field.id] = "first";
  data.records[1].values[field.id] = "second";
  data.records[2].values[field.id] = "first";
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupEmptyLabelContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-empty-label-test'
    document.body.prepend(host)
    window.groupEmptyLabelEditor = createEditor({ element: host, outline: false, content: window.groupEmptyLabelContent })
  `,
  });
  const root = page.locator("#group-empty-label-test .semlo-editor-database");
  const groups = root.getByRole("button", { name: "折叠分组 相同", exact: true });
  await expect(groups).toHaveCount(2);
  const source = root.getByRole("button", { name: "移动第 3 条记录" });
  await source.locator("..").hover();
  await source.dragTo(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true }).locator(".."), {
    targetPosition: { x: 25, y: 2 },
  });
  const saved = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("groupEmptyLabelEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
  );
  expect(saved.records[1].values[field.id]).toBe("first");
  await expect(groups).toHaveCount(1);
  expect(await page.evaluate(() => window.__semloRequireFixture("groupEmptyLabelEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(groups).toHaveCount(2);
});
