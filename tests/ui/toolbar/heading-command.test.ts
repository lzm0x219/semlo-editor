import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type {} from "../../fixtures/toolbar/heading-command-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/toolbar/heading-command-fixture.ts" },
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
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.headingCommandFixture));
});

const formattedDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "alpha",
          marks: [
            { type: "bold" },
            { type: "italic" },
            { type: "textStyle", attrs: { fontSize: "18px", color: "#ff0000" } },
            { type: "highlight", attrs: { color: "#fbde28" } },
          ],
        },
      ],
    },
  ],
};

type Entry = "default" | "custom" | "shortcut" | "set" | "toggle";
async function applyHeading(page: Page, entry: Entry) {
  if (entry === "default") {
    await page.locator("#heading-command-host").getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menu", { name: "段落样式" }).getByRole("menuitemradio", { name: "标题2" }).click();
  } else if (entry === "custom") {
    await page.getByRole("toolbar", { name: "自定义工具栏" }).getByRole("button", { name: "二级标题" }).click();
  } else if (entry === "shortcut") {
    await page.locator("#heading-command-host .semlo-editor-prose").focus();
    await page.keyboard.press("Alt+ControlOrMeta+2");
  } else if (entry === "set") {
    return page.evaluate(() => window.headingCommandFixture.set(2));
  } else {
    return page.evaluate(() => window.headingCommandFixture.toggle(2));
  }
}

for (const entry of ["default", "custom", "shortcut", "set", "toggle"] as const) {
  test(`${entry} 标题转换共享格式规则并保留反向选区及历史`, async ({ page }) => {
    const mode: "default" | "custom" | "hidden" =
      entry === "default" ? "default" : entry === "custom" ? "custom" : "hidden";
    await page.evaluate(({ mode, content }) => window.headingCommandFixture.mount(mode, content), {
      mode,
      content: formattedDocument,
    });
    await page.waitForFunction(() => window.headingCommandFixture.ready());
    await page.evaluate(() => window.headingCommandFixture.select("alpha", undefined, true));
    const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
    const selection = await page.evaluate(() => window.headingCommandFixture.selection());
    expect(selection).toEqual({ text: "alpha", backward: true, empty: false });
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
    const handled = await applyHeading(page, entry);
    if (entry === "set" || entry === "toggle") expect(handled).toBe(true);
    const after = await page.evaluate(() => window.headingCommandFixture.snapshot());
    const heading = after.content?.[0];
    expect(heading?.type).toBe("heading");
    expect(heading?.attrs?.level).toBe(2);
    expect(heading?.content?.[0].text).toBe("alpha");
    const marks = heading?.content?.[0].marks ?? [];
    expect(marks.some((mark) => mark.type === "bold" || mark.type === "italic")).toBe(false);
    expect(marks.find((mark) => mark.type === "textStyle")?.attrs).toMatchObject({ color: "#ff0000", fontSize: null });
    expect(marks.find((mark) => mark.type === "highlight")?.attrs?.color).toBe("#fbde28");
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 2, enabled: true });
    expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.headingCommandFixture.redo())).toBe(true);
    expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(after);
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    const repeatedHandled = await applyHeading(page, entry);
    if (entry === "set") expect(repeatedHandled).toBe(false);
    if (entry === "toggle") expect(repeatedHandled).toBe(true);
    const repeated = await page.evaluate(() => window.headingCommandFixture.snapshot());
    expect(repeated.content?.[0].type).toBe(entry === "default" || entry === "set" ? "heading" : "paragraph");
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    await page.evaluate(() => window.headingCommandFixture.destroy());
  });
}

