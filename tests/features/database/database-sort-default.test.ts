import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    sortDefaultEditor?: EditorController;
  }
}

test("new sorting is a cancellable one-time draft unless keeping it is enabled", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  data.records.forEach((record, index) => {
    record.values[data.fields[0].id] = ["B", "C", "A"][index];
  });
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "sortDefaultContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'sort-default-test'
    document.body.prepend(host)
    window.sortDefaultEditor = createEditor({ element: host, outline: false, content: window.sortDefaultContent })
  `,
  });
  const root = page.locator("#sort-default-test .semlo-editor-database");
  const panel = root.getByRole("dialog", { name: "排序" });
  const rows = () =>
    root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  const read = () =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("sortDefaultEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  const open = async () => {
    await root.getByRole("button", { name: "排序", exact: true }).click();
    await panel.getByRole("button", { name: "添加排序" }).click();
  };
  await open();
  await expect(panel.getByLabel("保持排序")).not.toBeChecked();
  await panel.getByLabel("排序顺序").selectOption("desc");
  expect(await rows()).toEqual(["B", "C", "A"]);
  expect((await read()).views[0].sorts).toEqual([]);
  await panel.getByRole("button", { name: "取消排序" }).click();
  expect(await rows()).toEqual(["B", "C", "A"]);
  await open();
  await expect(panel.getByLabel("保持排序")).not.toBeChecked();
  await panel.getByRole("button", { name: "确定排序" }).click();
  expect(await rows()).toEqual(["A", "B", "C"]);
  expect((await read()).views[0].sorts).toEqual([]);
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__semloRequireFixture("sortDefaultEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await rows()).toEqual(["B", "C", "A"]);
  await open();
  await panel.getByLabel("保持排序").check();
  expect((await read()).views[0].sorts).toHaveLength(1);
  expect(await rows()).toEqual(["A", "B", "C"]);
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeDisabled();
  await panel.getByLabel("排序顺序").selectOption("desc");
  expect(await rows()).toEqual(["C", "B", "A"]);
  await panel.getByLabel("保持排序").click();
  expect((await read()).views[0].sorts).toEqual([]);
  expect(await rows()).toEqual(["C", "B", "A"]);
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeEnabled();
  const staleResult = await page.evaluate(() => {
    const oldConfirm = document.querySelector<HTMLButtonElement>('#sort-default-test button[aria-label="确定排序"]')!;
    const editor = window.__semloRequireFixture("sortDefaultEditor");
    const replacement = editor.getSnapshot().json;
    replacement.content?.push({ type: "paragraph", content: [{ type: "text", text: "替换" }] });
    editor.setContent(replacement);
    const before = editor.getSnapshot().json;
    oldConfirm.click();
    return { before, after: editor.getSnapshot().json };
  });
  expect(staleResult.after).toEqual(staleResult.before);
});

test("one-time sorting also orders records hidden by the active filter", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  data.records.forEach((record, index) => {
    record.values[data.fields[0].id] = ["B", "C", "A"][index];
  });
  data.views[0].filters = [{ id: "exclude-b", fieldId: data.fields[0].id, operator: "notEquals", value: "B" }];
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "sortDefaultContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'sort-default-test'
    document.body.prepend(host)
    window.sortDefaultEditor = createEditor({ element: host, outline: false, content: window.sortDefaultContent })
  `,
  });
  const root = page.locator("#sort-default-test .semlo-editor-database");
  await root.getByRole("button", { name: "排序", exact: true }).click();
  const panel = root.getByRole("dialog", { name: "排序" });
  await panel.getByRole("button", { name: "添加排序" }).click();
  await panel.getByRole("button", { name: "确定排序" }).click();
  const saved = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("sortDefaultEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
  );
  expect(saved.views[0].recordOrder).toEqual([data.records[2].id, data.records[0].id, data.records[1].id]);
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  await root.getByRole("dialog", { name: "筛选" }).getByRole("button", { name: "删除筛选规则" }).click();
  expect(
    await root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
  ).toEqual(["A", "B", "C"]);
});
