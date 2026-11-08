import { expect, test, type Page } from "@rstest/playwright";

import type { DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseTestEditor?: EditorController;
    databaseSecondEditor?: EditorController;
    databaseOldConfirm?: HTMLElement | null;
    databaseOldInput?: HTMLInputElement | null;
    databaseChanges?: string[];
    databaseHistoryTrace?: unknown[];
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'database-test'
      document.body.prepend(host)
      window.databaseChanges = []
      window.databaseTestEditor = createEditor({
        element: host, outline: false, content: '<p>第一段</p><p>第二段</p>',
        onChange: snapshot => {
          const data = snapshot.json.content?.find(entry => entry.type === 'semloEditorDatabase')?.attrs?.data
          if (data?.records?.length && data?.fields?.length) {
            window.databaseChanges.push(data.records[0].values[data.fields[0].id] ?? '')
          }
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.databaseTestEditor));
  return page.locator("#database-test");
}

async function databaseData(page: Page): Promise<DatabaseData> {
  return page.evaluate(() => {
    const node = window
      .__semloRequireFixture("databaseTestEditor")
      .getSnapshot()
      .json.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing database content");
    return node.attrs.data as DatabaseData;
  });
}

async function insertDatabase(page: Page, host: ReturnType<Page["locator"]>) {
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill("数据表");
  await panel.locator('[data-command="database"]').click();
  const database = host.locator(".semlo-editor-database");
  await expect(database).toHaveCount(1);
  return database;
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("toolbar, slash and block insertion create independent data tables", async ({ page }) => {
  const host = await mount(page);
  await insertDatabase(page, host);
  const first = await databaseData(page);
  expect(first.fields.map((field) => field.name)).toEqual(["文本", "单选", "日期"]);
  expect(first.records).toHaveLength(3);
  expect(first.fields[1].options.map((option) => option.label)).toEqual(["待开始", "进行中", "已完成"]);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("databaseTestEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
  });
  await host.locator(".semlo-editor-prose p").last().click();
  await page.keyboard.type("/sjb");
  const slash = page.getByRole("listbox", { name: "插入内容" });
  await expect(slash.getByRole("option", { name: /数据表/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(host.locator(".semlo-editor-database")).toHaveCount(2);

  await host.locator(".semlo-editor-prose > p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="database"]').click();
  await expect(host.locator(".semlo-editor-database")).toHaveCount(3);
  const nodes = await page.evaluate(() =>
    window
      .__semloRequireFixture("databaseTestEditor")
      .getSnapshot()
      .json.content?.filter((entry) => entry.type === "semloEditorDatabase"),
  );
  expect(new Set((nodes ?? []).map((node) => (node.attrs?.data as DatabaseData | undefined)?.id)).size).toBe(3);
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-database")).toHaveCount(2);
});

test("typing immediately after each insertion method keeps the first cell focused and saves its content", async ({
  page,
}) => {
  for (const source of ["toolbar", "slash", "below"] as const) {
    const host = await mount(page);
    if (source === "toolbar") {
      await insertDatabase(page, host);
    } else if (source === "slash") {
      await host.locator(".semlo-editor-prose p").first().click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("/sjb");
      await page.keyboard.press("Enter");
    } else {
      await host.locator(".semlo-editor-prose p").first().hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
      await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="database"]').click();
    }
    const database = host.locator(".semlo-editor-database");
    const cell = database.getByLabel("第 1 行 文本");
    await cell.fill("a");
    await page.keyboard.type("bc");
    await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
    const data = await databaseData(page);
    expect(data.records[0].values[data.fields[0].id]).toBe("abc");
    await expect(cell).toBeFocused();
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").getSnapshot());
    const nodes = snapshot.json.content?.map((node) => node.type) ?? [];
    expect(nodes.indexOf("semloEditorDatabase"), `insertion source ${source}: ${nodes.join(", ")}`).toBe(1);
    expect(snapshot.text).toContain("第一段");
    expect(snapshot.text).toContain("第二段");
  }
});

test("album and kanban insertion creates the corresponding views over editable records", async ({ page }) => {
  for (const [id, label, kind, surface] of [
    ["album", "画册", "gallery", ".semlo-editor-database-gallery"],
    ["kanban", "看板", "kanban", ".semlo-editor-database-board"],
  ] as const) {
    const host = await mount(page);
    await host.locator(".semlo-editor-prose p").first().click();
    await host.getByRole("button", { name: "插入内容" }).click();
    const menu = page.getByRole("dialog", { name: "插入内容" });
    await menu.getByLabel("搜索插入内容").fill(label);
    await menu.locator(`[data-command="${id}"]`).click();
    const database = host.locator(".semlo-editor-database");
    await expect(database.locator(surface)).toBeVisible();
    await expect(database.locator(".semlo-editor-database-card")).toHaveCount(3);
    let data = await databaseData(page);
    expect(data.views.find((view) => view.id === data.activeViewId)?.kind).toBe(kind);
    await database.locator(".semlo-editor-database-card").first().click();
    const detail = database.getByRole("dialog", { name: "记录详情" });
    await detail.getByLabel("第 1 行 文本").fill(`${label}记录`);
    const edited = await databaseData(page);
    expect(edited.records[kind === "kanban" ? 2 : 0].values[edited.fields[0].id]).toBe(`${label}记录`);
    await detail.getByLabel("第 1 行 文本").press("Tab");
    await detail.getByRole("button", { name: "关闭" }).click();
    await expect(database.getByRole("button", { name: `记录：${label}记录` })).toBeVisible();
    if (kind === "kanban") {
      await database.getByRole("button", { name: "在进行中添加记录" }).click();
      data = await databaseData(page);
      expect(data.records).toHaveLength(4);
      expect(data.records[3].values[data.fields[1].id]).toBe(data.fields[1].options[1].id);
    }
  }
});

test("records and typed columns support filtering, grouping and sorting", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  for (const [index, value] of ["Alpha", "Beta", "Gamma"].entries()) {
    await database.getByLabel(`第 ${index + 1} 行 文本`).fill(value);
    await database.getByLabel(`第 ${index + 1} 行 文本`).press("Tab");
  }
  await database.getByLabel("第 1 行 单选").click();
  await database.getByRole("dialog", { name: "单选 选项" }).getByRole("button", { name: "待开始" }).click();
  await database.getByLabel("第 1 行 日期").fill("2026-11-03");
  await database.getByLabel("第 1 行 日期").press("Tab");
  await database.getByRole("button", { name: "添加列" }).click();
  const field = database.getByRole("dialog", { name: "新增列" });
  await field.getByLabel("数据表列名").fill("优先级");
  await field.getByLabel("列类型").selectOption("number");
  await field.getByLabel("默认值").fill("1");
  await field.getByRole("button", { name: "确定" }).click();
  await expect(database.getByLabel("第 1 行 优先级")).toHaveValue("1");
  await database.getByLabel("第 1 行 优先级").fill("-2");
  await database.getByLabel("第 1 行 优先级").press("Tab");
  await database.getByLabel("第 2 行 优先级").fill("-10");
  await database.getByLabel("第 2 行 优先级").press("Tab");
  await database.getByLabel("第 3 行 优先级").fill("1.5");
  await database.getByLabel("第 3 行 优先级").press("Tab");

  await database.getByRole("button", { name: "筛选", exact: true }).click();
  const filter = database.getByRole("dialog", { name: "筛选" });
  await filter.getByLabel("筛选条件").selectOption("contains");
  await filter.getByLabel("筛选值").fill("Alpha");
  try {
    await expect(
      database.locator(
        ".semlo-editor-database-row:not(.semlo-editor-database-header):not(.semlo-editor-database-footer)",
      ),
    ).toHaveCount(1);
  } catch {
    const evidence = await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null;
      const root = document.querySelector("#database-test .semlo-editor-database");
      return {
        changes: window.__semloRequireFixture("databaseChanges"),
        active: { tag: active?.tagName, label: active?.getAttribute("aria-label"), value: active?.value },
        filter: root?.querySelector<HTMLInputElement>('[aria-label="筛选值"]')?.value,
        rows: root?.querySelectorAll(
          ".semlo-editor-database-row:not(.semlo-editor-database-header):not(.semlo-editor-database-footer)",
        ).length,
      };
    });
    throw new Error(`Filter did not show Alpha: ${JSON.stringify({ data: await databaseData(page), ...evidence })}`);
  }
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("Alpha");
  await filter.getByRole("button", { name: "删除筛选规则" }).click();
  await filter.getByRole("button", { name: "关闭" }).click();

  await database.getByRole("button", { name: "分组", exact: true }).click();
  const group = database.getByRole("dialog", { name: "分组" });
  await group.getByLabel("分组列").selectOption({ label: "单选" });
  await expect(database.getByRole("button", { name: "折叠分组 待开始" })).toBeVisible();
  await expect(database.getByRole("button", { name: "折叠分组 （空）" })).toBeVisible();
  await group.getByRole("button", { name: "移除分组" }).click();

  await database.getByRole("button", { name: "排序", exact: true }).click();
  const sort = database.getByRole("dialog", { name: "排序" });
  await sort.getByRole("button", { name: "添加排序" }).click();
  await sort.getByLabel("保持排序").check();
  await sort.getByLabel("排序顺序").selectOption("desc");
  const names = database.locator('input[aria-label$=" 行 文本"]');
  await expect(names).toHaveCount(3);
  expect(await names.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual([
    "Gamma",
    "Beta",
    "Alpha",
  ]);
  await sort.getByLabel("排序列").selectOption({ label: "优先级" });
  await sort.getByLabel("排序顺序").selectOption("asc");
  expect(await names.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual([
    "Beta",
    "Alpha",
    "Gamma",
  ]);
  const data = await databaseData(page);
  expect(data.fields.map((entry) => entry.name)).toEqual(["文本", "单选", "日期", "优先级"]);
  expect(data.records[0].values[data.fields[0].id]).toBe("Alpha");
  expect(data.records[0].values[data.fields[1].id]).toBe(data.fields[1].options[0].id);
  expect(data.records[0].values[data.fields[2].id]).toBe("2026-11-03");
  expect(data.records[1].values[data.fields[3].id]).toBe("-10");
});

test("editing options retains record bindings and only removes the deleted value", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  await database.getByLabel("第 1 行 单选").click();
  await database.getByRole("dialog", { name: "单选 选项" }).getByRole("button", { name: "待开始" }).click();
  await database.getByLabel("第 2 行 单选").click();
  await database.getByRole("dialog", { name: "单选 选项" }).getByRole("button", { name: "进行中" }).click();
  const original = await databaseData(page);
  const fieldId = original.fields[1].id;
  const [firstOption, secondOption] = original.fields[1].options;

  await database.getByRole("button", { name: "单选列菜单" }).click();
  await database.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  let dialog = database.getByRole("dialog", { name: "编辑列" });
  await dialog.getByLabel("选项名称 1").fill("尚未开始");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(database.getByLabel("第 1 行 单选")).toContainText("尚未开始");
  let updated = await databaseData(page);
  expect(updated.fields[1].options[0].id).toBe(firstOption.id);
  expect(updated.records[0].values[fieldId]).toBe(firstOption.id);
  expect(updated.records[1].values[fieldId]).toBe(secondOption.id);

  await database.getByRole("button", { name: "单选列菜单" }).click();
  await database.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  dialog = database.getByRole("dialog", { name: "编辑列" });
  await dialog.getByRole("button", { name: "下移选项 1" }).click();
  await dialog.getByRole("button", { name: "确定" }).click();
  updated = await databaseData(page);
  expect(updated.fields[1].options.slice(0, 2).map((option) => option.id)).toEqual([secondOption.id, firstOption.id]);
  expect(updated.records[0].values[fieldId]).toBe(firstOption.id);
  expect(updated.records[1].values[fieldId]).toBe(secondOption.id);

  await database.getByRole("button", { name: "单选列菜单" }).click();
  await database.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  dialog = database.getByRole("dialog", { name: "编辑列" });
  await dialog.getByRole("button", { name: "删除选项 2" }).click();
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(dialog.getByRole("status")).toContainText("1 条记录");
  expect((await databaseData(page)).records[0].values[fieldId]).toBe(firstOption.id);
  await dialog.getByRole("button", { name: "确定" }).click();
  updated = await databaseData(page);
  expect(updated.records[0].values[fieldId]).toBe("");
  expect(updated.records[1].values[fieldId]).toBe(secondOption.id);
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  updated = await databaseData(page);
  expect(updated.records[0].values[fieldId]).toBe(firstOption.id);
  expect(updated.records[1].values[fieldId]).toBe(secondOption.id);
});

test("editing a record refreshes an active filter, sort and group after blur", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  for (const [index, value] of ["Alpha", "Beta", "Gamma"].entries()) {
    await database.getByLabel(`第 ${index + 1} 行 文本`).fill(value);
    await database.getByLabel(`第 ${index + 1} 行 文本`).press("Tab");
  }
  await database.getByRole("button", { name: "筛选", exact: true }).click();
  let filter = database.getByRole("dialog", { name: "筛选" });
  await filter.getByLabel("筛选值").fill("Alpha");
  await filter.getByRole("button", { name: "关闭" }).click();
  await database.getByLabel("第 1 行 文本").fill("Delta");
  await database.getByLabel("第 1 行 文本").press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".semlo-editor-database-body")))).toBe(true);
  await host.locator(".semlo-editor-prose > p").first().click();
  await expect(
    database.locator(
      ".semlo-editor-database-row:not(.semlo-editor-database-header):not(.semlo-editor-database-footer)",
    ),
  ).toHaveCount(0);
  await database.getByRole("button", { name: "筛选", exact: true }).click();
  filter = database.getByRole("dialog", { name: "筛选" });
  await filter.getByRole("button", { name: "删除筛选规则" }).click();
  await filter.getByRole("button", { name: "关闭" }).click();

  await database.getByRole("button", { name: "排序", exact: true }).click();
  const sort = database.getByRole("dialog", { name: "排序" });
  await sort.getByRole("button", { name: "添加排序" }).click();
  await sort.getByLabel("保持排序").check();
  await sort.getByRole("button", { name: "关闭" }).click();
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("Beta");
  await database.getByLabel("第 1 行 文本").fill("Zulu");
  await database.getByLabel("第 1 行 文本").press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".semlo-editor-database-body")))).toBe(true);
  await host.locator(".semlo-editor-prose > p").first().click();
  await expect(database.getByLabel("第 3 行 文本")).toHaveValue("Zulu");
  await database.getByRole("button", { name: "分组", exact: true }).click();
  const group = database.getByRole("dialog", { name: "分组" });
  await group.getByLabel("分组列").selectOption({ label: "文本" });
  await group.getByRole("button", { name: "关闭" }).click();
  await expect(database.getByRole("button", { name: "折叠分组 Delta" })).toBeVisible();
  await database.getByLabel("第 1 行 文本").fill("Echo");
  await database.getByLabel("第 1 行 文本").press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".semlo-editor-database-body")))).toBe(true);
  await host.locator(".semlo-editor-prose > p").first().click();
  await expect(database.getByRole("button", { name: "折叠分组 Echo" })).toBeVisible();
});

