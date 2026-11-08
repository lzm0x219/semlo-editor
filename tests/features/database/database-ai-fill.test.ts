import { expect, test } from "@rstest/playwright";
import type { Page } from "playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

async function mount(page: Page, data: DatabaseData) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "aiInitial", initial), data);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'database-ai-test';
      document.body.prepend(host);
      const state = { errors: [], calls: [] };
      Reflect.set(window, 'aiState', state);
      Reflect.set(window, 'aiEditor', createEditor({
        element: host, outline: false,
        content: { type: 'doc', content: [{ type: 'semloEditorDatabase', attrs: { data: Reflect.get(window, 'aiInitial') } }, { type: 'paragraph' }] },
        databaseAiFill: request => new Promise((resolve, reject) => state.calls.push({ request, resolve, reject })),
        onError: error => state.errors.push(error.message),
      }));
    `,
  });
}

async function read(page: Page): Promise<DatabaseData> {
  return page.evaluate(
    () =>
      Reflect.get(window, "aiEditor")
        .getSnapshot()
        .json.content.find((node: { type: string }) => node.type === "semloEditorDatabase").attrs.data,
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("configures a text column, fills with host results, and preserves undo and JSON/HTML", async ({ page }) => {
  const data = createDatabaseData();
  data.records[0].values[data.fields[0].id] = "来源文字";
  await mount(page, data);
  const root = page.locator("#database-ai-test .semlo-editor-database");
  await root.getByRole("button", { name: "添加列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("摘要");
  await dialog.getByLabel("AI 智能填写").check();
  await dialog.getByLabel("内容规则").selectOption("custom");
  await dialog.getByLabel("填写规则").fill("按每行生成摘要");
  await expect(dialog).toContainText("将整表内容发送给服务并覆盖本列。");
  await dialog.getByRole("button", { name: "开始自动填写" }).click();
  await expect(root.getByRole("status")).toHaveText("正在填写中…");
  const request = await page.evaluate(() => {
    const { request } = Reflect.get(window, "aiState").calls[0];
    return { field: request.field, fields: request.fields, records: request.records };
  });
  expect(request.field.rule).toEqual({ version: 1, mode: "custom", prompt: "按每行生成摘要" });
  expect(request.fields).toHaveLength(4);
  expect(request.fields.find((field: { type: string }) => field.type === "singleSelect").options).toHaveLength(3);
  expect(request.records[0].values[data.fields[0].id]).toBe("来源文字");
  await page.evaluate(() => {
    const call = Reflect.get(window, "aiState").calls[0];
    call.resolve(
      call.request.records.map((record: { id: string }, index: number) => ({
        recordId: record.id,
        value: `结果 ${index + 1}`,
      })),
    );
  });
  await expect(root.getByRole("status")).toHaveText("填写完成。");
  await expect(root.getByLabel("第 1 行 摘要")).toHaveValue("结果 1");
  await expect(root.getByRole("columnheader", { name: /摘要/ })).toContainText("AI");
  const saved = await read(page);
  const id = saved.fields.find((field) => field.name === "摘要")!.id;
  expect(saved.records.map((record) => record.values[id])).toEqual(["结果 1", "结果 2", "结果 3"]);
  expect(await page.evaluate(() => Reflect.get(window, "aiEditor").editor.commands.undo())).toBe(true);
  await expect(root.getByLabel("第 1 行 摘要")).toHaveValue("");
  expect(await page.evaluate(() => Reflect.get(window, "aiEditor").editor.commands.redo())).toBe(true);
  await expect(root.getByLabel("第 1 行 摘要")).toHaveValue("结果 1");
  const snapshot = await page.evaluate(() => Reflect.get(window, "aiEditor").getSnapshot());
  for (const content of [snapshot.json, snapshot.html]) {
    await page.evaluate((value) => Reflect.get(window, "aiEditor").setContent(value), content);
    await expect(root.getByLabel("第 1 行 摘要")).toHaveValue("结果 1");
    expect((await read(page)).fields.find((field) => field.id === id)?.ai).toEqual(request.field.rule);
  }
  expect(await page.evaluate(() => Reflect.get(window, "aiState").calls.length)).toBe(1);
  await root.getByRole("button", { name: "摘要列菜单" }).click();
  await expect(root.getByRole("menuitem", { name: "重新填写本列内容" })).toBeVisible();
});

test("discards late results after edits or integration replacement, and rejects invalid output", async ({ page }) => {
  const data = createDatabaseData();
  data.fields[0].ai = { version: 1, mode: "summary", prompt: "" };
  await mount(page, data);
  const root = page.locator("#database-ai-test .semlo-editor-database");
  const refill = async () => {
    await root.getByRole("button", { name: "文本列菜单" }).click();
    await root.getByRole("menuitem", { name: "重新填写本列内容" }).click();
  };
  await refill();
  await root.getByLabel("第 1 行 文本").fill("用户新内容");
  await root.getByLabel("第 1 行 文本").press("Tab");
  expect(await page.evaluate(() => Reflect.get(window, "aiState").calls[0].request.signal.aborted)).toBe(true);
  await page.evaluate(() => {
    const call = Reflect.get(window, "aiState").calls[0];
    call.resolve(call.request.records.map((record: { id: string }) => ({ recordId: record.id, value: "迟到" })));
  });
  await expect(root.getByLabel("第 1 行 文本")).toHaveValue("用户新内容");
  await refill();
  await page.evaluate(() => Reflect.get(window, "aiEditor").setIntegrations({}));
  expect(await page.evaluate(() => Reflect.get(window, "aiState").calls[1].request.signal.aborted)).toBe(true);
  await page.evaluate(() => {
    const call = Reflect.get(window, "aiState").calls[1];
    call.resolve(call.request.records.map((record: { id: string }) => ({ recordId: record.id, value: "旧服务" })));
  });
  await refill();
  await expect(root.getByRole("status")).toHaveText("请先配置 AI 智能填写服务。");
  expect((await read(page)).fields[0].ai).toEqual(data.fields[0].ai);
  await page.evaluate(() =>
    Reflect.get(window, "aiEditor").setIntegrations({
      databaseAiFill: async () => [{ recordId: "unknown", value: "坏结果" }],
    }),
  );
  await refill();
  await expect(root.getByRole("status")).toHaveText("填写失败，请重试。");
  await expect(root.getByLabel("第 1 行 文本")).toHaveValue("用户新内容");
  expect(await page.evaluate(() => Reflect.get(window, "aiState").errors)).toHaveLength(1);
  await page.evaluate(() =>
    Reflect.get(window, "aiEditor").setIntegrations({
      databaseAiFill: (request: unknown) =>
        new Promise((resolve, reject) => Reflect.get(window, "aiState").calls.push({ request, resolve, reject })),
    }),
  );
  await refill();
  await page.evaluate(() => Reflect.get(window, "aiEditor").setEditable(false));
  expect(await page.evaluate(() => Reflect.get(window, "aiState").calls[2].request.signal.aborted)).toBe(true);
  await page.evaluate(() => Reflect.get(window, "aiEditor").setEditable(true));
  await refill();
  await page.evaluate(() => Reflect.get(window, "aiEditor").destroy());
  expect(await page.evaluate(() => Reflect.get(window, "aiState").calls[3].request.signal.aborted)).toBe(true);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} forwards and updates the database AI service`, async ({ page }) => {
    const data = createDatabaseData();
    data.fields[0].ai = { version: 1, mode: "summary", prompt: "" };
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate((initial) => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      fixture.controller.setContent({
        type: "doc",
        content: [{ type: "semloEditorDatabase", attrs: { data: initial } }, { type: "paragraph" }],
      });
      Reflect.apply(fixture.setIntegrations, fixture, [
        {
          databaseAiFill: async (request: { records: { id: string }[] }) =>
            request.records.map((record) => ({ recordId: record.id, value: "框架结果" })),
        },
      ]);
    }, data);
    await page.evaluate(() =>
      Reflect.apply(Reflect.get(window.__semloRequireFixture("dynamicEditor"), "settle"), null, []),
    );
    const root = page.locator("#dynamic-editor .semlo-editor-database");
    await root.getByRole("button", { name: "文本列菜单" }).click();
    await root.getByRole("menuitem", { name: "重新填写本列内容" }).click();
    await expect(root.getByLabel("第 1 行 文本")).toHaveValue("框架结果");
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      Reflect.apply(fixture.setIntegrations, fixture, [
        {
          databaseAiFill: async (request: { records: { id: string }[] }) =>
            request.records.map((record) => ({ recordId: record.id, value: "新服务结果" })),
        },
      ]);
    });
    await page.evaluate(() =>
      Reflect.apply(Reflect.get(window.__semloRequireFixture("dynamicEditor"), "settle"), null, []),
    );
    await root.getByRole("button", { name: "文本列菜单" }).click();
    await root.getByRole("menuitem", { name: "重新填写本列内容" }).click();
    await expect(root.getByLabel("第 1 行 文本")).toHaveValue("新服务结果");
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });
}

