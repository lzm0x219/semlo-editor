import { expect, test } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import { findDatabaseMatches } from "../../../packages/core/src/features/database/find-database-matches";
import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
} from "../../../packages/core/src/features/database/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
    text: { group: "inline" },
  },
});

test("database find matches a person label and searches distinct multiselect labels independently", () => {
  const data = createDatabaseData();
  const person = createDatabaseField("人员", "person");
  person.options = [{ id: "self", label: "测试成员", color: 0, externalId: "self" }];
  const tags = createDatabaseField("多选", "multiSelect");
  tags.options = [
    { id: "first", label: "甲乙", color: 0 },
    { id: "second", label: "丙丁", color: 1 },
  ];
  data.fields.push(person, tags);
  data.records[0].values[person.id] = ["self"];
  data.records[0].values[tags.id] = ["first", "second"];
  const doc = schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc, "成员").map((match) => match.fieldId)).toEqual([person.id]);
  expect(findDatabaseMatches(doc, "乙").map((match) => match.fieldId)).toEqual([tags.id]);
  expect(findDatabaseMatches(doc, "乙丙")).toHaveLength(0);
  expect(findDatabaseMatches(doc, "乙 丙")).toHaveLength(0);
});

test("person chips do not create matches through the export separator", () => {
  const data = createDatabaseData();
  const person = createDatabaseField("人员", "person");
  person.options = [
    { id: "first", label: "人员甲", color: 0, externalId: "one" },
    { id: "second", label: "人员乙", color: 0, externalId: "two" },
  ];
  data.fields.push(person);
  data.records[0].values[person.id] = ["first", "second"];
  const doc = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  for (const kind of ["table", "gallery", "kanban"] as const) {
    data.views[0].kind = kind;
    expect(findDatabaseMatches(doc(), "人员").filter((match) => match.fieldId === person.id)).toHaveLength(2);
    expect(findDatabaseMatches(doc(), "甲、人员乙")).toHaveLength(0);
    expect(findDatabaseMatches(doc(), "甲人员乙")).toHaveLength(0);
  }
  // Card titles are rendered as one textual value and therefore retain its separator.
  data.fields = [person, ...data.fields.filter((field) => field !== person)];
  data.views[0].kind = "gallery";
  expect(findDatabaseMatches(doc(), "甲、人员乙").map((match) => match.fieldId)).toEqual([person.id]);
});

test("table search follows each view's visible column order", () => {
  const data = createDatabaseData();
  const first = createDatabaseField("第一列");
  const second = createDatabaseField("第二列");
  const third = createDatabaseField("第三列");
  data.fields.push(first, second, third);
  for (const field of [first, second, third]) data.records[0].values[field.id] = "命中";
  const firstView = data.views[0];
  firstView.fieldOrder = [third.id, first.id, second.id];
  const secondView = createDatabaseView("另一视图", "table");
  secondView.fieldOrder = [second.id, third.id, first.id];
  secondView.hiddenFields = [third.id];
  data.views.push(secondView);
  const doc = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc(), "命中").map((match) => match.fieldId)).toEqual([third.id, first.id, second.id]);
  data.activeViewId = secondView.id;
  expect(findDatabaseMatches(doc(), "命中").map((match) => match.fieldId)).toEqual([second.id, first.id]);
  // Read-only view switches can override the persisted active view per node.
  expect(findDatabaseMatches(doc(), "命中", () => firstView.id).map((match) => match.fieldId)).toEqual([
    third.id,
    first.id,
    second.id,
  ]);
});

test("table search follows multi-select group option order in both directions", () => {
  const data = createDatabaseData();
  const group = createDatabaseField("标签", "multiSelect");
  group.options = [
    { id: "z", label: "最后", color: 0 },
    { id: "a", label: "最前", color: 1 },
  ];
  const field = createDatabaseField("内容");
  data.fields.push(group, field);
  data.views[0].groupFieldId = group.id;
  const [a, b, empty] = data.records;
  a.values[group.id] = ["a"];
  b.values[group.id] = ["z", "a"];
  empty.values[group.id] = [];
  for (const record of data.records) record.values[field.id] = "唯一目标";
  const doc = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  data.views[0].groupDirection = "asc";
  expect(findDatabaseMatches(doc(), "唯一目标").map((match) => match.recordId)).toEqual([b.id, a.id, empty.id]);
  data.views[0].groupDirection = "desc";
  expect(findDatabaseMatches(doc(), "唯一目标").map((match) => match.recordId)).toEqual([a.id, b.id, empty.id]);
});