test("changing a text column to a number column preserves and displays existing text", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  for (const [index, value] of ["123", "abc"].entries()) {
    await database.getByLabel(`第 ${index + 1} 行 文本`).fill(value);
    await database.getByLabel(`第 ${index + 1} 行 文本`).press("Tab");
  }
  await database.getByRole("button", { name: "文本列菜单" }).click();
  await database.getByRole("menu", { name: "文本 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const dialog = database.getByRole("dialog", { name: "编辑列" });
  await dialog.getByLabel("列类型").selectOption("number");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("123");
  await expect(database.getByLabel("第 2 行 文本")).toHaveValue("abc");
  const data = await databaseData(page);
  expect(data.fields[0].type).toBe("number");
  expect(data.records.slice(0, 2).map((record) => record.values[data.fields[0].id])).toEqual(["123", "abc"]);
});

test("keyboard undo follows cell editing and completed edit boundaries", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  const input = database.getByLabel("第 1 行 文本");
  await input.click();
  await page.keyboard.type("abc");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("ab");
  let data = await databaseData(page);
  expect(data.records[0].values[data.fields[0].id]).toBe("ab");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
  await database.getByLabel("第 1 行 文本").press("Enter");
  await database.getByLabel("第 2 行 文本").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
  await host.locator(".semlo-editor-prose > p").first().click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
  data = await databaseData(page);
  expect(data.records[0].values[data.fields[0].id]).toBe("abc");
});