test("AI column settings remain usable by keyboard in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const data = createDatabaseData();
  data.fields[0].ai = { version: 1, mode: "custom", prompt: "按行总结" };
  await mount(page, data);
  const root = page.locator("#database-ai-test .semlo-editor-database");
  await root.getByRole("button", { name: "文本列菜单" }).focus();
  await root.getByRole("button", { name: "文本列菜单" }).press("Enter");
  await root.getByRole("menuitem", { name: "编辑列" }).click();
  const dialog = root.getByRole("dialog", { name: "编辑列" });
  const enabled = dialog.getByLabel("AI 智能填写");
  await enabled.focus();
  await enabled.press("Space");
  await expect(enabled).not.toBeChecked();
  await enabled.press("Space");
  await expect(enabled).toBeChecked();
  await expect(dialog.getByLabel("填写规则")).toHaveValue("按行总结");
  const toggleBox = await enabled.boundingBox();
  const captionBox = await dialog.getByText("AI 智能填写", { exact: true }).boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(captionBox).not.toBeNull();
  expect(Math.abs(toggleBox!.y - captionBox!.y)).toBeLessThan(12);
  const rect = await dialog.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
  await dialog.getByRole("button", { name: "确定" }).focus();
  await dialog.getByRole("button", { name: "确定" }).press("Enter");
  expect((await read(page)).fields[0].ai).toEqual(data.fields[0].ai);
});

