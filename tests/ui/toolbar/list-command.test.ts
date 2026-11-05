import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {} from "../../fixtures/toolbar/list-command-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/toolbar/list-command-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  try {
    await page.waitForFunction(() => Boolean(window.listCommandFixture), undefined, { timeout: 5_000 });
  } catch (error) {
    throw new Error(`列表测试夹具未加载：${errors.join("; ")}`, { cause: error });
  }
});

const taskDocument = {
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true, semloEditorListIndent: 0 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "甲任务" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: false, semloEditorListIndent: 1 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "乙任务" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: false, semloEditorListIndent: 0 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "丙任务" }] }],
        },
      ],
    },
  ],
};

for (const mode of ["default", "custom"] as const) {
  for (const [action, target] of [
    ["无序列表", "bulletList"],
    ["有序列表", "orderedList"],
  ] as const) {
    test(`${mode} ${action}仅转换选中待办并保留选区和历史`, async ({ page }) => {
      await page.evaluate(({ mode, content }) => window.listCommandFixture.mount(mode, content, true), {
        mode,
        content: taskDocument,
      });
      await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2, true));
      const before = await page.evaluate(() => window.listCommandFixture.snapshot());
      const selection = await page.evaluate(() => window.listCommandFixture.selection());
      expect(selection).toEqual({ text: "乙任", backward: true, empty: false });
      const host = page.locator("#list-command-host");
      const toolbar = host.getByRole("toolbar", { name: mode === "default" ? "文本格式" : "自定义工具栏" });
      await expect(toolbar.getByRole("button", { name: "待办事项", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(toolbar.getByRole("button", { name: action, exact: true })).toHaveAttribute("aria-pressed", "false");
      await toolbar.getByRole("button", { name: action, exact: true }).click();
      const after = await page.evaluate(() => window.listCommandFixture.snapshot());
      expect(after.content?.map((node) => node.type)).toEqual(["taskList", target, "taskList"]);
      expect(after.content?.[0].content?.[0].attrs).toMatchObject({ checked: true, semloEditorListIndent: 0 });
      expect(after.content?.[1].content?.[0].attrs).toMatchObject({ semloEditorListIndent: 1 });
      expect(after.content?.[2].content?.[0].attrs).toMatchObject({ checked: false, semloEditorListIndent: 0 });
      expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
      await expect(toolbar.getByRole("button", { name: action, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(toolbar.getByRole("button", { name: "待办事项", exact: true })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await page.waitForFunction(() => window.listCommandFixture.echoCount() > 0);
      expect(await page.evaluate(() => window.listCommandFixture.undo())).toBe(true);
      expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
      expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
      expect(await page.evaluate(() => window.listCommandFixture.redo())).toBe(true);
      expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(after);
      expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
      await page.evaluate(() => window.listCommandFixture.destroy());
    });
  }

  test(`${mode} 待办切换保留邻项、缩进、选区与撤销重做`, async ({ page }) => {
    await page.evaluate(({ mode, content }) => window.listCommandFixture.mount(mode, content, true), {
      mode,
      content: taskDocument,
    });
    await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2, true));
    const before = await page.evaluate(() => window.listCommandFixture.snapshot());
    const selection = await page.evaluate(() => window.listCommandFixture.selection());
    const toolbar = page
      .locator("#list-command-host")
      .getByRole("toolbar", { name: mode === "default" ? "文本格式" : "自定义工具栏" });
    const task = toolbar.getByRole("button", { name: "待办事项", exact: true });
    await expect(task).toHaveAttribute("aria-pressed", "true");
    await task.click();
    const after = await page.evaluate(() => window.listCommandFixture.snapshot());
    expect(after.content?.map((node) => node.type)).toEqual(["taskList", "paragraph", "taskList"]);
    expect(after.content?.[0].content?.[0].attrs).toMatchObject({ checked: true, semloEditorListIndent: 0 });
    expect(after.content?.[1].attrs).toMatchObject({ semloEditorIndent: 1 });
    expect(after.content?.[2].content?.[0].attrs).toMatchObject({ checked: false, semloEditorListIndent: 0 });
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    await expect(task).toHaveAttribute("aria-pressed", "false");
    await page.waitForFunction(() => window.listCommandFixture.echoCount() > 0);
    expect(await page.evaluate(() => window.listCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.listCommandFixture.redo())).toBe(true);
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(after);
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    await page.evaluate(() => window.listCommandFixture.destroy());
  });

  test(`${mode} 多个待办选区转换保留未选中项与反向选区`, async ({ page }) => {
    await page.evaluate(({ mode, content }) => window.listCommandFixture.mount(mode, content), {
      mode,
      content: taskDocument,
    });
    await page.evaluate(() => window.listCommandFixture.selectBetween("乙任务", "丙任务", true));
    const before = await page.evaluate(() => window.listCommandFixture.snapshot());
    const selection = await page.evaluate(() => window.listCommandFixture.selection());
    const toolbar = page
      .locator("#list-command-host")
      .getByRole("toolbar", { name: mode === "default" ? "文本格式" : "自定义工具栏" });
    await toolbar.getByRole("button", { name: "无序列表", exact: true }).click();
    const after = await page.evaluate(() => window.listCommandFixture.snapshot());
    expect(after.content?.map((node) => node.type)).toEqual(["taskList", "bulletList"]);
    expect(after.content?.[0].content?.[0].attrs).toMatchObject({ checked: true, semloEditorListIndent: 0 });
    expect(after.content?.[1].content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([1, 0]);
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.listCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.listCommandFixture.redo())).toBe(true);
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(after);
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    await page.evaluate(() => window.listCommandFixture.destroy());
  });

  test(`${mode} 转换已勾选待办后撤销恢复勾选状态`, async ({ page }) => {
    await page.evaluate(({ mode, content }) => window.listCommandFixture.mount(mode, content), {
      mode,
      content: taskDocument,
    });
    await page.evaluate(() => window.listCommandFixture.select("甲任务", 0, 2));
    const before = await page.evaluate(() => window.listCommandFixture.snapshot());
    const toolbar = page.locator("#list-command-host").getByRole("toolbar", {
      name: mode === "default" ? "文本格式" : "自定义工具栏",
    });
    await toolbar.getByRole("button", { name: "无序列表", exact: true }).click();
    const after = await page.evaluate(() => window.listCommandFixture.snapshot());
    expect(after.content?.map((node) => node.type)).toEqual(["bulletList", "taskList"]);
    expect(after.content?.[1].content?.map((node) => node.attrs?.checked)).toEqual([false, false]);
    expect(after.content?.[1].content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([1, 0]);
    expect(await page.evaluate(() => window.listCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.listCommandFixture.redo())).toBe(true);
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(after);
    await page.evaluate(() => window.listCommandFixture.destroy());
  });

  for (const source of ["bulletList", "orderedList"] as const) {
    test(`${mode} 把部分 ${source} 转为待办时保留邻项和缩进`, async ({ page }) => {
      const content = {
        type: "doc",
        content: [
          {
            type: source,
            content: ["甲任务", "乙任务", "丙任务"].map((text, index) => ({
              type: "listItem",
              attrs: { semloEditorListIndent: index === 1 ? 1 : 0 },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
        ],
      };
      await page.evaluate(({ mode, content }) => window.listCommandFixture.mount(mode, content), { mode, content });
      await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2, true));
      const before = await page.evaluate(() => window.listCommandFixture.snapshot());
      const selection = await page.evaluate(() => window.listCommandFixture.selection());
      const toolbar = page
        .locator("#list-command-host")
        .getByRole("toolbar", { name: mode === "default" ? "文本格式" : "自定义工具栏" });
      await toolbar.getByRole("button", { name: "待办事项", exact: true }).click();
      const after = await page.evaluate(() => window.listCommandFixture.snapshot());
      expect(after.content?.map((node) => node.type)).toEqual([source, "taskList", source]);
      expect(after.content?.[0].content?.[0].attrs?.semloEditorListIndent).toBe(0);
      expect(after.content?.[1].content?.[0].attrs).toMatchObject({ checked: false, semloEditorListIndent: 1 });
      expect(after.content?.[2].content?.[0].attrs?.semloEditorListIndent).toBe(0);
      expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
      expect(await page.evaluate(() => window.listCommandFixture.undo())).toBe(true);
      expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
      expect(await page.evaluate(() => window.listCommandFixture.redo())).toBe(true);
      expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(after);
      await page.evaluate(() => window.listCommandFixture.destroy());
    });
  }

  test(`${mode} 列表状态随只读和折叠卡片标题一致变化`, async ({ page }) => {
    const content = {
      type: "doc",
      content: [
        {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "卡片标题" }] },
            { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "卡片正文" }] }] },
          ],
        },
      ],
    };
    await page.evaluate(({ mode, content }) => window.listCommandFixture.mount(mode, content), { mode, content });
    await page.evaluate(() => window.listCommandFixture.select("卡片标题", 0, 2));
    const toolbar = page
      .locator("#list-command-host")
      .getByRole("toolbar", { name: mode === "default" ? "文本格式" : "自定义工具栏" });
    const before = await page.evaluate(() => window.listCommandFixture.snapshot());
    for (const [label, kind] of [
      ["无序列表", "bulletList"],
      ["有序列表", "orderedList"],
    ] as const) {
      await expect(toolbar.getByRole("button", { name: label, exact: true })).toBeDisabled();
      expect(await page.evaluate((kind) => window.listCommandFixture.state(kind), kind)).toEqual({
        active: false,
        enabled: false,
      });
      expect(await page.evaluate((kind) => window.listCommandFixture.toggle(kind), kind)).toBe(false);
    }
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
    await page.evaluate(() => window.listCommandFixture.selectBetween("卡片标题", "卡片正文", true));
    for (const label of ["无序列表", "有序列表"])
      await expect(toolbar.getByRole("button", { name: label, exact: true })).toBeDisabled();
    await page.evaluate(() => window.listCommandFixture.select("卡片正文", 0, 2));
    for (const label of ["无序列表", "有序列表", "待办事项"])
      await expect(toolbar.getByRole("button", { name: label, exact: true })).toBeEnabled();
    await page.evaluate(() => window.listCommandFixture.editable(false));
    for (const [label, kind] of [
      ["无序列表", "bulletList"],
      ["有序列表", "orderedList"],
      ["待办事项", "taskList"],
    ] as const) {
      const button =
        mode === "default"
          ? page.locator("#list-command-host .semlo-editor-toolbar").locator(`button[aria-label="${label}"]`)
          : toolbar.getByRole("button", { name: label, exact: true });
      await expect(button).toBeDisabled();
      expect((await page.evaluate((kind) => window.listCommandFixture.state(kind), kind)).enabled).toBe(false);
      expect(await page.evaluate((kind) => window.listCommandFixture.toggle(kind), kind)).toBe(false);
    }
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
    await page.evaluate(() => window.listCommandFixture.destroy());
  });
}

