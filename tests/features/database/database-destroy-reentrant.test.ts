import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const action of ["add", "cell", "sort"] as const) {
  test(`${action}: host can synchronously destroy the controller during a data table change`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseDestroyContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host=document.createElement('div'); host.id='database-destroy'; document.body.prepend(host)
      let controller
      controller=createEditor({element:host,outline:false,content:window.databaseDestroyContent,
        onChange:()=>{if(window.databaseDestroyArmed){window.databaseDestroyArmed=false;controller.destroy();window.databaseDestroyed=true}}})
    `,
    });
    const root = page.locator("#database-destroy .semlo-editor-database");
    await expect(root).toBeVisible();
    if (action === "sort") {
      await root.getByRole("button", { name: "排序", exact: true }).click();
      await root.getByRole("dialog", { name: "排序" }).getByRole("button", { name: "添加排序" }).click();
    }
    await page.evaluate(() => Reflect.set(window, "databaseDestroyArmed", true));
    if (action === "add") await root.getByRole("button", { name: "添加记录", exact: true }).click();
    else if (action === "cell") await root.getByLabel("第 1 行 文本").fill("变化");
    else await root.getByRole("dialog", { name: "排序" }).getByLabel("保持排序").click();
    await page.waitForFunction(() => Reflect.get(window, "databaseDestroyed") === true);
    await expect(root).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("a synchronous onChange replacement invalidates a sorting draft", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseDestroyContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host=document.createElement('div'); host.id='database-destroy'; document.body.prepend(host)
    let controller
    controller=createEditor({element:host,outline:false,content:window.databaseDestroyContent,
      onChange:snapshot=>{if(window.databaseReplaceArmed){window.databaseReplaceArmed=false;const replacement=structuredClone(snapshot.json);const data=replacement.content[0].attrs.data;data.records[0].values[data.fields[0].id]='新文档';controller.setContent(replacement);window.databaseReplaced=true}}})
    window.databaseReplacementEditor=controller
  `,
  });
  const root = page.locator("#database-destroy .semlo-editor-database");
  await root.getByRole("button", { name: "排序", exact: true }).click();
  const dialog = root.getByRole("dialog", { name: "排序" });
  await dialog.getByRole("button", { name: "添加排序" }).click();
  await page.evaluate(() => {
    Reflect.set(
      window,
      "databaseOldSortConfirm",
      document.querySelector('#database-destroy button[aria-label="确定排序"]'),
    );
    Reflect.set(window, "databaseReplaceArmed", true);
  });
  await dialog.getByLabel("保持排序").click();
  await page.waitForFunction(() => Reflect.get(window, "databaseReplaced") === true);
  await expect(dialog).toHaveCount(0);
  expect(
    await root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((items) => items.map((item) => (item as HTMLInputElement).value)),
  ).toContain("新文档");
  const result = await page.evaluate(() => {
    const controller = Reflect.get(
      window,
      "databaseReplacementEditor",
    ) as import("../../../packages/core/src/types").EditorController;
    const before = controller.getSnapshot().json;
    (Reflect.get(window, "databaseOldSortConfirm") as HTMLButtonElement).click();
    return { before, after: controller.getSnapshot().json };
  });
  expect(result.after).toEqual(result.before);
});