test("simultaneous editors keep AI requests and cancellation independent", async ({ page }) => {
  const data = createDatabaseData();
  data.fields[0].ai = { version: 1, mode: "summary", prompt: "" };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "aiInitial", initial), data);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const calls = [];
      const editors = ['one', 'two'].map(name => {
        const host = document.createElement('div');
        host.id = 'ai-' + name;
        document.body.prepend(host);
        return createEditor({ element: host, outline: false,
          content: {type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:structuredClone(Reflect.get(window,'aiInitial'))}},{type:'paragraph'}]},
          databaseAiFill: request => new Promise(resolve => calls.push({name,request,resolve})) });
      });
      Reflect.set(window,'aiInstances',{editors,calls});
    `,
  });
  const first = page.locator("#ai-one .semlo-editor-database");
  const second = page.locator("#ai-two .semlo-editor-database");
  const refill = async (root: typeof first) => {
    await root.getByRole("button", { name: "文本列菜单" }).click();
    await root.getByRole("menuitem", { name: "重新填写本列内容" }).click();
  };
  await refill(first);
  await second.getByLabel("第 1 行 文本").fill("另一个编辑器");
  await second.getByLabel("第 1 行 文本").press("Tab");
  expect(await page.evaluate(() => Reflect.get(window, "aiInstances").calls[0].request.signal.aborted)).toBe(false);
  await page.evaluate(() => {
    const call = Reflect.get(window, "aiInstances").calls[0];
    call.resolve(call.request.records.map((record: { id: string }) => ({ recordId: record.id, value: "第一个" })));
  });
  await expect(first.getByLabel("第 1 行 文本")).toHaveValue("第一个");
  await expect(second.getByLabel("第 1 行 文本")).toHaveValue("另一个编辑器");
  await refill(first);
  await refill(second);
  await page.evaluate(() => Reflect.get(window, "aiInstances").editors[0].destroy());
  expect(await page.evaluate(() => Reflect.get(window, "aiInstances").calls[1].request.signal.aborted)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, "aiInstances").calls[2].request.signal.aborted)).toBe(false);
  await page.evaluate(() => {
    const call = Reflect.get(window, "aiInstances").calls[2];
    call.resolve(call.request.records.map((record: { id: string }) => ({ recordId: record.id, value: "第二个" })));
  });
  await expect(second.getByLabel("第 1 行 文本")).toHaveValue("第二个");
});

test("an abort handler may synchronously replace the document", async ({ page }) => {
  const data = createDatabaseData();
  data.fields[0].ai = { version: 1, mode: "summary", prompt: "" };
  await mount(page, data);
  const root = page.locator("#database-ai-test .semlo-editor-database");
  await expect(root).toBeVisible();
  await page.evaluate(() => {
    const editor = Reflect.get(window, "aiEditor");
    editor.setIntegrations({
      databaseAiFill: ({ signal }: { signal: AbortSignal }) =>
        new Promise(() => {
          signal.addEventListener("abort", () => {
            editor.setContent({
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "新的文档" }] }],
            });
          });
        }),
    });
  });
  await root.getByRole("button", { name: "文本列菜单" }).click();
  await root.getByRole("menuitem", { name: "重新填写本列内容" }).click();
  await page.evaluate(() => {
    const editor = Reflect.get(window, "aiEditor");
    const next = editor.getSnapshot().json;
    next.content[0].attrs.data.records[0].values[next.content[0].attrs.data.fields[0].id] = "新值";
    editor.setContent(next);
  });
  await expect(page.locator("#database-ai-test .ProseMirror")).toContainText("新的文档");
  await expect(root).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "aiEditor").getSnapshot().text)).toContain("新的文档");
});