test("a cell edit committed after a local undo is one document history step", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  await database.getByLabel("第 1 行 文本").click();
  await page.keyboard.type("abc");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("ab");
  const checkpoint = await page.evaluate(() => window.__semloRequireFixture("databaseChanges").length);
  await database.getByLabel("第 1 行 文本").press("Enter");
  expect(
    await page.evaluate((start) => window.__semloRequireFixture("databaseChanges").slice(start), checkpoint),
  ).not.toContain("");
  await host.locator(".semlo-editor-prose > p").first().click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("ab");
  const data = await databaseData(page);
  expect(data.records[0].values[data.fields[0].id]).toBe("ab");
});

test("committed edits remain undoable across later data table and document changes", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  await database.getByLabel("第 1 行 文本").click();
  await page.keyboard.type("abc");
  const checkpoint = await page.evaluate(() => window.__semloRequireFixture("databaseChanges").length);
  await database.getByLabel("第 1 行 文本").press("Enter");
  expect(
    await page.evaluate((start) => window.__semloRequireFixture("databaseChanges").slice(start), checkpoint),
  ).not.toContain("");
  await database.getByRole("button", { name: "添加记录", exact: true }).click();
  expect((await databaseData(page)).records).toHaveLength(4);
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await databaseData(page)).records).toHaveLength(3);
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await databaseData(page)).records).toHaveLength(4);
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");

  const input = database.getByLabel("第 2 行 文本");
  await input.click();
  await page.keyboard.type("mapped");
  await input.press("Enter");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("databaseTestEditor").editor;
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "前置内容" }] });
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
  await expect(database.getByLabel("第 2 行 文本")).toHaveValue("");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(database.getByLabel("第 2 行 文本")).toHaveValue("mapped");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-prose")).toContainText("前置内容");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("abc");
});

