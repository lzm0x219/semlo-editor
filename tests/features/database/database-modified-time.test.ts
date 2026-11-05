import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    modifiedTimeEditor?: EditorController;
  }
}

test("record changes update modification time while view changes do not, and history restores it", async ({ page }) => {
  const data = createDatabaseData();
  const field = createDatabaseField("修改时间", "modifiedTime");
  data.fields.push(field);
  for (const record of data.records) {
    record.createdAt = "2026-01-01T00:00:00.000Z";
    record.modifiedAt = record.createdAt;
    record.values[field.id] = record.modifiedAt;
  }
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.clock.setFixedTime(new Date("2026-11-04T10:00:00Z"));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "modifiedTimeContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'modified-time-test'
      document.body.prepend(host)
      window.modifiedTimeEditor = createEditor({ element: host, outline: false, content: window.modifiedTimeContent })
    `,
  });
  const root = page.locator("#modified-time-test .semlo-editor-database");
  const read = async (): Promise<DatabaseData> =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("modifiedTimeEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  await root.getByRole("button", { name: "排序", exact: true }).click();
  await root.getByRole("dialog", { name: "排序" }).getByRole("button", { name: "添加排序" }).click();
  await root.getByRole("dialog", { name: "排序" }).getByLabel("保持排序").check();
  expect((await read()).records[0].modifiedAt).toBe("2026-01-01T00:00:00.000Z");
  await root.getByRole("dialog", { name: "排序" }).getByRole("button", { name: "关闭" }).click();
  const input = root.getByLabel("第 1 行 文本");
  await input.fill("新内容");
  expect((await read()).records[0].modifiedAt).toBe("2026-11-04T10:00:00.000Z");
  await input.press("ControlOrMeta+z");
  expect((await read()).records[0].modifiedAt).toBe("2026-01-01T00:00:00.000Z");
  await input.press("ControlOrMeta+Shift+z");
  expect((await read()).records[0].modifiedAt).toBe("2026-11-04T10:00:00.000Z");
  await input.press("Tab");
  let saved = await read();
  expect(saved.records[0].modifiedAt).toBe("2026-11-04T10:00:00.000Z");
  expect(saved.records[0].values[field.id]).toBe(saved.records[0].modifiedAt);
  expect(saved.records[1].modifiedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("modifiedTimeEditor").editor.commands.undo())).toBe(
    true,
  );
  saved = await read();
  expect(saved.records[0].values[data.fields[0].id]).toBe("");
  expect(saved.records[0].modifiedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(saved.records[0].values[field.id]).toBe(saved.records[0].modifiedAt);
  expect(await page.evaluate(() => window.__semloRequireFixture("modifiedTimeEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await read()).records[0].modifiedAt).toBe("2026-11-04T10:00:00.000Z");
  await page.clock.setFixedTime(new Date("2026-11-04T11:00:00Z"));
  await root.locator(`[data-record-id="${data.records[0].id}"][data-field-id="${data.fields[1].id}"] button`).click();
  await root.getByRole("dialog", { name: "单选 选项" }).getByRole("button", { name: "待开始" }).click();
  expect((await read()).records[0].modifiedAt).toBe("2026-11-04T11:00:00.000Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("modifiedTimeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await read()).records[0].modifiedAt).toBe("2026-11-04T10:00:00.000Z");
});
