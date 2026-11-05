import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    createdTimeEditor?: EditorController;
  }
}

test("creation time records the actual record time and survives field changes and history", async ({ page }) => {
  const data = createDatabaseData();
  data.records[0].createdAt = "2026-01-02T03:04:05.000Z";
  delete data.records[1].createdAt;
  data.records[2].createdAt = "2026-02-03T04:05:06.000Z";
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.clock.setFixedTime(new Date("2026-11-04T10:00:00Z"));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "createdTimeContent", initial), content);
  const mount = async () => {
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'created-time-test'
        document.body.prepend(host)
        window.createdTimeEditor = createEditor({ element: host, outline: false, content: window.createdTimeContent })
      `,
    });
  };
  await mount();
  const root = page.locator("#created-time-test .semlo-editor-database");
  await root.getByRole("button", { name: "添加列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("创建时间");
  await dialog.getByLabel("列类型").selectOption("createdTime");
  await dialog.getByLabel("日期格式").selectOption("year");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(root.getByLabel("第 1 行 创建时间")).toHaveText("2026");
  await expect(root.getByLabel("第 2 行 创建时间")).toHaveText("");
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(root.getByLabel("第 4 行 创建时间")).toHaveText("2026");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("createdTimeEditor").getSnapshot().json);
  const saved = snapshot.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData;
  const field = saved.fields.find((entry) => entry.type === "createdTime")!;
  expect(field.timeFormat).toBe("year");
  expect(saved.records.map((record) => record.values[field.id])).toEqual([
    "2026-01-02T03:04:05.000Z",
    "",
    "2026-02-03T04:05:06.000Z",
    "2026-11-04T10:00:00.000Z",
  ]);
  expect(saved.records[3].createdAt).toBe("2026-11-04T10:00:00.000Z");
  expect(await page.evaluate(() => window.__semloRequireFixture("createdTimeEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("第 4 行 创建时间")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("createdTimeEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("createdTimeEditor").getSnapshot().json)).toEqual(
    snapshot,
  );
  await page.evaluate((savedContent) => {
    window.__semloRequireFixture("createdTimeEditor").destroy();
    Reflect.set(window, "createdTimeContent", savedContent);
    document.getElementById("created-time-test")?.remove();
  }, snapshot);
  await mount();
  await expect(root.getByLabel("第 1 行 创建时间")).toHaveText("2026");
  await expect(root.getByLabel("第 2 行 创建时间")).toHaveText("");
  await expect(root.getByLabel("第 4 行 创建时间")).toHaveText("2026");
});
