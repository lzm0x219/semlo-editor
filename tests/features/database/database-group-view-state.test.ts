import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    groupViewStateEditor?: EditorController;
    groupViewStateOther?: EditorController;
  }
}

test("collapsed groups remain local to the view and grouping field", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const first = data.fields[0];
  const second = createDatabaseField("另一文本");
  data.fields.push(second);
  data.records.forEach((record, index) => {
    record.values[first.id] = ["甲", "甲", "乙"][index];
    record.values[second.id] = ["甲", "甲", "乙"][index];
  });
  data.views[0].groupFieldId = first.id;
  const other = createDatabaseView("另一视图");
  other.groupFieldId = first.id;
  data.views.push(other);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupViewStateContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-view-state-test'
    document.body.prepend(host)
    window.groupViewStateEditor = createEditor({ element: host, outline: false, content: window.groupViewStateContent })
  `,
  });
  const root = page.locator("#group-view-state-test .semlo-editor-database");
  const group = root.getByRole("button", { name: "折叠分组 甲" });
  const switchView = async (name: string) => {
    await root.getByRole("button", { name: "切换视图" }).click();
    await root
      .getByRole("dialog", { name: "切换视图" })
      .getByRole("button", { name: `切换到${name}` })
      .click();
  };
  await expect(group).toHaveAttribute("aria-expanded", "true");
  const beforeCollapse = await page.evaluate(
    () => window.__semloRequireFixture("groupViewStateEditor").getSnapshot().json,
  );
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => window.__semloRequireFixture("groupViewStateEditor").getSnapshot().json)).toEqual(
    beforeCollapse,
  );
  await switchView("另一视图");
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await switchView("表格视图");
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await root.getByRole("button", { name: "分组", exact: true }).click();
  const panel = root.getByRole("dialog", { name: "分组" });
  await panel.getByLabel("分组列").selectOption({ label: "另一文本" });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await panel.getByLabel("分组列").selectOption({ label: "文本" });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("groupViewStateEditor");
    const replacement = editor.getSnapshot().json;
    replacement.content!.find((node) => node.type === "semloEditorDatabase")!.attrs!.data.id = "another-database";
    editor.setContent(replacement);
  });
  await expect(group).toHaveAttribute("aria-expanded", "true");
});

test("identical databases in separate editors do not share collapsed groups", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[0];
  data.records.forEach((record) => {
    record.values[field.id] = "甲";
  });
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupViewStateContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    for (const [suffix, key] of [['A', 'groupViewStateEditor'], ['B', 'groupViewStateOther']]) {
      const host = document.createElement('div')
      host.id = 'group-view-state-' + suffix
      document.body.append(host)
      window[key] = createEditor({ element: host, outline: false, content: window.groupViewStateContent })
    }
  `,
  });
  const a = page.locator("#group-view-state-A").getByRole("button", { name: "折叠分组 甲" });
  const b = page.locator("#group-view-state-B").getByRole("button", { name: "折叠分组 甲" });
  await expect(a).toHaveAttribute("aria-expanded", "true");
  await expect(b).toHaveAttribute("aria-expanded", "true");
  await a.click();
  await expect(a).toHaveAttribute("aria-expanded", "false");
  await expect(b).toHaveAttribute("aria-expanded", "true");
});