for (const kind of ["singleSelect", "multiSelect"] as const) {
  test(`document search follows descending ${kind} groups when nonempty and empty groups are collapsed`, async ({
    page,
  }) => {
    const data = createDatabaseData();
    const group = createDatabaseField("分组", kind);
    group.options = [
      { id: "first", label: "甲组", color: 0 },
      { id: "second", label: "乙组", color: 1 },
    ];
    const field = createDatabaseField("内容");
    data.fields.push(group, field);
    data.views[0].groupFieldId = group.id;
    data.views[0].groupDirection = "desc";
    const [first, second, empty] = data.records;
    first.values[group.id] = kind === "multiSelect" ? ["first"] : "first";
    second.values[group.id] = kind === "multiSelect" ? ["second"] : "second";
    empty.values[group.id] = kind === "multiSelect" ? [] : "";
    for (const record of data.records) record.values[field.id] = "共同命中";
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "descendingFindFixture", value), data);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'descending-find-test'; document.body.append(host)
        window.descendingFindEditor = createEditor({ element: host, outline: false,
          content: { type: 'doc', content: [{ type: 'semloEditorDatabase', attrs: { data: window.descendingFindFixture } }, { type: 'paragraph' }] } })
      `,
    });
    await page.waitForFunction(() => Boolean(Reflect.get(window, "descendingFindEditor")));
    const host = page.locator("#descending-find-test");
    const headings = host.locator(".semlo-editor-database-group-heading");
    await expect(headings).toHaveCount(3);
    await expect(headings.nth(0)).toHaveAttribute("aria-label", "折叠分组 乙组");
    await expect(headings.nth(1)).toHaveAttribute("aria-label", "折叠分组 甲组");
    await expect(headings.nth(2)).toHaveAttribute("aria-label", "折叠分组 （空）");
    await host.getByRole("button", { name: "查找替换" }).click();
    const panel = page.getByRole("dialog", { name: "查找替换" });
    await panel.getByRole("textbox", { name: "查找内容" }).fill("共同命中");
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
    await headings.nth(0).click();
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
    const cell = (id: string) =>
      host.locator(`.semlo-editor-database-cell[data-record-id="${id}"][data-field-id="${field.id}"]`);
    await expect(cell(empty.id)).toHaveClass(/semlo-editor-find-match/);
    await expect(cell(first.id)).toHaveClass(/semlo-editor-find-match/);
    await headings.nth(2).click();
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
    await expect(cell(first.id)).toHaveClass(/semlo-editor-find-match-current/);
    await headings.nth(0).click();
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
    await expect(cell(second.id)).toHaveClass(/semlo-editor-find-match/);
    await page.evaluate(() => Reflect.get(window, "descendingFindEditor").destroy());
  });
}

test("table search follows checkbox group order in both directions", () => {
  const data = createDatabaseData();
  const group = createDatabaseField("完成", "checkbox");
  const field = createDatabaseField("内容");
  data.fields.push(group, field);
  data.views[0].groupFieldId = group.id;
  const [checked, unchecked, secondChecked] = data.records;
  checked.values[group.id] = true;
  unchecked.values[group.id] = false;
  secondChecked.values[group.id] = true;
  for (const record of data.records) record.values[field.id] = "唯一目标";
  const doc = schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  data.views[0].groupDirection = "asc";
  expect(findDatabaseMatches(doc, "唯一目标").map((match) => match.recordId)).toEqual([
    unchecked.id,
    checked.id,
    secondChecked.id,
  ]);
  data.views[0].groupDirection = "desc";
  expect(findDatabaseMatches(doc, "唯一目标").map((match) => match.recordId)).toEqual([
    checked.id,
    secondChecked.id,
    unchecked.id,
  ]);
});

test("table search follows view row order after filtering and hiding columns", () => {
  const data = createDatabaseData();
  const first = createDatabaseField("第一列");
  const second = createDatabaseField("第二列");
  data.fields.push(first, second);
  const [a, b, c] = data.records;
  for (const record of data.records) {
    record.values[first.id] = "命中";
    record.values[second.id] = "命中";
  }
  a.values[data.fields[0].id] = "保留甲";
  b.values[data.fields[0].id] = "排除";
  c.values[data.fields[0].id] = "保留丙";
  const view = data.views[0];
  view.fieldOrder = [second.id, first.id];
  view.recordOrder = [c.id, b.id, a.id];
  view.filters = [{ id: "filter", fieldId: data.fields[0].id, operator: "startsWith", value: "保留" }];
  view.hiddenFields = [first.id];
  const other = createDatabaseView("另一视图", "table");
  other.recordOrder = [a.id, c.id, b.id];
  other.fieldOrder = [first.id, second.id];
  other.hiddenFields = [second.id];
  data.views.push(other);
  const doc = schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc, "命中").map(({ recordId, fieldId }) => [recordId, fieldId])).toEqual([
    [c.id, second.id],
    [a.id, second.id],
  ]);
  expect(findDatabaseMatches(doc, "命中", () => other.id).map(({ recordId, fieldId }) => [recordId, fieldId])).toEqual([
    [a.id, first.id],
    [c.id, first.id],
    [b.id, first.id],
  ]);
});

test("table search follows active sorting before the manual row order", () => {
  const data = createDatabaseData();
  const field = createDatabaseField("匹配列");
  data.fields.push(field);
  const [a, b, c] = data.records;
  for (const record of data.records) record.values[field.id] = "命中";
  a.values[data.fields[0].id] = "1";
  b.values[data.fields[0].id] = "2";
  c.values[data.fields[0].id] = "3";
  const view = data.views[0];
  view.recordOrder = [a.id, c.id, b.id];
  view.sorts = [{ fieldId: data.fields[0].id, direction: "desc" }];
  view.filters = [{ id: "filter", fieldId: data.fields[0].id, operator: "notEmpty", value: "" }];
  const doc = schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc, "命中").map((match) => match.recordId)).toEqual([c.id, b.id, a.id]);
  view.sorts = [];
  expect(findDatabaseMatches(doc, "命中").map((match) => match.recordId)).toEqual([a.id, c.id, b.id]);
});

test("document search navigates in the current table view order after switching views", async ({ page }) => {
  const data = createDatabaseData();
  const first = createDatabaseField("第一列");
  const second = createDatabaseField("第二列");
  const third = createDatabaseField("第三列");
  data.fields.push(first, second, third);
  data.records = [data.records[0]];
  for (const field of [first, second, third]) data.records[0].values[field.id] = "命中";
  const initialView = data.views[0];
  initialView.fieldOrder = [third.id, first.id, second.id];
  const otherView = createDatabaseView("另一视图", "table");
  otherView.fieldOrder = [second.id, third.id, first.id];
  otherView.hiddenFields = [third.id];
  data.views.push(otherView);

  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "personOrderFixture", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'person-order-find-test'
      document.body.append(host)
      window.personOrderEditor = createEditor({
        element: host, outline: false,
        content: { type: 'doc', content: [{ type: 'semloEditorDatabase', attrs: { data: window.personOrderFixture } }, { type: 'paragraph' }] }
      })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "personOrderEditor")));
  const host = page.locator("#person-order-find-test");
  const database = host.locator(".semlo-editor-database");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  await expect(database.locator(`[data-field-id="${third.id}"].semlo-editor-find-match-current`)).toHaveCount(1);
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(database.locator(`[data-field-id="${first.id}"].semlo-editor-find-match-current`)).toHaveCount(1);
  await database.getByRole("button", { name: "切换视图" }).click();
  await database.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  await panel.getByRole("textbox", { name: "查找内容" }).fill("命");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await expect(database.locator(`[data-field-id="${second.id}"].semlo-editor-find-match-current`)).toHaveCount(1);
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(database.locator(`[data-field-id="${first.id}"].semlo-editor-find-match-current`)).toHaveCount(1);
  await page.evaluate(() => Reflect.get(window, "personOrderEditor").setEditable(false));
  await database.getByRole("button", { name: "切换视图" }).click();
  await database
    .getByRole("dialog", { name: "切换视图" })
    .getByRole("button", { name: `切换到${initialView.name}` })
    .click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[123]\/3$/);
  await panel.getByRole("textbox", { name: "查找内容" }).fill("命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  await expect(database.locator(`[data-field-id="${third.id}"].semlo-editor-find-match-current`)).toHaveCount(1);
  await page.evaluate(() => Reflect.get(window, "personOrderEditor").destroy());
});

test("document search navigates visible table rows in each view's order", async ({ page }) => {
  const data = createDatabaseData();
  const field = createDatabaseField("匹配列");
  data.fields.push(field);
  const [a, b, c] = data.records;
  for (const record of data.records) record.values[field.id] = "行命中";
  a.values[data.fields[0].id] = "保留甲";
  b.values[data.fields[0].id] = "排除";
  c.values[data.fields[0].id] = "保留丙";
  const initial = data.views[0];
  initial.recordOrder = [c.id, b.id, a.id];
  initial.filters = [{ id: "filter", fieldId: data.fields[0].id, operator: "startsWith", value: "保留" }];
  const other = createDatabaseView("全部行", "table");
  other.recordOrder = [a.id, c.id, b.id];
  data.views.push(other);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "rowOrderFixture", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'row-order-find-test'
    document.body.append(host)
    window.rowOrderEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{ type: 'semloEditorDatabase', attrs: { data: window.rowOrderFixture } }, { type: 'paragraph' }] } })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "rowOrderEditor")));
  const host = page.locator("#row-order-find-test");
  const database = host.locator(".semlo-editor-database");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const input = panel.getByRole("textbox", { name: "查找内容" });
  await input.fill("行命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await expect(
    database.locator(`[data-record-id="${c.id}"][data-field-id="${field.id}"].semlo-editor-find-match-current`),
  ).toHaveCount(1);
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(
    database.locator(`[data-record-id="${a.id}"][data-field-id="${field.id}"].semlo-editor-find-match-current`),
  ).toHaveCount(1);
  await database.getByRole("button", { name: "切换视图" }).click();
  await database.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到全部行" }).click();
  await input.fill("行命");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  for (const record of [a, c, b]) {
    await expect(
      database.locator(`[data-record-id="${record.id}"][data-field-id="${field.id}"].semlo-editor-find-match-current`),
    ).toHaveCount(1);
    await panel.getByRole("button", { name: "下一个" }).click();
  }
  await page.evaluate(() => Reflect.get(window, "rowOrderEditor").destroy());
});

test("document search excludes collapsed table groups until they are expanded", async ({ page }) => {
  const data = createDatabaseData();
  const group = data.fields[0];
  const field = createDatabaseField("匹配列");
  data.fields.push(field);
  for (const [index, record] of data.records.entries()) {
    record.values[group.id] = index === 0 ? "甲组" : "乙组";
    record.values[field.id] = "组内目标";
  }
  data.views[0].groupFieldId = group.id;
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupFindFixture", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-find-test'
    document.body.append(host)
    window.groupFindEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{ type: 'semloEditorDatabase', attrs: { data: window.groupFindFixture } }, { type: 'paragraph' }] } })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "groupFindEditor")));
  const host = page.locator("#group-find-test");
  const database = host.locator(".semlo-editor-database");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("组内目标");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  const groupButton = database.getByRole("button", { name: "折叠分组 甲组" });
  await groupButton.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  await page.evaluate(() => {
    const editor = Reflect.get(window, "groupFindEditor").editor;
    const node = editor.state.doc.firstChild;
    const data = structuredClone(node.attrs.data);
    data.views[0].groupDirection = "desc";
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, data }));
  });
  await expect(database.locator(".semlo-editor-database-group-heading").first()).toHaveAttribute(
    "aria-label",
    "折叠分组 乙组",
  );
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  const otherGroup = database.getByRole("button", { name: "折叠分组 乙组" });
  await otherGroup.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  await otherGroup.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  await groupButton.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[123]\/3$/);
  await page.evaluate(() => Reflect.get(window, "groupFindEditor").setEditable(false));
  await groupButton.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  await groupButton.click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[123]\/3$/);
  await page.evaluate(() => Reflect.get(window, "groupFindEditor").destroy());
});

test("search treats same-named table groups as separate identities", async ({ page }) => {
  const data = createDatabaseData();
  const group = createDatabaseField("分组", "singleSelect");
  group.options = [
    { id: "second", label: "同名", color: 1 },
    { id: "first", label: "同名", color: 0 },
  ];
  const field = createDatabaseField("内容");
  data.fields.push(group, field);
  data.views[0].groupFieldId = group.id;
  data.records.forEach((record, index) => {
    record.values[group.id] = index === 1 ? "second" : "first";
    record.values[field.id] = "目标";
  });
  const doc = schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc, "目标").map((match) => match.recordId)).toEqual([
    data.records[1].id,
    data.records[0].id,
    data.records[2].id,
  ]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "sameGroupFindFixture", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'same-group-find-test'
    document.body.append(host)
    window.sameGroupFindEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{ type: 'semloEditorDatabase', attrs: { data: window.sameGroupFindFixture } }, { type: 'paragraph' }] } })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "sameGroupFindEditor")));
  const host = page.locator("#same-group-find-test");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  const headings = host.getByRole("button", { name: "折叠分组 同名" });
  await expect(headings).toHaveCount(2);
  await headings.first().click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  await headings.last().click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  await headings.first().click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await page.evaluate(() => Reflect.get(window, "sameGroupFindEditor").destroy());
});
