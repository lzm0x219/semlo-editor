import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  type DatabaseActor,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    databaseIdentityEditor?: EditorController;
  }
}

test("automatic identities follow the host, history and remote document without inventing a user", async ({ page }) => {
  const data = createDatabaseData({ id: "remote-id", label: "远端用户" });
  delete data.records[1].createdBy;
  delete data.records[1].modifiedBy;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "databaseIdentityContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'database-identity-test'
      document.body.prepend(host)
      window.databaseIdentityEditor = createEditor({
        element: host, outline: false, content: window.databaseIdentityContent,
        currentUser: () => ({ id: 'user-a', label: '甲' }),
      })
    `,
  });
  const root = page.locator("#database-identity-test .semlo-editor-database");
  const read = async (): Promise<DatabaseData> =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("databaseIdentityEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  for (const [name, type] of [
    ["创建人", "createdBy"],
    ["修改人", "modifiedBy"],
  ] as const) {
    await root.getByRole("button", { name: "添加列" }).click();
    const dialog = root.getByRole("dialog", { name: "新增列" });
    await dialog.getByLabel("数据表列名").fill(name);
    await dialog.getByLabel("列类型").selectOption(type);
    await dialog.getByRole("button", { name: "确定" }).click();
  }
  await expect(root.getByLabel("第 1 行 创建人")).toHaveText("远端用户");
  await expect(root.getByLabel("第 2 行 创建人")).toHaveText("");
  const input = root.getByLabel("第 1 行 文本");
  await input.fill("本地修改");
  await expect.poll(async () => (await read()).records[0].modifiedBy).toEqual({ id: "user-a", label: "甲" });
  await input.press("ControlOrMeta+z");
  expect((await read()).records[0].modifiedBy).toEqual({ id: "remote-id", label: "远端用户" });
  await input.press("ControlOrMeta+Shift+z");
  await input.press("Tab");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseIdentityEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await read()).records[0].modifiedBy).toEqual({ id: "remote-id", label: "远端用户" });
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseIdentityEditor").editor.commands.redo())).toBe(
    true,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("databaseIdentityEditor")
      .setIntegrations({ currentUser: () => ({ id: "user-b", label: "乙" }) }),
  );
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  const added = (await read()).records[3];
  expect(added.createdBy).toEqual({ id: "user-b", label: "乙" });
  expect(added.modifiedBy).toEqual(added.createdBy);
  await expect(root.getByLabel("第 4 行 创建人")).toHaveText("乙");
  const remote = await page.evaluate(() => window.__semloRequireFixture("databaseIdentityEditor").getSnapshot().json);
  const remoteData = remote.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData;
  const actor: DatabaseActor = { id: "server-user", label: "服务端" };
  remoteData.records[0].modifiedBy = actor;
  const modifiedField = remoteData.fields.find((field) => field.type === "modifiedBy")!;
  remoteData.records[0].values[modifiedField.id] = actor;
  await page.evaluate((value) => window.__semloRequireFixture("databaseIdentityEditor").setContent(value), remote);
  await expect(root.getByLabel("第 1 行 修改人")).toHaveText("服务端");
  await page.evaluate(() => window.__semloRequireFixture("databaseIdentityEditor").setIntegrations({}));
  await root.getByLabel("第 1 行 文本").fill("无身份修改");
  await root.getByLabel("第 1 行 文本").press("Tab");
  expect((await read()).records[0].modifiedBy).toBeUndefined();
  await expect(root.getByLabel("第 1 行 修改人")).toHaveText("");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseIdentityEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await read()).records[0].modifiedBy).toEqual(actor);
});

test("inserting a database records the current host user on initial records", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'database-insert-identity-test'
      document.body.prepend(host)
      window.databaseIdentityEditor = createEditor({
        element: host, outline: false, content: '<p>正文</p>',
        currentUser: () => ({ id: 'creator', label: '创建者' }),
      })
    `,
  });
  const host = page.locator("#database-insert-identity-test");
  await host.locator(".semlo-editor-prose p").click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("数据表");
  await panel.locator('[data-command="database"]').click();
  const data = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("databaseIdentityEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
  );
  expect(data.records).toHaveLength(3);
  for (const record of data.records) {
    expect(record.createdBy).toEqual({ id: "creator", label: "创建者" });
    expect(record.modifiedBy).toEqual(record.createdBy);
  }
});
