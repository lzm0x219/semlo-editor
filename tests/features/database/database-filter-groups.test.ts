import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseGroupEditor?: EditorController;
  }
}

for (const width of [1280, 390]) {
  test(`嵌套筛选分组独立计算关系并保留在 JSON、HTML 和撤销历史中（${width}px）`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.setViewportSize({ width, height: 844 });
    const data = createDatabaseData();
    const name = data.fields[0];
    const quantity = createDatabaseField("验收数量", "number");
    data.fields.push(quantity);
    const names = ["筛选样本甲", "筛选样本乙", "对照样本丙"];
    data.records.forEach((record, index) => {
      record.values[name.id] = names[index];
      record.values[quantity.id] = ["0", "10", "20"][index];
    });
    const initial = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'database-filter-groups'; document.body.prepend(host);
      window.databaseGroupEditor = createEditor({element: host, outline: false, content: ${JSON.stringify(initial)}});
    `,
    });
    const root = page.locator("#database-filter-groups .semlo-editor-database");
    const namesInView = () =>
      root
        .locator(`input[aria-label$=" ${name.name}"]`)
        .evaluateAll((controls) => controls.map((node) => (node as HTMLInputElement).value));
    const panel = root.getByRole("dialog", { name: "筛选" });
    const openFilter = async () => {
      await root.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(panel).toBeVisible();
    };
    const actions = (scope: typeof panel) => scope.locator(":scope > .semlo-editor-database-filter-actions");
    const rules = (scope: typeof panel) => scope.locator(":scope > .semlo-editor-database-rule");
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("databaseGroupEditor").getSnapshot());

    await openFilter();
    await rules(panel).getByLabel("筛选值").fill("筛选");
    await actions(panel).getByRole("button", { name: "添加筛选分组" }).click();
    const group = panel.locator(":scope > .semlo-editor-database-filter-group");
    await rules(group).getByLabel("筛选值").fill("对照");
    await actions(group).getByRole("button", { name: "添加筛选分组" }).click();
    const subgroup = group.locator(":scope > .semlo-editor-database-filter-group");
    await rules(subgroup).getByLabel("筛选列").selectOption(quantity.id);
    await rules(subgroup).getByLabel("筛选条件").selectOption("greater");
    await rules(subgroup).getByLabel("筛选值").fill("0");
    await actions(subgroup).getByRole("button", { name: "添加筛选规则" }).click();
    const subtreeMode = subgroup.locator(':scope > [aria-label="分组内筛选关系"]');
    await subtreeMode.selectOption("and");
    await rules(subgroup).last().getByLabel("筛选值").fill("筛选");
    await expect.poll(namesInView).toEqual(["筛选样本乙"]);
    await expect(group.locator(':scope > [aria-label="分组内筛选关系"]')).toHaveValue("or");

    const input = rules(subgroup).first().getByLabel("筛选值");
    await input.fill("15");
    await expect.poll(namesInView).toEqual([]);
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("0");
    await expect(input).toBeFocused();
    await expect.poll(namesInView).toEqual(["筛选样本乙"]);
    await input.press("ControlOrMeta+Shift+z");
    await expect(input).toHaveValue("15");
    await expect.poll(namesInView).toEqual([]);
    await input.press("ControlOrMeta+z");

    await panel.getByLabel("筛选关系", { exact: true }).selectOption("or");
    await expect.poll(namesInView).toEqual(names);
    const saved = await snapshot();
    for (const stored of [saved.html, saved.json]) {
      await page.evaluate((value) => {
        const editor = window.__semloRequireFixture("databaseGroupEditor");
        editor.setContent("<p>重新打开</p>");
        editor.setContent(value);
      }, stored);
      expect(await snapshot()).toEqual(saved);
      await expect.poll(namesInView).toEqual(names);
    }
    await openFilter();
    await expect(rules(subgroup).first().getByLabel("筛选值")).toHaveValue("0");
    await expect(subtreeMode).toHaveValue("and");
    await group.getByRole("button", { name: "删除筛选分组" }).first().click();
    await expect.poll(namesInView).toEqual(names.slice(0, 2));
    expect(await page.evaluate(() => window.__semloRequireFixture("databaseGroupEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await snapshot()).toEqual(saved);
  });
}
