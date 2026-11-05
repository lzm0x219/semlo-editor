import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} propagates current identity changes to database records`, async ({ page }) => {
    const data = createDatabaseData();
    const author = createDatabaseField("修改人", "modifiedBy");
    data.fields.push(author);
    for (const record of data.records) record.values[author.id] = "";
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate((initial) => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      fixture.controller.setContent({
        type: "doc",
        content: [{ type: "semloEditorDatabase", attrs: { data: initial } }, { type: "paragraph" }],
      });
      Reflect.apply(fixture.setIntegrations, fixture, [{ currentUser: () => ({ id: "a", label: "甲" }) }]);
    }, data);
    await page.evaluate(() =>
      Reflect.apply(Reflect.get(window.__semloRequireFixture("dynamicEditor"), "settle"), null, []),
    );
    const root = page.locator("#dynamic-editor .semlo-editor-database");
    await expect(root.getByLabel("第 1 行 文本")).toBeVisible();
    const read = async (): Promise<DatabaseData> =>
      page.evaluate(
        () =>
          window
            .__semloRequireFixture("dynamicEditor")
            .controller.getSnapshot()
            .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
      );
    await root.getByLabel("第 1 行 文本").fill("甲修改");
    await root.getByLabel("第 1 行 文本").press("Tab");
    await expect.poll(async () => (await read()).records[0].modifiedBy).toEqual({ id: "a", label: "甲" });
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      Reflect.apply(fixture.setIntegrations, fixture, [{ currentUser: () => ({ id: "b", label: "乙" }) }]);
    });
    await page.evaluate(() =>
      Reflect.apply(Reflect.get(window.__semloRequireFixture("dynamicEditor"), "settle"), null, []),
    );
    await root.getByRole("button", { name: "添加记录", exact: true }).click();
    expect((await read()).records[3].createdBy).toEqual({ id: "b", label: "乙" });
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      Reflect.apply(fixture.setIntegrations, fixture, [{ currentUser: () => ({ id: "", label: "无效" }) }]);
    });
    await page.evaluate(() =>
      Reflect.apply(Reflect.get(window.__semloRequireFixture("dynamicEditor"), "settle"), null, []),
    );
    await root.getByLabel("第 1 行 文本").fill("无效身份");
    await root.getByLabel("第 1 行 文本").press("Tab");
    expect((await read()).records[0].values[data.fields[0].id]).toBe("甲修改");
    expect((await read()).records[0].modifiedBy).toEqual({ id: "a", label: "甲" });
    expect(await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").errors)).toHaveLength(1);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      Reflect.apply(fixture.setIntegrations, fixture, [{ currentUser: () => null }]);
    });
    await page.evaluate(() =>
      Reflect.apply(Reflect.get(window.__semloRequireFixture("dynamicEditor"), "settle"), null, []),
    );
    await root.getByLabel("第 1 行 文本").fill("匿名修改");
    await root.getByLabel("第 1 行 文本").press("Tab");
    expect((await read()).records[0].modifiedBy).toBeUndefined();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.commands.undo()),
    ).toBe(true);
    expect((await read()).records[0].modifiedBy).toEqual({ id: "a", label: "甲" });
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });
}