test("公开命令支持正文及全部标题级别，并拒绝无效输入", async ({ page }) => {
  await page.evaluate((content) => window.headingCommandFixture.mount("hidden", content), formattedDocument);
  await page.evaluate(() => window.headingCommandFixture.select("alpha", undefined, true));
  const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
  const selection = await page.evaluate(() => window.headingCommandFixture.selection());
  for (const level of [-1, 1.5, 7, Number.NaN]) {
    expect(await page.evaluate((level) => window.headingCommandFixture.set(level), level)).toBe(false);
    expect(await page.evaluate((level) => window.headingCommandFixture.toggle(level), level)).toBe(false);
  }
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  for (let level = 1; level <= 6; level++) {
    expect(await page.evaluate((level) => window.headingCommandFixture.set(level), level)).toBe(true);
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level, enabled: true });
    expect(await page.evaluate((level) => window.headingCommandFixture.set(level), level)).toBe(false);
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level, enabled: true });
    expect(await page.evaluate((level) => window.headingCommandFixture.toggle(level), level)).toBe(true);
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
  }
  expect(await page.evaluate(() => window.headingCommandFixture.set(2))).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.set(0))).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
  expect(await page.evaluate(() => window.headingCommandFixture.toggle(0))).toBe(false);
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
  await page.evaluate(() => window.headingCommandFixture.destroy());
});

for (const mode of ["default", "custom"] as const) {
  test(`${mode} 的混合选区与只读状态和公开状态一致`, async ({ page }) => {
    const content = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "title" }] },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
      ],
    };
    await page.evaluate(({ mode, content }) => window.headingCommandFixture.mount(mode, content), { mode, content });
    await page.evaluate(() => window.headingCommandFixture.select("title", "body", true));
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: null, enabled: true });
    const button =
      mode === "default"
        ? page.locator('#heading-command-host button[aria-label="段落样式"]')
        : page.locator("#heading-command-host .demo-custom-toolbar button").filter({ hasText: "二级标题" });
    await expect(button).toBeEnabled();
    if (mode === "custom") await expect(button).toHaveAttribute("aria-pressed", "false");
    else await expect(button).toHaveText("");
    await page.evaluate(() => window.headingCommandFixture.editable(false));
    await expect(button).toBeDisabled();
    expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: null, enabled: false });
    const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
    expect(await page.evaluate(() => window.headingCommandFixture.set(2))).toBe(false);
    expect(await page.evaluate(() => window.headingCommandFixture.toggle(2))).toBe(false);
    expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
    await page.evaluate(() => window.headingCommandFixture.destroy());
  });
}

test("不同标题级别混合时无统一样式，同级标题可切换为正文", async ({ page }) => {
  const content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "first" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "second" }] },
    ],
  };
  await page.evaluate((content) => window.headingCommandFixture.mount("custom", content), content);
  await page.evaluate(() => window.headingCommandFixture.select("first", "second", true));
  const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
  const selection = await page.evaluate(() => window.headingCommandFixture.selection());
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: null, enabled: true });
  await applyHeading(page, "custom");
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 2, enabled: true });
  const headings = await page.evaluate(() => window.headingCommandFixture.snapshot());
  expect(headings.content?.map((node) => [node.type, node.attrs?.level])).toEqual([
    ["heading", 2],
    ["heading", 2],
  ]);
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  await applyHeading(page, "custom");
  expect(
    (await page.evaluate(() => window.headingCommandFixture.snapshot())).content?.map((node) => node.type),
  ).toEqual(["paragraph", "paragraph"]);
  expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(headings);
  expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  await page.evaluate(() => window.headingCommandFixture.destroy());
});

test("其他文本块沿用默认菜单的正文显示值", async ({ page }) => {
  const content = {
    type: "doc",
    content: [{ type: "codeBlock", content: [{ type: "text", text: "code" }] }],
  };
  await page.evaluate((content) => window.headingCommandFixture.mount("default", content), content);
  await page.evaluate(() => window.headingCommandFixture.select("code"));
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
  await expect(page.locator('#heading-command-host button[aria-label="段落样式"]')).toHaveText("正文");
  await page.evaluate(() => window.headingCommandFixture.editable(false));
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: false });
  await page.evaluate(() => window.headingCommandFixture.destroy());
});