test("列表接口在视图卸载和销毁时不可用，重挂载后恢复", async ({ page }) => {
  await page.evaluate((content) => window.listCommandFixture.mount("custom", content), taskDocument);
  await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2));
  await page.evaluate(() => window.listCommandFixture.unmount());
  expect(await page.evaluate(() => window.listCommandFixture.state("taskList"))).toEqual({
    active: false,
    enabled: false,
  });
  expect(await page.evaluate(() => window.listCommandFixture.toggle("bulletList"))).toBe(false);
  await page.evaluate(() => window.listCommandFixture.remount());
  await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2));
  expect(await page.evaluate(() => window.listCommandFixture.state("taskList"))).toEqual({
    active: true,
    enabled: true,
  });
  await page.evaluate(() => window.listCommandFixture.destroy());
  expect(await page.evaluate(() => window.listCommandFixture.state("taskList"))).toEqual({
    active: false,
    enabled: false,
  });
  expect(await page.evaluate(() => window.listCommandFixture.toggle("bulletList"))).toBe(false);
});

test("光标处于待办时只读状态保留选中标记但禁止命令", async ({ page }) => {
  await page.evaluate((content) => window.listCommandFixture.mount("custom", content), taskDocument);
  await page.evaluate(() => window.listCommandFixture.select("乙任务", 1, 1));
  expect(await page.evaluate(() => window.listCommandFixture.state("taskList"))).toEqual({
    active: true,
    enabled: true,
  });
  await page.evaluate(() => window.listCommandFixture.editable(false));
  expect(await page.evaluate(() => window.listCommandFixture.state("taskList"))).toEqual({
    active: true,
    enabled: false,
  });
  const before = await page.evaluate(() => window.listCommandFixture.snapshot());
  expect(await page.evaluate(() => window.listCommandFixture.toggle("taskList"))).toBe(false);
  expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
  await page.evaluate(() => window.listCommandFixture.editable(true));
  expect(await page.evaluate(() => window.listCommandFixture.state("taskList"))).toEqual({
    active: true,
    enabled: true,
  });
  await page.evaluate(() => window.listCommandFixture.destroy());
});