test("composition events keep the composed text together for undo and redo", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  const input = database.getByLabel("第 1 行 文本");
  await input.focus();
  await input.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    for (const text of ["n", "你", "你好"]) {
      input.value = text;
      input.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: text }));
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: text, inputType: "insertCompositionText", isComposing: true }),
      );
    }
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "你好", inputType: "insertText" }));
  });
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("你好");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("你好");
  await database.getByLabel("第 1 行 文本").press("Enter");
  await host.locator(".semlo-editor-prose > p").first().click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(database.getByLabel("第 1 行 文本")).toHaveValue("你好");
});

test("replacing a document during a cell edit rejects stale input and blur events", async ({ page }) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  await database.getByLabel("第 1 行 文本").click();
  await page.keyboard.insertText("旧草稿");
  await page.evaluate(() => {
    window.databaseOldInput = document.querySelector<HTMLInputElement>('#database-test [aria-label="第 1 行 文本"]');
    const next = structuredClone(window.__semloRequireFixture("databaseTestEditor").getSnapshot().json);
    const entry = next.content?.find((node) => node.type === "semloEditorDatabase");
    if (!entry?.attrs?.data) throw new Error("Missing database to replace");
    const data = entry.attrs.data as DatabaseData;
    data.records[0].values[data.fields[0].id] = "新文档";
    window.__semloRequireFixture("databaseTestEditor").setContent(next);
    const oldInput = window.__semloRequireDefined("databaseOldInput");
    if (!oldInput) throw new Error("Missing old cell input");
    oldInput.value = "迟到的旧值";
    oldInput.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    oldInput.dispatchEvent(new Event("change", { bubbles: true }));
    oldInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  });
  await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 文本")).toHaveValue("新文档");
  const data = await databaseData(page);
  expect(data.records[0].values[data.fields[0].id]).toBe("新文档");
});

