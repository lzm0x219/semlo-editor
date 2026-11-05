import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    groupMetadataEditor?: EditorController;
  }
}

test("cross-group movement updates automatic edit metadata and undo restores it", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData({ id: "author", label: "作者" });
  const checkbox = createDatabaseField("完成", "checkbox");
  const modifiedTime = createDatabaseField("修改时间", "modifiedTime");
  const modifiedBy = createDatabaseField("修改人", "modifiedBy");
  data.fields.push(checkbox, modifiedTime, modifiedBy);
  data.views[0].groupFieldId = checkbox.id;
  const record = data.records[2];
  record.values[checkbox.id] = true;
  record.modifiedAt = "2020-01-02T03:04:05.000Z";
  record.values[modifiedTime.id] = record.modifiedAt;
  record.values[modifiedBy.id] = { id: "author", label: "作者" };
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupMetadataContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-metadata-test'
    document.body.prepend(host)
    window.groupMetadataEditor = createEditor({ element: host, outline: false, content: window.groupMetadataContent, currentUser: () => ({ id: 'editor', label: '编辑者' }) })
  `,
  });
  const root = page.locator("#group-metadata-test .semlo-editor-database");
  const source = root.getByRole("button", { name: "移动第 3 条记录" });
  await source.locator("..").hover();
  await source.dragTo(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true }).locator(".."), {
    targetPosition: { x: 25, y: 2 },
  });
  const read = () =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("groupMetadataEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  let saved = (await read()).records[2];
  expect(saved.values[checkbox.id]).toBe(false);
  expect(saved.createdAt).toBe(record.createdAt);
  expect(saved.modifiedAt).not.toBe(record.modifiedAt);
  expect(saved.modifiedBy).toEqual({ id: "editor", label: "编辑者" });
  expect(saved.values[modifiedTime.id]).toBe(saved.modifiedAt);
  expect(saved.values[modifiedBy.id]).toEqual(saved.modifiedBy);
  expect(await page.evaluate(() => window.__semloRequireFixture("groupMetadataEditor").editor.commands.undo())).toBe(
    true,
  );
  saved = (await read()).records[2];
  expect(saved.values[checkbox.id]).toBe(true);
  expect(saved.modifiedAt).toBe(record.modifiedAt);
  expect(saved.modifiedBy).toEqual({ id: "author", label: "作者" });
  expect(saved.values[modifiedTime.id]).toBe(record.modifiedAt);
});
