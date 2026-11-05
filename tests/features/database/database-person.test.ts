import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    personDatabaseEditor?: EditorController;
  }
}

test("person defaults and cell selections use host results, persist and undo", async ({ page }) => {
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "personDatabaseContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'person-database-test'
      document.body.prepend(host)
      window.personDatabaseEditor = createEditor({
        element: host, outline: false, content: window.personDatabaseContent,
        searchMentions: async query => [
          { id: 'account:one', label: '甲', kind: 'person' },
          { id: 'account:two', label: '乙', kind: 'person' },
          { id: 'doc', label: '文档', kind: 'document' },
        ].filter(item => item.label.includes(query)),
        onError: error => { window.personDatabaseError = error.message },
      })
    `,
  });
  const root = page.locator("#person-database-test .semlo-editor-database");
  await root.getByRole("button", { name: "添加列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("负责人");
  await dialog.getByLabel("列类型").selectOption("person");
  await expect(dialog.locator(".semlo-editor-database-person-results")).toContainText("甲", { timeout: 5000 });
  await dialog.getByRole("button", { name: "甲", exact: true }).click();
  await expect(dialog.getByLabel("默认选项 甲")).toBeChecked();
  await expect(dialog.getByRole("button", { name: "文档", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(root.getByLabel("第 1 行 负责人")).not.toContainText("甲");
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(root.getByLabel("第 4 行 负责人")).toContainText("甲");
  await root.getByLabel("第 1 行 负责人").click();
  const picker = root.getByRole("dialog", { name: "负责人 人员" });
  await picker.getByLabel("搜索人员").fill("乙");
  await picker.getByRole("button", { name: "乙", exact: true }).click();
  await expect(root.getByLabel("第 1 行 负责人")).toContainText("乙");
  const read = async (): Promise<DatabaseData> =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("personDatabaseEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  let saved = await read();
  const field = saved.fields.find((entry) => entry.type === "person")!;
  expect(field.options.map((item) => item.externalId)).toEqual(["account:one", "account:two"]);
  expect(saved.records[0].values[field.id]).toEqual([field.options[1].id]);
  expect(await page.evaluate(() => window.__semloRequireFixture("personDatabaseEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("第 1 行 负责人")).not.toContainText("乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("personDatabaseEditor").editor.commands.redo())).toBe(
    true,
  );
  saved = await read();
  expect(saved.records[0].values[field.id]).toEqual([field.options[1].id]);
  await page.evaluate(() => {
    window.__semloRequireFixture("personDatabaseEditor").setIntegrations({
      searchMentions: async () => [{ id: "account:three", label: "丙", kind: "person" }],
    });
  });
  await root.getByLabel("第 1 行 负责人").click();
  await expect(root.getByRole("dialog", { name: "负责人 人员" }).getByRole("button", { name: "丙" })).toBeVisible();
  await root.getByRole("dialog", { name: "负责人 人员" }).getByRole("button", { name: "丙" }).click();
  await expect(root.getByLabel("第 1 行 负责人")).toContainText("丙");
  await page.evaluate(() => {
    window.__semloRequireFixture("personDatabaseEditor").setIntegrations({ searchMentions: async () => [] });
  });
  await root.getByLabel("第 1 行 负责人").click();
  await expect(root.getByRole("dialog", { name: "负责人 人员" })).toContainText("没有找到人员");
  await root.getByRole("dialog", { name: "负责人 人员" }).getByRole("button", { name: "关闭" }).click();
  await page.evaluate(() => {
    window.__semloRequireFixture("personDatabaseEditor").setIntegrations({
      searchMentions: async () => {
        throw new Error("搜索故障");
      },
    });
  });
  await root.getByLabel("第 1 行 负责人").click();
  await expect(root.getByRole("dialog", { name: "负责人 人员" })).toContainText("人员搜索失败");
  expect(await page.evaluate(() => Reflect.get(window, "personDatabaseError"))).toBe("搜索故障");
  const persisted = await page.evaluate(() => window.__semloRequireFixture("personDatabaseEditor").getSnapshot().json);
  await page.evaluate((snapshot) => {
    window.__semloRequireFixture("personDatabaseEditor").setContent(snapshot);
  }, persisted);
  await expect(root.getByLabel("第 1 行 负责人")).toContainText("丙");
  await page.evaluate(() => {
    window.__semloRequireFixture("personDatabaseEditor").setIntegrations({
      searchMentions: (query) => {
        if (query === "旧") return new Promise((resolve) => Reflect.set(window, "resolveOldPersonSearch", resolve));
        return Promise.resolve(query === "新" ? [{ id: "new", label: "新结果", kind: "person" }] : []);
      },
    });
  });
  await root.getByLabel("第 1 行 负责人").click();
  const laterPicker = root.getByRole("dialog", { name: "负责人 人员" });
  await laterPicker.getByLabel("搜索人员").fill("旧");
  await laterPicker.getByLabel("搜索人员").fill("新");
  await expect(laterPicker.getByRole("button", { name: "新结果" })).toBeVisible();
  await page.evaluate(() => {
    const resolve = Reflect.get(window, "resolveOldPersonSearch") as (value: unknown) => void;
    resolve([{ id: "old", label: "旧结果", kind: "person" }]);
  });
  await expect(laterPicker.getByRole("button", { name: "旧结果" })).toHaveCount(0);
  await expect(laterPicker.getByRole("button", { name: "新结果" })).toBeVisible();
  await laterPicker.getByRole("button", { name: "关闭" }).click();
  await page.evaluate(() => window.__semloRequireFixture("personDatabaseEditor").setIntegrations({}));
  await root.getByLabel("第 1 行 负责人").click();
  await expect(root.getByRole("dialog", { name: "负责人 人员" })).toContainText("请先配置人员搜索");
});
