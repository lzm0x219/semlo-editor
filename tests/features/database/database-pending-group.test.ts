import { expect, test } from "@rstest/playwright";

import { orderedFindTableGroups } from "../../../packages/core/src/features/database/find-database-matches";
import {
  createDatabaseData,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("pending group persists through edits, history, view and controlled writes", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const [title, group] = data.fields;
  group.type = "multiSelect";
  group.options = [{ id: "a", label: "甲", color: 0 }];
  group.defaultValue = ["a"];
  data.records.forEach((r) => (r.values[group.id] = []));
  data.views[0].groupFieldId = group.id;
  const other = createDatabaseView("另一视图");
  other.groupFieldId = group.id;
  data.views.push(other);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "databaseGroupActionsContent", v), content);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='pending-prototype';document.body.prepend(host);window.databaseGroupActionsEditor=createEditor({element:host,outline:false,content:window.databaseGroupActionsContent})`,
  });
  const root = page.locator("#pending-prototype .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
          .data as DatabaseData,
    );
  const groupFor = async (id: string) =>
    page.evaluate((id) => {
      const cell = document.querySelector<HTMLElement>(
        `#pending-prototype .semlo-editor-database-cell[data-record-id="${id}"]`,
      );
      let row = cell?.parentElement?.previousElementSibling;
      while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
      return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
    }, id);
  await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const saved = await read();
  const added = saved.records.at(-1)!;
  expect(added.values[group.id]).toEqual(["a"]);
  expect(await groupFor(added.id)).toBe("折叠分组 （空）");
  const findGroups = orderedFindTableGroups(
    saved.records,
    saved.fields.find((f) => f.id === group.id)!,
    saved.views[0],
  );
  expect(findGroups.find((g) => g.records.some((r) => r.id === added.id))?.records).toHaveLength(1);
  expect(findGroups.findIndex((g) => g.records.some((r) => r.id === added.id))).not.toBe(
    findGroups.findIndex((g) => g.records.some((r) => r.id === saved.records[0].id)),
  );
  const input = root.locator(
    `.semlo-editor-database-cell[data-record-id="${added.id}"][data-field-id="${title.id}"] input`,
  );
  await input.fill("临时");
  await input.press("Enter");
  expect(await groupFor(added.id)).toBe("折叠分组 （空）");
  await page.evaluate(() => {
    const e = window.__semloRequireFixture("databaseGroupActionsEditor");
    e.setContent(structuredClone(e.getSnapshot().json));
  });
  expect(await groupFor(added.id)).toBe("折叠分组 （空）");
  await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const added2 = (await read()).records.at(-1)!;
  expect(await groupFor(added2.id)).toBe("折叠分组 （空）");
  expect(await groupFor(added.id)).toBe("折叠分组 （空）");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseGroupActionsEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await read()).records.some((r) => r.id === added2.id)).toBe(false);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseGroupActionsEditor").editor.commands.redo()),
  ).toBe(true);
  expect(await groupFor(added2.id)).toBe("折叠分组 甲");
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  expect(await groupFor(added.id)).toBe("折叠分组 甲");
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  expect(await groupFor(added.id)).toBe("折叠分组 甲");
  await page.evaluate(() => {
    const e = window.__semloRequireFixture("databaseGroupActionsEditor");
    e.setContent(structuredClone(e.getSnapshot().json));
  });
  expect(await groupFor(added.id)).toBe("折叠分组 甲");
});

test("projected group drag uses visible grouping and preserves values within group", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const group = data.fields[1];
  group.type = "multiSelect";
  group.options = [{ id: "a", label: "甲", color: 0 }];
  group.defaultValue = ["a"];
  data.records.forEach((r, i) => (r.values[group.id] = i === 0 ? ["a"] : []));
  data.views[0].groupFieldId = group.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "databaseGroupActionsContent", v), content);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='pending-prototype';document.body.prepend(host);window.databaseGroupActionsEditor=createEditor({element:host,outline:false,content:window.databaseGroupActionsContent})`,
  });
  const root = page.locator("#pending-prototype .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
          .data as DatabaseData,
    );
  await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const created = (await read()).records.at(-1)!;
  const drag = async (source: string, target: string) =>
    page.evaluate(
      ({ source, target }) => {
        const row = (id: string) =>
          document.querySelector<HTMLElement>(`#pending-prototype .semlo-editor-database-cell[data-record-id="${id}"]`)!
            .parentElement!;
        const from = row(source).querySelector<HTMLButtonElement>(".semlo-editor-database-record-drag")!;
        const to = row(target);
        const marker = to.querySelector<HTMLElement>(".semlo-editor-database-record-index")!;
        const rect = marker.getBoundingClientRect();
        const transfer = new DataTransfer();
        from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        to.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 }),
        );
      },
      { source, target },
    );
  await drag(created.id, data.records[1].id);
  expect((await read()).records.find((r) => r.id === created.id)?.values[group.id]).toEqual(["a"]);
  await drag(created.id, data.records[0].id);
  expect((await read()).records.find((r) => r.id === created.id)?.values[group.id]).toEqual(["a"]);
  const groupFor = await page.evaluate((id) => {
    let row = document.querySelector<HTMLElement>(
      `#pending-prototype .semlo-editor-database-cell[data-record-id="${id}"]`,
    )?.parentElement?.previousElementSibling;
    while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
    return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
  }, created.id);
  expect(groupFor).toBe("折叠分组 甲");
  await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const target = (await read()).records.at(-1)!;
  await drag(data.records[0].id, target.id);
  expect((await read()).records.find((r) => r.id === data.records[0].id)?.values[group.id]).toEqual([]);
  const targetCell = root.locator(
    `.semlo-editor-database-cell[data-record-id="${target.id}"][data-field-id="${group.id}"] button`,
  );
  await targetCell.click();
  await root
    .getByRole("dialog", { name: `${group.name} 选项` })
    .getByRole("button", { name: "甲" })
    .click();
  expect((await read()).records.find((r) => r.id === target.id)?.values[group.id]).toEqual([]);
  await targetCell.click();
  await root
    .getByRole("dialog", { name: `${group.name} 选项` })
    .getByRole("button", { name: "甲" })
    .click();
  expect((await read()).records.find((r) => r.id === target.id)?.values[group.id]).toEqual(["a"]);
  const afterEdit = await page.evaluate((id) => {
    let row = document.querySelector<HTMLElement>(
      `#pending-prototype .semlo-editor-database-cell[data-record-id="${id}"]`,
    )?.parentElement?.previousElementSibling;
    while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
    return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
  }, target.id);
  expect(afterEdit).toBe("折叠分组 甲");
});