test("多个编辑器的列表状态、命令和历史相互隔离", async ({ page }) => {
  await page.evaluate((content) => {
    window.listCommandFixture.mount("custom", content);
    window.listCommandFixture.mountSecond(content);
    window.listCommandFixture.selectSecond("乙任务", 0, 2);
    window.listCommandFixture.select("乙任务", 0, 2);
  }, taskDocument);
  const secondBefore = await page.evaluate(() => window.listCommandFixture.snapshotSecond());
  await page.locator("#list-command-host").getByRole("button", { name: "无序列表", exact: true }).click();
  expect(await page.evaluate(() => window.listCommandFixture.snapshotSecond())).toEqual(secondBefore);
  expect(await page.evaluate(() => window.listCommandFixture.stateSecond("taskList"))).toEqual({
    active: true,
    enabled: true,
  });
  await page.evaluate(() => window.listCommandFixture.destroy());
  expect(await page.evaluate(() => window.listCommandFixture.toggleSecond("orderedList"))).toBe(true);
  const secondAfter = await page.evaluate(() => window.listCommandFixture.snapshotSecond());
  expect(secondAfter.content?.map((node) => node.type)).toEqual(["taskList", "orderedList", "taskList"]);
  expect(secondAfter.content?.[0].content?.[0].attrs?.checked).toBe(true);
  expect(secondAfter.content?.[1].content?.[0].attrs?.semloEditorListIndent).toBe(1);
  expect(secondAfter.content?.[2].content?.[0].attrs?.checked).toBe(false);
  expect(await page.evaluate(() => window.listCommandFixture.undoSecond())).toBe(true);
  expect(await page.evaluate(() => window.listCommandFixture.snapshotSecond())).toEqual(secondBefore);
  await page.evaluate(() => window.listCommandFixture.destroySecond());
});

