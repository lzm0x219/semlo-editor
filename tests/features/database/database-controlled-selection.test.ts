import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/database/database-controlled-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/database/database-controlled-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  test(`${framework}: equal controlled JSON preserves selection but replacing database content clears it`, async ({
    page,
  }) => {
    const data = createDatabaseData();
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(
      async ({ framework, content }) => {
        await window.__semloRequireFixture("mountRestartControlledFixture")(framework, "legacy");
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        fixture.setContent(content);
        await fixture.settle();
      },
      { framework, content },
    );
    const root = page.locator("#restart-controlled-fixture .semlo-editor-database");
    const selected = root.getByLabel("选择第 1 条记录");
    await expect(selected).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("closeDatabaseTestHistory")());
    await selected.check();
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      fixture.setContent(structuredClone(fixture.controller.getSnapshot().json));
      await fixture.settle();
    });
    expect(await selected.isChecked(), "equal JSON echo").toBe(true);
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      const editor = fixture.controller.editor;
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "相邻文字");
      await fixture.settle();
    });
    expect(await selected.isChecked(), "adjacent paragraph edit").toBe(true);
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      fixture.controller.editor.commands.undo();
      await fixture.settle();
    });
    expect(await selected.isChecked(), "undo adjacent edit").toBe(true);
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      fixture.controller.editor.commands.redo();
      await fixture.settle();
    });
    expect(await selected.isChecked(), "redo adjacent edit").toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("closeDatabaseTestHistory")());
    await page.evaluate(async (fieldId) => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      const replacement = structuredClone(fixture.controller.getSnapshot().json);
      const database = replacement.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data;
      database.records[0].values[fieldId] = "替换内容";
      fixture.setContent(replacement);
      await fixture.settle();
    }, data.fields[0].id);
    expect(await selected.isChecked(), "database replacement").toBe(false);
    await selected.check();
    const undo = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      const result = fixture.controller.editor.commands.undo();
      await fixture.settle();
      return result;
    });
    expect(undo).toBe(true);
    expect(await selected.isChecked(), "undo database replacement").toBe(false);
    await selected.check();
    const redo = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      const result = fixture.controller.editor.commands.redo();
      await fixture.settle();
      return result;
    });
    expect(redo).toBe(true);
    expect(await selected.isChecked(), "redo database replacement").toBe(false);
    expect(await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").errors)).toEqual([]);
  });

  test(`${framework}: option identity survives controlled filter edits and echoes`, async ({ page }) => {
    const data = createDatabaseData();
    const field = data.fields[1];
    data.records.forEach((record, index) => {
      record.values[data.fields[0].id] = ["第一", "第二", "第三"][index];
      record.values[field.id] = index === 0 ? field.options[0].id : field.options[1].id;
    });
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(
      async ({ framework, content }) => {
        await window.__semloRequireFixture("mountRestartControlledFixture")(framework, "legacy");
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        fixture.setContent(content);
        await fixture.settle();
      },
      { framework, content },
    );
    const root = page.locator("#restart-controlled-fixture .semlo-editor-database");
    await expect(root.locator(".semlo-editor-database-record-index")).toHaveCount(3);
    await page.evaluate(() => window.__semloRequireFixture("closeDatabaseTestHistory")());
    await root.getByRole("button", { name: "筛选", exact: true }).click();
    const panel = root.getByRole("dialog", { name: "筛选" });
    await panel.getByLabel("筛选列").selectOption(field.id);
    await panel.getByLabel("筛选值").selectOption(field.options[0].id);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    await expect(root.locator('input[aria-label$=" 行 文本"]')).toHaveCount(1);
    const filter = () =>
      page.evaluate(() => {
        const data = window
          .__semloRequireFixture("restartControlledFixture")
          .controller.getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data;
        return data.views[0].filters[0];
      });
    expect((await filter()).optionId).toBe(field.options[0].id);
    await panel.getByRole("button", { name: "关闭" }).click();
    await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
    await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
    const dialog = root.getByRole("dialog", { name: "编辑列" });
    await dialog.getByLabel("选项名称 1").fill("新名称");
    await dialog.getByRole("button", { name: "确定" }).click();
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    expect((await filter()).optionId).toBe(field.options[0].id);
    expect((await filter()).value).toBe("新名称");
    await expect(root.locator('input[aria-label$=" 行 文本"]')).toHaveCount(1);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.undo(),
      ),
    ).toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    expect((await filter()).optionId).toBe(field.options[0].id);
    expect((await filter()).value).toBe(field.options[0].label);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.redo(),
      ),
    ).toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    expect((await filter()).optionId).toBe(field.options[0].id);
    expect((await filter()).value).toBe("新名称");
    await expect(root.locator('input[aria-label$=" 行 文本"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").errors)).toEqual([]);
  });

  test(`${framework}: date editing and local undo survive controlled echoes`, async ({ page }) => {
    const data = createDatabaseData();
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(
      async ({ framework, content }) => {
        await window.__semloRequireFixture("mountRestartControlledFixture")(framework, "legacy");
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        fixture.setContent(content);
        await fixture.settle();
      },
      { framework, content },
    );
    const root = page.locator("#restart-controlled-fixture .semlo-editor-database");
    const date = root.getByLabel("第 1 行 日期");
    await expect(date).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("closeDatabaseTestHistory")());
    const display = date.locator("..").locator(".semlo-editor-database-date-display");
    await date.focus();
    await date.fill("2026-11-05");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    await expect(date).toBeFocused();
    await expect(date).toHaveValue("2026-11-05");
    await expect(display).toBeHidden();
    await date.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    await expect(date).toBeFocused();
    await expect(date).toHaveValue("");
    await date.press("ControlOrMeta+Shift+z");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    await expect(date).toHaveValue("2026-11-05");
    await date.blur();
    await expect(display).toBeVisible();
    await expect(display).toHaveText("2026-11-05");
    expect(await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").errors)).toEqual([]);
  });
}