for (const mode of ["default", "custom"] as const) {
  for (const entry of ["shortcut", "toggle"] as const) {
    test(`${mode} 折叠卡片跨区时禁用菜单并保留 ${entry} 的正文转换`, async ({ page }) => {
      const content = {
        type: "doc",
        content: [
          {
            type: "details",
            attrs: { open: true },
            content: [
              { type: "detailsSummary", content: [{ type: "text", text: "summary" }] },
              { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }] },
            ],
          },
        ],
      };
      await page.evaluate(({ mode, content }) => window.headingCommandFixture.mount(mode, content), { mode, content });
      await page.evaluate(() => window.headingCommandFixture.select("summary", "body", true));
      const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
      const selection = await page.evaluate(() => window.headingCommandFixture.selection());
      expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: false });
      await expect(
        page
          .locator("#heading-command-host")
          .getByRole("button", { name: mode === "default" ? "段落样式" : "二级标题" }),
      ).toBeDisabled();
      await applyHeading(page, entry);
      const after = await page.evaluate(() => window.headingCommandFixture.snapshot());
      expect(after.content?.[0].content?.[0]).toEqual(before.content?.[0].content?.[0]);
      expect(after.content?.[0].content?.[1].content?.[0].type).toBe("heading");
      expect(after.content?.[0].content?.[1].content?.[0].attrs?.level).toBe(2);
      expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
      expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: null, enabled: false });
      expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(true);
      expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
      expect(await page.evaluate(() => window.headingCommandFixture.redo())).toBe(true);
      expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(after);
      await page.evaluate(() => window.headingCommandFixture.destroy());
    });
  }
}

test("公开状态和命令随视图卸载、重挂载及销毁失效", async ({ page }) => {
  await page.evaluate((content) => window.headingCommandFixture.mount("hidden", content), formattedDocument);
  await page.evaluate(() => window.headingCommandFixture.select("alpha"));
  await page.evaluate(() => window.headingCommandFixture.unmount());
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: null, enabled: false });
  expect(await page.evaluate(() => window.headingCommandFixture.set(2))).toBe(false);
  expect(await page.evaluate(() => window.headingCommandFixture.toggle(2))).toBe(false);
  await page.evaluate(() => window.headingCommandFixture.remount());
  await page.evaluate(() => window.headingCommandFixture.select("alpha"));
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
  expect(await page.evaluate(() => window.headingCommandFixture.set(2))).toBe(true);
  await page.evaluate(() => window.headingCommandFixture.destroy());
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: null, enabled: false });
  expect(await page.evaluate(() => window.headingCommandFixture.set(2))).toBe(false);
  expect(await page.evaluate(() => window.headingCommandFixture.toggle(2))).toBe(false);
});

test("标题命令与状态按编辑器实例隔离", async ({ page }) => {
  await page.evaluate((content) => window.headingCommandFixture.mount("hidden", content), formattedDocument);
  await page.evaluate(() => {
    window.headingCommandFixture.select("alpha");
    window.headingCommandFixture.mountSecond("<p>beta</p>");
    window.headingCommandFixture.selectSecond("beta");
  });
  const first = await page.evaluate(() => window.headingCommandFixture.snapshot());
  expect(await page.evaluate(() => window.headingCommandFixture.toggleSecond(2))).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.stateSecond())).toEqual({ level: 2, enabled: true });
  expect(await page.evaluate(() => window.headingCommandFixture.state())).toEqual({ level: 0, enabled: true });
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(first);
  await page.evaluate(() => window.headingCommandFixture.destroy());
  expect(await page.evaluate(() => window.headingCommandFixture.toggleSecond(2))).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.stateSecond())).toEqual({ level: 0, enabled: true });
  expect((await page.evaluate(() => window.headingCommandFixture.snapshotSecond())).content?.[0].type).toBe(
    "paragraph",
  );
  await page.evaluate(() => window.headingCommandFixture.destroySecond());
});