for (const framework of ["react", "vue", "solid"] as const) {
  for (const [action, target] of [
    ["无序列表", "bulletList"],
    ["有序列表", "orderedList"],
    ["待办事项", "paragraph"],
  ] as const) {
    test(`${framework} 受控回写中自定义${action}保留待办邻项及选区`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.evaluate(
        ({ content, framework }) => window.listCommandFixture.mount("custom", content, true, framework),
        {
          content: taskDocument,
          framework,
        },
      );
      await page.waitForFunction(() => window.listCommandFixture.ready(), undefined, { timeout: 5_000 });
      await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2, true));
      const selection = await page.evaluate(() => window.listCommandFixture.selection());
      const before = await page.evaluate(() => window.listCommandFixture.snapshot());
      await page
        .getByRole("toolbar", { name: "自定义工具栏" })
        .getByRole("button", { name: action, exact: true })
        .click();
      await page.waitForFunction(() => window.listCommandFixture.echoCount() >= 1, undefined, { timeout: 5_000 });
      const after = await page.evaluate(() => window.listCommandFixture.snapshot());
      expect(after.content?.map((node) => node.type)).toEqual(["taskList", target, "taskList"]);
      expect(after.content?.[0].content?.[0].attrs).toMatchObject({ checked: true, semloEditorListIndent: 0 });
      expect(after.content?.[2].content?.[0].attrs).toMatchObject({ checked: false, semloEditorListIndent: 0 });
      if (target === "paragraph") expect(after.content?.[1].attrs).toMatchObject({ semloEditorIndent: 1 });
      else expect(after.content?.[1].content?.[0].attrs).toMatchObject({ semloEditorListIndent: 1 });
      expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
      expect(await page.evaluate(() => window.listCommandFixture.undo())).toBe(true);
      await page.waitForFunction(() => window.listCommandFixture.echoCount() >= 2, undefined, { timeout: 5_000 });
      expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
      expect(await page.evaluate(() => window.listCommandFixture.redo())).toBe(true);
      await page.waitForFunction(() => window.listCommandFixture.echoCount() >= 3, undefined, { timeout: 5_000 });
      expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(after);
      await page.evaluate(() => window.listCommandFixture.destroy());
      expect(errors).toEqual([]);
    });
  }
}

