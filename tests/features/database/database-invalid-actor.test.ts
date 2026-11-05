import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
beforeAll(async () => {
  server = await startCoreSourceServer();
});
afterAll(async () => server.stop());

declare global {
  interface Window {
    databaseInvalidActorEditor?: EditorController;
    databaseInvalidActorMode?: string;
    databaseInvalidActorErrors?: string[];
    databaseInvalidActorOriginalError?: Error;
    databaseInvalidActorOriginalReported?: boolean;
  }
}

for (const mode of ["empty", "oversized", "throws"] as const) {
  test(`${mode}: invalid current user cannot silently erase record identity`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData({ id: "previous", label: "原用户" });
    const field = data.fields[0];
    data.records[0].values[field.id] = "原值";
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }] };
    await page.goto(server.origin);
    await page.evaluate((value) => Reflect.set(window, "databaseInvalidActorContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        const createEditor = window.semloSourceCreateEditor
        const host = document.createElement('div'); host.id = 'database-invalid-actor'; document.body.prepend(host)
        window.databaseInvalidActorErrors = []
        window.databaseInvalidActorOriginalError = new Error('identity unavailable')
        window.databaseInvalidActorEditor = createEditor({
          element: host, outline: false, content: window.databaseInvalidActorContent,
          currentUser: () => {
            if (window.databaseInvalidActorMode === 'empty') return {id: 'user', label: ''}
            if (window.databaseInvalidActorMode === 'oversized') return {id: 'u'.repeat(501), label: '用户'}
            if (window.databaseInvalidActorMode === 'throws') throw window.databaseInvalidActorOriginalError
            return {id: 'next', label: '新用户'}
          },
          onError: error => {
            window.databaseInvalidActorErrors.push(error.message)
            window.databaseInvalidActorOriginalReported = error === window.databaseInvalidActorOriginalError
          }
        })
      `,
    });
    await page.evaluate((value) => (window.databaseInvalidActorMode = value), mode);
    const cell = page.locator("#database-invalid-actor .semlo-editor-database").getByLabel(`第 1 行 ${field.name}`);
    await cell.fill("新值");
    const read = () =>
      page.evaluate(
        () => window.__semloRequireFixture("databaseInvalidActorEditor").getSnapshot().json.content![0].attrs!.data,
      );
    let saved = await read();
    expect(saved.records[0].values[field.id]).toBe("原值");
    expect(saved.records[0].modifiedBy).toEqual({ id: "previous", label: "原用户" });
    await expect(cell).toHaveValue("原值");
    expect((await page.evaluate(() => window.databaseInvalidActorErrors))?.length).toBe(1);
    if (mode === "throws") expect(await page.evaluate(() => window.databaseInvalidActorOriginalReported)).toBe(true);
    await page
      .locator("#database-invalid-actor .semlo-editor-database")
      .getByRole("button", { name: "添加记录", exact: true })
      .click();
    expect((await read()).records).toHaveLength(data.records.length);
    expect((await page.evaluate(() => window.databaseInvalidActorErrors))?.length).toBe(2);

    await page.evaluate(() => (window.databaseInvalidActorMode = undefined));
    await cell.fill("新值");
    await cell.press("Enter");
    saved = await read();
    expect(saved.records[0].values[field.id]).toBe("新值");
    expect(saved.records[0].modifiedBy).toEqual({ id: "next", label: "新用户" });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseInvalidActorEditor").editor.commands.undo()),
    ).toBe(true);
    saved = await read();
    expect(saved.records[0].values[field.id]).toBe("原值");
    expect(saved.records[0].modifiedBy).toEqual({ id: "previous", label: "原用户" });
    await page
      .locator("#database-invalid-actor .semlo-editor-database")
      .getByRole("button", { name: "添加记录", exact: true })
      .click();
    expect((await read()).records).toHaveLength(data.records.length + 1);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseInvalidActorEditor").editor.commands.undo()),
    ).toBe(true);
    expect((await read()).records).toHaveLength(data.records.length);
  });
}

test("an invalid current user aborts database insertion and allows a later retry", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(server.origin);
  await page.addScriptTag({
    type: "module",
    content: `
      const host = document.createElement('div'); host.id = 'database-invalid-actor'; document.body.prepend(host)
      window.databaseInvalidActorErrors = []
      window.databaseInvalidActorMode = 'empty'
      window.databaseInvalidActorEditor = window.semloSourceCreateEditor({
        element: host, outline: false, content: '<p>原内容</p>',
        currentUser: () => window.databaseInvalidActorMode ? {id: 'user', label: ''} : {id: 'next', label: '用户'},
        onError: error => window.databaseInvalidActorErrors.push(error.message)
      })
    `,
  });
  const host = page.locator("#database-invalid-actor");
  const insert = async () => {
    await host.locator(".semlo-editor-prose p").click();
    await host.getByRole("button", { name: "插入内容" }).click();
    const menu = page.getByRole("dialog", { name: "插入内容" });
    await menu.getByLabel("搜索插入内容").fill("数据表");
    await menu.locator('[data-command="database"]').click();
  };
  await insert();
  await expect(host.locator(".semlo-editor-database")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose")).toContainText("原内容");
  expect(await page.evaluate(() => window.databaseInvalidActorErrors)).toHaveLength(1);
  await page.evaluate(() => (window.databaseInvalidActorMode = undefined));
  await insert();
  await expect(host.locator(".semlo-editor-database")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseInvalidActorEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-database")).toHaveCount(0);
});