test("database state survives JSON and HTML, is read-only, and rejects an old popup after replacement", async ({
  page,
}) => {
  const host = await mount(page);
  const database = await insertDatabase(page, host);
  await database.getByLabel("第 1 行 文本").fill("保留的记录");
  await database.getByLabel("第 1 行 文本").press("Tab");
  expect(
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("databaseTestEditor");
      const capture = (label: string) => {
        const state = controller.editor.state;
        const plugin = state.plugins.find((entry) => String(Reflect.get(entry, "key")).startsWith("history$"));
        const history = plugin?.getState(state) as { done?: { eventCount?: number }; undone?: { eventCount?: number } };
        return {
          label,
          json: controller.getSnapshot().json,
          undoDepth: history?.done?.eventCount,
          redoDepth: history?.undone?.eventCount,
        };
      };
      window.databaseHistoryTrace = [capture("before undo")];
      const result = controller.editor.commands.undo();
      window.__semloRequireFixture("databaseHistoryTrace").push(capture("after undo"));
      return result;
    }),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 文本")).not.toHaveValue("保留的记录");
  expect(
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("databaseTestEditor");
      const result = controller.editor.commands.redo();
      const state = controller.editor.state;
      const plugin = state.plugins.find((entry) => String(Reflect.get(entry, "key")).startsWith("history$"));
      const history = plugin?.getState(state) as { done?: { eventCount?: number }; undone?: { eventCount?: number } };
      window.__semloRequireFixture("databaseHistoryTrace").push({
        label: "after redo",
        json: controller.getSnapshot().json,
        undoDepth: history?.done?.eventCount,
        redoDepth: history?.undone?.eventCount,
      });
      return result;
    }),
  ).toBe(true);
  const afterRedo = await databaseData(page);
  if (afterRedo.records[0].values[afterRedo.fields[0].id] !== "保留的记录") {
    throw new Error(
      `Redo did not restore the cell: ${JSON.stringify(await page.evaluate(() => window.databaseHistoryTrace))}`,
    );
  }
  expect(afterRedo.records[0].values[afterRedo.fields[0].id]).toBe("保留的记录");
  await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 文本")).toHaveValue("保留的记录");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").getSnapshot());
  const original = await databaseData(page);
  expect(snapshot.text).toContain("保留的记录");
  expect(snapshot.html).toContain("data-semlo-editor-database");

  await page.evaluate((value) => window.__semloRequireFixture("databaseTestEditor").setContent(value), snapshot.html);
  expect(await databaseData(page)).toEqual(original);
  await page.evaluate((value) => window.__semloRequireFixture("databaseTestEditor").setContent(value), snapshot.json);
  expect(await databaseData(page)).toEqual(original);
  await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").setEditable(false));
  await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 文本")).toHaveAttribute("readonly", "");
  await expect(host.locator(".semlo-editor-database").getByRole("button", { name: "添加列" })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("databaseTestEditor").setEditable(true));

  await host.locator(".semlo-editor-database").getByRole("button", { name: "添加列" }).click();
  const oldDialog = host.getByRole("dialog", { name: "新增列" });
  await oldDialog.getByLabel("数据表列名").fill("旧面板的列");
  await page.evaluate(() => {
    window.databaseOldConfirm = document.querySelector<HTMLButtonElement>(
      '.semlo-editor-database-popover [aria-label="确定"]',
    );
    const next = structuredClone(window.__semloRequireFixture("databaseTestEditor").getSnapshot().json);
    const entry = next.content?.find((node) => node.type === "semloEditorDatabase");
    if (!entry?.attrs?.data) throw new Error("Missing database to replace");
    const data = entry.attrs.data as DatabaseData;
    data.records[0].values[data.fields[0].id] = "新文档的记录";
    window.__semloRequireFixture("databaseTestEditor").setContent(next);
    window.databaseOldConfirm?.click();
  });
  await expect(oldDialog).toHaveCount(0);
  const replacement = await databaseData(page);
  expect(replacement.records[0].values[replacement.fields[0].id]).toBe("新文档的记录");
  expect(replacement.fields.map((entry) => entry.name)).not.toContain("旧面板的列");

  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'database-second-test'
      document.body.prepend(host)
      window.databaseSecondEditor = createEditor({ element: host, outline: false, content: structuredClone(window.databaseTestEditor.getSnapshot().json) })
    `,
  });
  await page.waitForFunction(() => Boolean(window.databaseSecondEditor));
  const second = page.locator("#database-second-test .semlo-editor-database");
  await host.locator(".semlo-editor-database").getByLabel("第 1 行 文本").fill("只修改第一个");
  await host.locator(".semlo-editor-database").getByLabel("第 1 行 文本").press("Tab");
  await expect(second.getByLabel("第 1 行 文本")).toHaveValue("新文档的记录");
});

test("preview example keeps data when switching frameworks", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const host = page.locator("#editor-host");
  const database = host.locator(".semlo-editor-database");
  await expect(database.getByLabel("第 1 行 事项")).toHaveValue("收集灵感");
  await database.getByLabel("第 1 行 事项").fill("新的计划");
  await database.getByLabel("第 1 行 事项").press("Tab");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 事项")).toHaveValue("新的计划");
  }
  await page.getByRole("button", { name: "只读预览" }).click();
  await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 事项")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "继续编辑" }).click();
});