test("无法安全转换的复杂待办保持内容和选区", async ({ page }) => {
  const content = {
    type: "doc",
    content: [
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "首段" }] },
              { type: "paragraph", content: [{ type: "text", text: "次段" }] },
            ],
          },
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "邻项" }] }],
          },
        ],
      },
    ],
  };
  await page.evaluate((content) => window.listCommandFixture.mount("custom", content), content);
  await page.evaluate(() => window.listCommandFixture.select("首段", 0, 1));
  const before = await page.evaluate(() => window.listCommandFixture.snapshot());
  const selection = await page.evaluate(() => window.listCommandFixture.selection());
  expect(await page.evaluate(() => window.listCommandFixture.state("bulletList"))).toEqual({
    active: false,
    enabled: true,
  });
  expect(await page.evaluate(() => window.listCommandFixture.toggle("bulletList"))).toBe(false);
  expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
  expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
  await page.evaluate(() => window.listCommandFixture.destroy());
});

test("模拟触屏可对选中待办使用自定义列表按钮并撤销", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.listCommandFixture));
    await page.evaluate((content) => window.listCommandFixture.mount("custom", content), taskDocument);
    await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2));
    const before = await page.evaluate(() => window.listCommandFixture.snapshot());
    const selection = await page.evaluate(() => window.listCommandFixture.selection());
    await page
      .getByRole("toolbar", { name: "自定义工具栏" })
      .getByRole("button", { name: "无序列表", exact: true })
      .tap();
    const after = await page.evaluate(() => window.listCommandFixture.snapshot());
    expect(after.content?.map((node) => node.type)).toEqual(["taskList", "bulletList", "taskList"]);
    expect(after.content?.[0].content?.[0].attrs?.checked).toBe(true);
    expect(after.content?.[1].content?.[0].attrs?.semloEditorListIndent).toBe(1);
    expect(after.content?.[2].content?.[0].attrs?.checked).toBe(false);
    expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
    await page.locator("#list-command-host .semlo-editor-prose").press("ControlOrMeta+z");
    expect(await page.evaluate(() => window.listCommandFixture.snapshot())).toEqual(before);
    await page.evaluate(() => window.listCommandFixture.destroy());
  } finally {
    await context.close();
  }
});

test("键盘激活自定义列表按钮时保留反向选区", async ({ page }) => {
  await page.evaluate((content) => window.listCommandFixture.mount("custom", content), taskDocument);
  await page.evaluate(() => window.listCommandFixture.select("乙任务", 0, 2, true));
  const selection = await page.evaluate(() => window.listCommandFixture.selection());
  const button = page
    .getByRole("toolbar", { name: "自定义工具栏" })
    .getByRole("button", { name: "无序列表", exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  const after = await page.evaluate(() => window.listCommandFixture.snapshot());
  expect(after.content?.map((node) => node.type)).toEqual(["taskList", "bulletList", "taskList"]);
  expect(after.content?.[0].content?.[0].attrs?.checked).toBe(true);
  expect(after.content?.[2].content?.[0].attrs?.checked).toBe(false);
  expect(await page.evaluate(() => window.listCommandFixture.selection())).toEqual(selection);
  await page.evaluate(() => window.listCommandFixture.destroy());
});