const orderedDocument = (restart: boolean) => ({
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { start: 1, semloEditorOrderedStyle: "decimal" },
      content: ["甲甲", "乙乙", "丙丙", "丁丁"].map((text, index) => ({
        type: "listItem",
        attrs: { semloEditorListIndent: index === 0 ? 0 : 1, semloEditorListRestart: restart && index === 2 },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    },
    { type: "paragraph", content: [{ type: "text", text: "末尾" }] },
  ],
});

test("自定义标题按钮转换有序列表时保留其他列表项、选区和历史", async ({ page }) => {
  const items = (doc: JSONContent) => {
    const found: Array<{ text: string; indent: unknown; restart: unknown }> = [];
    const visit = (node: JSONContent) => {
      if (node.type === "listItem")
        found.push({
          text: node.content?.[0]?.content?.map((child) => child.text ?? "").join("") ?? "",
          indent: node.attrs?.semloEditorListIndent,
          restart: node.attrs?.semloEditorListRestart,
        });
      node.content?.forEach(visit);
    };
    visit(doc);
    return found;
  };
  await page.evaluate((content) => window.headingCommandFixture.mount("custom", content), orderedDocument(false));
  await page.evaluate(() => window.headingCommandFixture.select("乙乙", undefined, true));
  const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
  const selection = await page.evaluate(() => window.headingCommandFixture.selection());
  await applyHeading(page, "custom");
  const after = await page.evaluate(() => window.headingCommandFixture.snapshot());
  await expect(page.locator("#heading-command-host .semlo-editor-prose > h2")).toContainText("乙乙");
  expect(items(after)).toEqual(items(before).filter((item) => item.text !== "乙乙"));
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  expect(await page.evaluate(() => window.headingCommandFixture.redo())).toBe(true);
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(after);
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  await page.evaluate(() => window.headingCommandFixture.destroy());
});

test("不支持的重启列表转换会保留原文档与选区", async ({ page }) => {
  await page.evaluate((content) => window.headingCommandFixture.mount("custom", content), orderedDocument(true));
  await page.evaluate(() => window.headingCommandFixture.select("乙乙", undefined, true));
  const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
  const selection = await page.evaluate(() => window.headingCommandFixture.selection());
  await applyHeading(page, "custom");
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
  expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
  expect(await page.evaluate(() => window.headingCommandFixture.toggle(2))).toBe(false);
  expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
  expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(false);
  await page.evaluate(() => window.headingCommandFixture.destroy());
});

for (const framework of ["core", "react", "vue", "solid"] as const) {
  test(`${framework} 自定义工具栏在受控回写后保持标题样式、选区及历史`, async ({ page }) => {
    await page.evaluate(
      ({ framework, content }) => window.headingCommandFixture.mount("custom", content, framework, true),
      {
        framework,
        content: formattedDocument,
      },
    );
    await page.waitForFunction(() => window.headingCommandFixture.ready());
    await page.evaluate(() => window.headingCommandFixture.select("alpha", undefined, true));
    const before = await page.evaluate(() => window.headingCommandFixture.snapshot());
    const selection = await page.evaluate(() => window.headingCommandFixture.selection());
    await applyHeading(page, "custom");
    await page.waitForFunction(() => window.headingCommandFixture.echoCount() > 0);
    const after = await page.evaluate(() => window.headingCommandFixture.snapshot());
    expect(after.content?.[0].type).toBe("heading");
    expect(after.content?.[0].attrs?.level).toBe(2);
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.headingCommandFixture.undo())).toBe(true);
    expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(before);
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    expect(await page.evaluate(() => window.headingCommandFixture.redo())).toBe(true);
    expect(await page.evaluate(() => window.headingCommandFixture.snapshot())).toEqual(after);
    expect(await page.evaluate(() => window.headingCommandFixture.selection())).toEqual(selection);
    await page.evaluate(() => window.headingCommandFixture.destroy());
  });
}
