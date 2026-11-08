import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent } from "../../../../packages/core/src/types";
import { dragSequence } from "../../../fixtures/list/sequences/browser-helpers";
import { crossLevelPasteContent } from "../../../fixtures/list/sequences/cross-level-paste-content";
import { nestedLegacyPasteContent } from "../../../fixtures/list/sequences/nested-legacy-paste-content";
import { linkedTypedPasteContent } from "../../../fixtures/list/sequences/numbering-sequence-paste-content";
import type { PasteFramework } from "../../../fixtures/list/sequences/numbering-sequence-paste-framework-fixture";

let origin: string;
let stop: (() => Promise<void>) | undefined;
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const fixture = window.sequencePasteFramework;
    if (fixture && !fixture.controller.editor.isDestroyed) fixture.destroy();
  });
  expect(browserErrors.get(page)).toEqual([]);
});
test.beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/list/sequences/numbering-sequence-paste-framework-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
          "@semlo-editor/react$": resolve("packages/react/dist/index.js"),
          "@semlo-editor/vue$": resolve("packages/vue/dist/index.js"),
          "@semlo-editor/solid$": resolve("packages/solid/dist/index.js"),
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
test.afterAll(async () => stop?.());

async function mount(page: Page, framework: PasteFramework, echo: "json" | "html", initial?: EditorContent) {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.mountSequencePasteFramework));
  await page.evaluate(({ framework, echo, initial }) => window.mountSequencePasteFramework(framework, echo, initial), {
    framework,
    echo,
    initial,
  });
  await settle(page);
}
const settle = (page: Page) => page.evaluate(() => window.sequencePasteFramework.settle());
const snapshot = (page: Page) => page.evaluate(() => window.sequencePasteFramework.controller.getSnapshot());
async function select(page: Page, first: string, a: number, last = first, b = a) {
  await page.evaluate(
    ({ first, a, last, b }) => {
      const editor = window.sequencePasteFramework.controller.editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === first) from = pos + 1 + a;
        if (node.type.name === "paragraph" && node.textContent === last) to = pos + 1 + b;
      });
      if (from < 0 || to < 0) throw new Error("框架目标选区不存在");
      editor.commands.setTextSelection({ from, to });
      editor.commands.focus();
    },
    { first, a, last, b },
  );
  await expect(page.locator("#paste-framework .semlo-editor-prose")).toBeFocused();
}
async function selectTextblocks(page: Page, first: string, last: string) {
  await page.evaluate(
    ({ first, last }) => {
      const editor = window.sequencePasteFramework.controller.editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (["paragraph", "heading"].includes(node.type.name) && node.textContent === first) from = pos + 1;
        if (["paragraph", "heading"].includes(node.type.name) && node.textContent === last)
          to = pos + 1 + node.content.size;
      });
      if (from < 0 || to < 0) throw new Error("文本块选区不存在");
      editor.commands.setTextSelection({ from, to });
      editor.commands.focus();
    },
    { first, last },
  );
}
async function copy(page: Page) {
  await select(page, "甲开头", 1, "丙结尾", 1);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("  a. 开头\n  a. 乙中段\n  b. 丙");
}
async function history(page: Page, command: "undo" | "redo") {
  expect(
    await page.evaluate((command) => window.sequencePasteFramework.controller.editor.commands[command](), command),
  ).toBe(true);
  await settle(page);
}

for (const framework of ["react", "vue", "solid"] as const) {
  if (framework === "react")
    test("单序列续接整段转正文后保留两侧间隔并可接回", async ({ page }) => {
      const list = (link: string, start: number, names: string[]) => ({
        type: "orderedList",
        attrs: {
          semloEditorListSequenceLink: link,
          semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
        },
        content: names.map((text) => ({
          type: "listItem",
          attrs: { semloEditorListSequence: "A" },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      });
      await mount(page, framework, "html", {
        type: "doc",
        content: [
          list("v1:_:E1", 1, ["甲"]),
          { type: "paragraph", content: [{ type: "text", text: "间隔一" }] },
          list("v1:E1:E2", 2, ["乙", "丙"]),
          { type: "paragraph", content: [{ type: "text", text: "间隔二" }] },
          list("v1:E2:_", 4, ["丁"]),
        ],
      });
      await select(page, "乙", 0, "丙", 1);
      await page.keyboard.press("ControlOrMeta+Alt+0");
      await settle(page);
      const converted = await snapshot(page);
      expect(converted.json.content!.filter((node) => node.attrs?.semloEditorListSequenceConversion)).toHaveLength(2);
      await select(page, "乙", 0, "丙", 1);
      const ordered = page.getByRole("button", { name: "有序列表", exact: true });
      if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
      await ordered.click();
      await settle(page);
      const restored = await snapshot(page);
      expect(restored.json.content?.map((node) => node.type)).toEqual([
        "orderedList",
        "paragraph",
        "orderedList",
        "paragraph",
        "orderedList",
      ]);
      expect(restored.json.content?.[1].content?.[0].text).toBe("间隔一");
      expect(restored.json.content?.[3].content?.[0].text).toBe("间隔二");
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 2, 3, 4]);
      await history(page, "undo");
      expect((await snapshot(page)).json).toEqual(converted.json);
    });
  test(`${framework} 交错待办经正文和无序列表后仍按来源接回`, async ({ page }) => {
    const initial: EditorContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorListSequences: {
              version: 1,
              sequences: [
                { id: "A", start: 1, origin: "initial" },
                { id: "B", start: 1, origin: "restart" },
              ],
            },
          },
          content: ["甲", "乙", "丙", "丁", "戊"].map((text, index) => ({
            type: "listItem",
            attrs: { semloEditorListSequence: index % 2 ? "B" : "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    };
    await mount(page, framework, framework === "react" ? "json" : "html", initial);
    const before = await snapshot(page);
    await select(page, "乙", 0, "丙", 1);
    const task = page.getByRole("button", { name: "待办事项", exact: true });
    if (!(await task.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await task.click();
    await settle(page);
    await select(page, "乙", 0, "丙", 1);
    if (!(await task.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await task.click();
    await settle(page);
    const paragraphs = await snapshot(page);
    expect(
      paragraphs.json.content!.slice(1, 3).map((node) => JSON.parse(node.attrs!.semloEditorListSequenceConversion)[2]),
    ).toEqual(["B", "A"]);
    await select(page, "乙", 0, "丙", 1);
    const bullet = page.getByRole("button", { name: "无序列表", exact: true });
    if (!(await bullet.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await bullet.click();
    await settle(page);
    expect((await snapshot(page)).json.content?.[1].type).toBe("bulletList");
    await select(page, "乙", 0, "丙", 1);
    const ordered = page.getByRole("button", { name: "有序列表", exact: true });
    if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await ordered.click();
    await settle(page);
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "undo");
    expect((await snapshot(page)).json.content?.[1].type).toBe("bulletList");
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(before.json);
  });
  for (const whole of [false, true]) {
    test(`${framework} 交错续接片段${whole ? "整段" : "中间项"}转换并恢复编号`, async ({ page }) => {
      const list = (previous: string, next: string, start: number, texts: string[]) => ({
        type: "orderedList",
        attrs: {
          semloEditorListSequenceLink: `v1:${previous}:${next}`,
          semloEditorListSequences: {
            version: 1,
            sequences: [
              { id: "A", start, origin: "initial" },
              { id: "B", start, origin: "restart" },
            ],
          },
        },
        content: texts.map((text, index) => ({
          type: "listItem",
          attrs: { semloEditorListSequence: index % 2 ? "B" : "A" },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      });
      const initial: EditorContent = {
        type: "doc",
        content: [
          list("_", "E1", 1, ["甲", "乙"]),
          { type: "paragraph", content: [{ type: "text", text: "间隔一" }] },
          list("E1", "E2", 2, ["丙", "丁", "戊", "己"]),
          { type: "paragraph", content: [{ type: "text", text: "间隔二" }] },
          list("E2", "_", 4, ["庚", "辛"]),
        ],
      };
      await mount(page, framework, framework === "react" ? "json" : "html", initial);
      const before = await snapshot(page);
      await select(page, whole ? "丙" : "丁", 0, whole ? "己" : "丁", 1);
      if (whole) await page.keyboard.press("ControlOrMeta+Alt+0");
      else {
        await page.getByRole("button", { name: "段落样式" }).click();
        await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
      }
      await settle(page);
      const converted = await snapshot(page);
      const convertedBlocks = converted.json.content!.filter((node) => node.attrs?.semloEditorListSequenceConversion);
      expect(convertedBlocks.map((node) => JSON.parse(node.attrs!.semloEditorListSequenceConversion)[2])).toEqual(
        whole ? ["A", "B", "A", "B"] : ["B"],
      );
      if (!whole) {
        await selectTextblocks(page, "丁", "丁");
        await page.keyboard.press("ControlOrMeta+Alt+0");
        await settle(page);
      }
      await select(page, whole ? "丙" : "丁", 0, whole ? "己" : "丁", 1);
      const ordered = page.getByRole("button", { name: "有序列表", exact: true });
      if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
      await ordered.click();
      await settle(page);
      const restored = await snapshot(page);
      const lists = restored.json.content!.filter((node) => node.type === "orderedList");
      expect(lists.map((node) => node.content!.map((item) => item.attrs!.semloEditorListSequence))).toEqual([
        ["A", "B"],
        ["A", "B", "A", "B"],
        ["A", "B"],
      ]);
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
      await history(page, "undo");
      expect((await snapshot(page)).json).not.toEqual(restored.json);
      await history(page, "redo");
      expect((await snapshot(page)).json).toEqual(restored.json);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
      if (!whole) expect(before.json.content![0].attrs!.semloEditorListSequenceLink).toMatch(/^v1:/);
    });
  }
  for (const target of ["paragraph", "heading"] as const) {
    test(`${framework} 交错编号中间项转${target === "heading" ? "标题" : "正文"}后恢复原序列`, async ({ page }) => {
      const initial: EditorContent = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: {
              semloEditorListSequences: {
                version: 1,
                sequences: [
                  { id: "A", start: 1, origin: "initial" },
                  { id: "B", start: 1, origin: "restart" },
                ],
              },
            },
            content: ["甲", "乙", "丙", "丁", "戊"].map((text, index) => ({
              type: "listItem",
              attrs: { semloEditorListSequence: index % 2 ? "B" : "A" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
        ],
      };
      await mount(page, framework, framework === "react" ? "json" : "html", initial);
      const before = await snapshot(page);
      await select(page, "乙", 0, "丙", 1);
      if (target === "heading") {
        await page.getByRole("button", { name: "段落样式" }).click();
        await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
      } else await page.keyboard.press("ControlOrMeta+Alt+0");
      await settle(page);
      const converted = await snapshot(page);
      expect(converted.json.content?.map((node) => node.type)).toEqual(["orderedList", target, target, "orderedList"]);
      expect(
        converted.json.content!.slice(1, 3).map((node) => JSON.parse(node.attrs!.semloEditorListSequenceConversion)[2]),
      ).toEqual(["B", "A"]);
      expect(converted.html).toContain("data-semlo-editor-list-sequence-conversion");
      if (target === "heading") {
        await selectTextblocks(page, "乙", "丙");
        await page.keyboard.press("ControlOrMeta+Alt+0");
        await settle(page);
        expect(
          (await snapshot(page)).json
            .content!.slice(1, 3)
            .map((node) => JSON.parse(node.attrs!.semloEditorListSequenceConversion)[2]),
        ).toEqual(["B", "A"]);
      }
      await select(page, "乙", 0, "丙", 1);
      const ordered = page.getByRole("button", { name: "有序列表", exact: true });
      if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
      await ordered.click();
      await settle(page);
      expect((await snapshot(page)).json).toEqual(before.json);
      await history(page, "undo");
      expect((await snapshot(page)).json.content?.map((node) => node.type)).toEqual([
        "orderedList",
        "paragraph",
        "paragraph",
        "orderedList",
      ]);
      await history(page, "redo");
      expect((await snapshot(page)).json).toEqual(before.json);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });
  }
  test(`${framework} 交错编号转换保留受控回写和撤销`, async ({ page }) => {
    await mount(page, framework, framework === "react" ? "json" : "html", {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorListSequences: {
              version: 1,
              sequences: [
                { id: "A", start: 1, origin: "initial" },
                { id: "B", start: 1, origin: "restart" },
              ],
            },
          },
          content: ["甲", "乙", "丙", "丁", "戊"].map((text, index) => ({
            type: "listItem",
            attrs: { semloEditorListSequence: index % 2 ? "B" : "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    });
    const before = await snapshot(page);
    await select(page, "乙", 0, "丙", 1);
    const task = page.getByRole("button", { name: "待办事项", exact: true });
    if (!(await task.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await task.click();
    await settle(page);
    const converted = await snapshot(page);
    const items = converted.json.content!.find((node) => node.type === "taskList")!.content!;
    expect(items.map((item) => JSON.parse(item.attrs!.semloEditorListSequenceConversion)[2])).toEqual(["B", "A"]);
    await select(page, "乙", 0, "丙", 1);
    const ordered = page.getByRole("button", { name: "有序列表", exact: true });
    if (!(await ordered.isVisible())) await page.getByRole("button", { name: "更多", exact: true }).click();
    await ordered.click();
    await settle(page);
    const restored = await snapshot(page);
    expect(restored.json.content![0].content!.map((item) => item.attrs!.semloEditorListSequence)).toEqual([
      "A",
      "B",
      "A",
      "B",
      "A",
    ]);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(converted.json);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
  });
  test(`${framework} 格式刷接入交错续接的来源序列并保留回写`, async ({ page }) => {
    const list = (start: number, previous: string, next: string, names: string[]) => ({
      type: "orderedList",
      attrs: {
        semloEditorListSequences: {
          version: 1,
          sequences: [
            { id: "A", start, origin: "initial" },
            { id: "B", start, origin: "restart" },
          ],
        },
        semloEditorListSequenceLink: `v2:${previous}:${next}`,
      },
      content: names.map((text, index) => ({
        type: "listItem",
        attrs: { semloEditorListSequence: index ? "B" : "A" },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    });
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        list(1, "_", "edge", ["SOURCE", "LEFTB"]),
        { type: "paragraph", content: [{ type: "text", text: "TARGET" }] },
        list(2, "edge", "_", ["RIGHTA", "RIGHTB"]),
      ],
    });
    const before = await snapshot(page);
    await select(page, "SOURCE", 0, "SOURCE", 6);
    const painter = page.locator("#paste-framework .semlo-editor-format-painter");
    await painter.click();
    await expect(painter).toHaveAttribute("aria-pressed", "true");
    await page.locator("#paste-framework .semlo-editor-prose > p").click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    await settle(page);
    const after = await snapshot(page);
    const lists = after.json.content!.filter((node) => node.type === "orderedList");
    expect(lists.map((node) => node.content!.map((child) => child.attrs!.semloEditorListSequence))).toEqual([
      ["A", "B", "A"],
      ["A", "B"],
    ]);
    expect(
      await page
        .locator("#paste-framework ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 1, 2, 3, 2]);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
  });
  test(`${framework} 格式刷升级续接链并保留受控回写与撤销`, async ({ page }) => {
    const list = (start: number, previous: string, next: string, texts: string[]) => ({
      type: "orderedList",
      attrs: {
        semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
        semloEditorListSequenceLink: `v1:${previous}:${next}`,
      },
      content: texts.map((text) => ({
        type: "listItem",
        attrs: { semloEditorListSequence: "A" },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    });
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "SOURCE" }] },
        list(1, "_", "edge", ["BEFORE", "TARGET", "AFTER"]),
        { type: "paragraph", content: [{ type: "text", text: "GAP" }] },
        list(4, "edge", "_", ["TAIL", "LAST"]),
      ],
    });
    const before = await snapshot(page);
    await page.evaluate(() => {
      const editor = window.sequencePasteFramework.controller.editor;
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.textContent === "SOURCE") from = pos + 1;
      });
      if (from < 0) throw new Error("来源标题不存在");
      editor.commands.focus();
      editor.commands.setTextSelection({ from, to: from + "SOURCE".length });
    });
    const painter = page.locator("#paste-framework .semlo-editor-format-painter");
    await painter.click();
    await expect(painter).toHaveAttribute("aria-pressed", "true");
    await page.locator("#paste-framework ol li p").filter({ hasText: "TARGET" }).click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    await settle(page);
    const after = await snapshot(page);
    const lists = after.json.content!.filter((node) => node.type === "orderedList");
    expect(lists).toHaveLength(3);
    expect(lists.every((node) => String(node.attrs!.semloEditorListSequenceLink).startsWith("v3:"))).toBe(true);
    expect(after.json.content!.some((node) => node.type === "heading" && node.content?.[0]?.text === "TARGET")).toBe(
      true,
    );
    expect(
      await page
        .locator("#paste-framework ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 2, 3, 4]);
    await history(page, "undo");
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    expect(await snapshot(page)).toEqual(after);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });
  for (const sample of [
    { gap: "taskList", echo: "json", version: 2 },
    { gap: "heading", echo: "html", version: 3 },
  ] as const)
    test(`${framework} ${sample.echo} 受控跨类型续接再次粘贴保留编号和历史`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, sample.echo, linkedTypedPasteContent(sample.gap));
      const before = await snapshot(page);
      await page.evaluate(() => navigator.clipboard.writeText("新\n行"));
      await select(page, "丙结尾", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const after = await snapshot(page);
      const lists = after.json.content!.filter((node) => node.type === "orderedList");
      expect(lists).toHaveLength(3);
      expect(
        lists.every((list) => String(list.attrs!.semloEditorListSequenceLink).startsWith(`v${sample.version}:`)),
      ).toBe(true);
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 1, 2, 3]);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });
  test(`${framework} 引用内编号列表格式刷接入正文并保留回写和撤销`, async ({ page }) => {
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "orderedList",
              attrs: {
                semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
              },
              content: ["SOURCE", "BEFORE"].map((text) => ({
                type: "listItem",
                attrs: { semloEditorListSequence: "A" },
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            { type: "paragraph", content: [{ type: "text", text: "TARGET" }] },
          ],
        },
      ],
    });
    const before = await snapshot(page);
    await select(page, "SOURCE", 0, "SOURCE", 6);
    const painter = page.locator("#paste-framework .semlo-editor-format-painter");
    await painter.click();
    await page.locator("#paste-framework blockquote > p").click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    await settle(page);
    const after = await snapshot(page);
    const quote = after.json.content?.[0];
    expect(quote?.content?.map((node) => node.type)).toEqual(["orderedList"]);
    expect(quote?.content?.[0].content?.map((node) => node.attrs?.semloEditorListSequence)).toEqual(["A", "A", "A"]);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(after.json);
  });

  test(`${framework} 格式刷转换引用内标题并保留 HTML 回写和撤销`, async ({ page }) => {
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "SOURCE", marks: [{ type: "bold" }] }] },
        {
          type: "blockquote",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "TARGET" }] },
            { type: "paragraph", content: [{ type: "text", text: "RETAIN" }] },
          ],
        },
      ],
    });
    const before = await snapshot(page);
    await select(page, "SOURCE", 0, "SOURCE", 6);
    const painter = page.locator("#paste-framework .semlo-editor-format-painter");
    await painter.click();
    await page.locator("#paste-framework blockquote h2").click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    await settle(page);
    const after = await snapshot(page);
    const quote = after.json.content?.[1];
    expect(quote?.type).toBe("blockquote");
    expect(quote?.content?.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(quote?.content?.[0].content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(quote?.content?.[1].content?.[0].text).toBe("RETAIN");
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(after.json);
  });

  test(`${framework} 格式刷转换编号列表并在 HTML 回写后保持一次撤销`, async ({ page }) => {
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "SOURCE", marks: [{ type: "bold" }] }] },
        {
          type: "orderedList",
          attrs: { semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] } },
          content: ["BEFORE", "TARGET", "AFTER"].map((text) => ({
            type: "listItem",
            attrs: { semloEditorListSequence: "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    });
    const before = await snapshot(page);
    await select(page, "SOURCE", 0, "SOURCE", 6);
    const painter = page.locator("#paste-framework .semlo-editor-format-painter");
    await painter.click();
    await expect(painter).toHaveAttribute("aria-pressed", "true");
    await page.locator("#paste-framework .tiptap ol li p").filter({ hasText: "TARGET" }).click();
    await expect(painter).toHaveAttribute("aria-pressed", "false");
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.controller.editor.state.selection.empty)).toBe(true);
    await expect(page.locator("#paste-framework .semlo-editor-bubble")).toBeHidden();
    const after = await snapshot(page);
    expect(after.json.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "orderedList",
      "paragraph",
      "orderedList",
    ]);
    expect(after.json.content?.[2].content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(after.json.content?.[3].attrs?.semloEditorListSequenceLink).toMatch(/^v1:/);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} 编号列表与正文同选转待办或无序列表`, async ({ page }) => {
    const kind = framework === "vue" ? "bulletList" : "taskList";
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
          },
          content: ["甲", "乙"].map((text) => ({
            type: "listItem",
            attrs: { semloEditorListSequence: "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      ],
    });
    const before = await snapshot(page);
    await select(page, "乙", 0, "正文", 2);
    if (framework === "react") await page.getByRole("button", { name: "待办事项", exact: true }).click();
    else await page.keyboard.press(kind === "taskList" ? "ControlOrMeta+Alt+t" : "ControlOrMeta+Shift+8");
    await settle(page);
    const after = await snapshot(page);
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", kind]);
    expect(after.json.content?.[1].content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(["乙", "正文"]);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(after.json);
  });

  test(`${framework} 编号列表与正文同选转换支持回写和撤销`, async ({ page }) => {
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
          },
          content: ["甲", "乙"].map((text) => ({
            type: "listItem",
            attrs: { semloEditorListSequence: "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      ],
    });
    const before = await snapshot(page);
    await select(page, "乙", 0, "正文", 2);
    await page.getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
    await settle(page);
    const after = await snapshot(page);
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "heading", "heading"]);
    expect(after.json.content?.slice(1).map((node) => node.attrs?.semloEditorHeadingNumbering)).toEqual([
      "mixed",
      "mixed",
    ]);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(after.json);
    await history(page, "undo");
    await select(page, "乙", 0, "正文", 2);
    await page.keyboard.press("ControlOrMeta+Alt+0");
    await settle(page);
    const paragraphs = await snapshot(page);
    expect(paragraphs.json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph", "paragraph"]);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(paragraphs.json);
  });

  test(`${framework} 标题链接在 HTML 受控回写后保持稳定`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await mount(page, framework, "html", {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "标题" }] },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      ],
    });
    await page.locator("#paste-framework .semlo-editor-prose > h3").hover();
    const button = page.getByRole("button", { name: "复制 3 级标题的段落链接" });
    await button.click();
    await expect(page.getByRole("status")).toHaveText("复制成功");
    const url = await page.evaluate(() => navigator.clipboard.readText());
    const after = await snapshot(page);
    const id = after.json.content?.[0].attrs?.semloEditorHeadingAnchor;
    expect(id).toMatch(/^sh-[a-f0-9-]+$/);
    expect(new URL(url).searchParams.get("semlo-heading")).toBe(id);
    await page.evaluate((html) => window.sequencePasteFramework.setContent(html), after.html);
    await settle(page);
    expect((await snapshot(page)).json).toEqual(after.json);
    await button.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await page.evaluate(() => {
      const editor = window.sequencePasteFramework.controller.editor;
      editor.commands.setTextSelection(2);
      editor.view.focus();
    });
    await page.keyboard.press("Enter");
    await settle(page);
    const split = await snapshot(page);
    const headings = split.json.content?.filter((node) => node.type === "heading") ?? [];
    expect(headings[0].attrs?.semloEditorHeadingAnchor).toBe(id);
    expect(headings.slice(1).every((node) => node.attrs?.semloEditorHeadingAnchor == null)).toBe(true);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(after.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(split.json);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });

  test(`${framework} 编号列表连续中间项转正文支持续号和同步撤销`, async ({ page }) => {
    const initial: EditorContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorOrderedStyle: "mixed",
            semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
          },
          content: ["甲", "乙", "丙", "丁"].map((text) => ({
            type: "listItem",
            attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
      ],
    };
    await mount(page, framework, "html", initial);
    const before = await snapshot(page);
    await select(page, "乙", 0, "丙", 1);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.keyboard.press("ControlOrMeta+Alt+0");
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    const after = await snapshot(page);
    expect(after.json.content?.map((node) => node.type)).toEqual([
      "orderedList",
      "paragraph",
      "paragraph",
      "orderedList",
      "paragraph",
    ]);
    expect(after.json.content?.[0].attrs?.semloEditorListSequenceLink).toMatch(/^v1:_:/);
    expect(after.json.content?.[3].attrs?.semloEditorListSequenceLink).toMatch(/^v1:.*:_$/);
    await select(page, "乙", 0, "丙", 1);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true, true]);
    expect((await snapshot(page)).json).toEqual(after.json);
    await history(page, "redo");
    expect((await snapshot(page)).json).toEqual(before.json);
    await select(page, "甲", 1);
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增");
    await settle(page);
    expect(
      await page
        .locator("#paste-framework .semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });

  for (const multi of [false, true])
    test(`${framework} 编号列表${multi ? "连续中间项" : "中间项"}转标题支持续号和同步撤销`, async ({ page }) => {
      const initial: EditorContent = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: {
              semloEditorOrderedStyle: "mixed",
              semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
            },
            content: (multi ? ["甲", "乙", "丙", "丁"] : ["甲", "乙", "丙"]).map((text) => ({
              type: "listItem",
              attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
          { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
        ],
      };
      await mount(page, framework, "html", initial);
      const before = await snapshot(page);
      await select(page, "乙", multi ? 0 : 1, multi ? "丙" : "乙", 1);
      await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.getByRole("button", { name: "段落样式" }).click();
      await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
      await settle(page);
      expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      const after = await snapshot(page);
      expect(after.json.content?.map((node) => node.type)).toEqual(
        multi
          ? ["orderedList", "heading", "heading", "orderedList", "paragraph"]
          : ["orderedList", "heading", "orderedList", "paragraph"],
      );
      expect(after.json.content?.[0].attrs?.semloEditorListSequenceLink).toMatch(/^v3:_:/);
      expect(after.json.content?.[multi ? 3 : 2].attrs?.semloEditorListSequenceLink).toMatch(/^v3:.*:_$/);
      await select(page, "甲", 1);
      await page.keyboard.press("Enter");
      await page.keyboard.type("新增");
      await settle(page);
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 2, 3]);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  test(`${framework} 编号列表末项转标题支持受控回写与同步撤销`, async ({ page }) => {
    const initial: EditorContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorOrderedStyle: "mixed",
            semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
          },
          content: ["甲", "乙", "丙"].map((text) => ({
            type: "listItem",
            attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
      ],
    };
    await mount(page, framework, "html", initial);
    const before = await snapshot(page);
    await select(page, "丙", 1);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    const after = await snapshot(page);
    expect(after.json.content?.map((node) => node.type)).toEqual(["orderedList", "heading", "paragraph"]);
    expect(after.json.content?.[1].attrs).toMatchObject({ level: 3, semloEditorHeadingNumbering: "mixed" });
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });

  test(`${framework} 末尾子项转换和接回支持受控回写与同步撤销`, async ({ page }) => {
    const initial: EditorContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            semloEditorOrderedStyle: "mixed",
            semloEditorListSequences: {
              version: 1,
              sequences: [
                { id: "A", start: 1, origin: "initial" },
                { id: "B", start: 1, origin: "initial" },
              ],
            },
          },
          content: ["甲", "乙", "丙"].map((text, index) => ({
            type: "listItem",
            attrs: { semloEditorListIndent: index === 0 ? 0 : 1, semloEditorListSequence: index === 0 ? "A" : "B" },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
      ],
    };
    await mount(page, framework, "html", initial);
    const before = await snapshot(page);
    await select(page, "丙", 1);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.getByRole("button", { name: "待办事项", exact: true }).click();
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    const converted = await snapshot(page);
    expect(converted.json.content?.map((node) => node.type)).toEqual(["orderedList", "taskList", "paragraph"]);
    await select(page, "丙", 1);
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    await settle(page);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });

  for (const multi of [false, true])
    test(`${framework} 受控${multi ? "连续项" : "中间项"}转待办后仍续接并支持同步撤销`, async ({ page }) => {
      const initial: EditorContent = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: {
              semloEditorOrderedStyle: "mixed",
              semloEditorListSequences: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
            },
            content: (multi ? ["甲", "乙", "丙", "丁"] : ["甲", "乙", "丙"]).map((text) => ({
              type: "listItem",
              attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
          { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
        ],
      };
      await mount(page, framework, "html", initial);
      const before = await snapshot(page);
      await select(page, "乙", multi ? 0 : 1, multi ? "丙" : "乙", 1);
      await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.getByRole("button", { name: "待办事项", exact: true }).click();
      await settle(page);
      expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      const converted = await snapshot(page);
      expect(converted.json.content?.map((node) => node.type)).toEqual([
        "orderedList",
        "taskList",
        "orderedList",
        "paragraph",
      ]);
      await select(page, "甲", 1);
      await page.keyboard.press("Enter");
      await page.keyboard.type("新增");
      await settle(page);
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 2, 3]);
      await select(page, "乙", multi ? 0 : 1, multi ? "丙" : "乙", 1);
      await page.getByRole("button", { name: "有序列表", exact: true }).click();
      await settle(page);
      expect((await snapshot(page)).json.content?.map((node) => node.type)).toEqual(["orderedList", "paragraph"]);
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual(multi ? [1, 2, 3, 4, 5] : [1, 2, 3, 4]);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  test(`${framework} 已有续接单项转换与接回支持受控回写和同步撤销`, async ({ page }) => {
    const list = (text: string, start: number, link: string) => ({
      type: "orderedList",
      attrs: {
        semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
        semloEditorListSequenceLink: link,
      },
      content: [
        {
          type: "listItem",
          attrs: { semloEditorListSequence: "A" },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      ],
    });
    const initial: EditorContent = {
      type: "doc",
      content: [
        list("甲", 1, "v1:_:left"),
        { type: "paragraph", content: [{ type: "text", text: "间隔一" }] },
        list("乙", 2, "v1:left:right"),
        { type: "paragraph", content: [{ type: "text", text: "间隔二" }] },
        list("丙", 3, "v1:right:_"),
      ],
    };
    await mount(page, framework, "html", initial);
    const before = await snapshot(page);
    await select(page, "乙", 1);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.getByRole("button", { name: "待办事项", exact: true }).click();
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    const converted = await snapshot(page);
    await select(page, "乙", 1);
    await page.getByRole("button", { name: "有序列表", exact: true }).click();
    await settle(page);
    expect(
      await page
        .locator("#paste-framework .semlo-editor-prose > ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 2, 3]);
    await history(page, "undo");
    expect((await snapshot(page)).json).toEqual(converted.json);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}旧嵌套列表粘贴与续接拖动可回写和撤销`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo, nestedLegacyPasteContent());
      const original = await snapshot(page);
      await select(page, "甲开头", 1, "乙中段", 1);
      await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
      if (echo === "html") await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      if (echo === "html") {
        expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
        expect(await snapshot(page)).toEqual(original);
        await history(page, "redo");
      }
      const split = await snapshot(page);
      const prose = page.locator("#paste-framework .semlo-editor-prose");
      await expect(prose.locator("ol > li p")).toHaveText(["父", "甲一", "中段", "丙结尾", "丁后续"]);
      if (echo === "json") await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await dragSequence(
        page,
        prose.getByText("中段", { exact: true }),
        prose.getByText("甲一", { exact: true }),
        true,
      );
      await settle(page);
      if (echo === "json") {
        expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
        expect(await snapshot(page)).toEqual(split);
        await history(page, "redo");
      }
      const moved = await snapshot(page);
      await expect(prose.locator("ol > li p")).toHaveText(["父", "中段", "甲一", "丙结尾", "丁后续"]);
      expect(
        await prose.locator("ol > li").evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 2, 1, 2, 3]);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(split);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(moved);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控跨父子项粘贴保留编号与历史`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo, crossLevelPasteContent());
      await select(page, "父乙", 1, "父丙", 1);
      await page.keyboard.press("ControlOrMeta+c");
      const before = await snapshot(page);
      await select(page, "父甲", 1, "子乙", 1);
      if (echo === "html") await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      if (echo === "html") {
        expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
        expect(await snapshot(page)).toEqual(before);
        await history(page, "redo");
      }
      const after = await snapshot(page);
      const items = page.locator("#paste-framework .semlo-editor-prose > ol > li");
      await expect(items).toHaveCount(4);
      expect(await items.locator("p").allTextContents()).toEqual(["父乙", "父乙", "父乙", "父丙"]);
      expect(await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value))).toEqual([
        1, 2, 3, 4,
      ]);
      expect(after.text).toContain("尾段");
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控粘贴后未选子项归属新根项`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo, crossLevelPasteContent());
      await select(page, "父乙", 1, "父丙", 1);
      await page.keyboard.press("ControlOrMeta+c");
      const before = await snapshot(page);
      await select(page, "父甲", 1, "子甲", 1);
      if (echo === "html") await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      if (echo === "html") {
        expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
        expect(await snapshot(page)).toEqual(before);
        await history(page, "redo");
      }
      const after = await snapshot(page);
      const items = page.locator("#paste-framework .semlo-editor-prose > ol > li");
      await expect(items).toHaveCount(5);
      expect(await items.locator("p").allTextContents()).toEqual(["父乙", "父甲", "子乙", "父乙", "父丙"]);
      expect(await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value))).toEqual([
        1, 2, 1, 3, 4,
      ]);
      expect(after.text).toContain("尾段");
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控空续接子项退格、历史及同步撤销`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
      await select(page, "甲开头", 1, "乙中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      await page.evaluate(() => navigator.clipboard.writeText("三\n四"));
      await select(page, "中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      await select(page, "中三", 0, "中三", 2);
      await page.keyboard.press("Backspace");
      await settle(page);
      const child = await snapshot(page);
      if (echo === "html") await page.evaluate(() => window.sequencePasteFramework.armUndo());
      await page.keyboard.press("Backspace");
      await settle(page);
      if (echo === "html") {
        expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
        expect(await snapshot(page)).toEqual(child);
        await history(page, "redo");
      }
      const rootItem = await snapshot(page);
      expect(
        await page
          .locator("#paste-framework ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 1, 1, 2]);
      await page.keyboard.press("Backspace");
      await settle(page);
      const paragraph = await snapshot(page);
      expect(
        await page
          .locator("#paste-framework ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 1, 2]);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(rootItem);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(child);
      await history(page, "redo");
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(paragraph);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控删除中段后前后续接及撤销`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
      await select(page, "甲开头", 1, "乙中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      await page.evaluate(() => navigator.clipboard.writeText("三\n四"));
      await select(page, "中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const before = await snapshot(page);
      await page.locator("#paste-framework .semlo-editor-prose > ol").nth(1).locator("li p").hover();
      await page.locator(".semlo-editor-block-handle:visible").click();
      await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "删除", exact: true }).click();
      await settle(page);
      const after = await snapshot(page);
      expect(await page.evaluate(() => window.sequencePasteFramework.changes.length)).toBe(3);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      await select(page, "甲一", 2);
      await page.keyboard.press("Enter");
      await settle(page);
      expect(
        await page
          .locator("#paste-framework ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 3, 1, 2]);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控拆分后的编号联动和历史`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
      await select(page, "甲开头", 1, "乙中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const split = await snapshot(page);
      await select(page, "甲一", 2);
      await page.keyboard.press("Enter");
      await settle(page);
      const after = await snapshot(page);
      expect(
        await page
          .locator("#paste-framework ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 3, 1, 2]);
      expect(await page.evaluate(() => window.sequencePasteFramework.changes.length)).toBe(2);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(split);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      await page.evaluate((html) => window.sequencePasteFramework.setContent(html), after.html);
      await settle(page);
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  test(`${framework}编号联动提交后宿主同步撤销保持一致`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await mount(page, framework, "html");
    await page.evaluate(() => navigator.clipboard.writeText("一\n二"));
    await select(page, "甲开头", 1, "乙中段", 1);
    await page.keyboard.press("ControlOrMeta+v");
    await settle(page);
    const split = await snapshot(page);
    await select(page, "甲一", 2);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.keyboard.press("Enter");
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
    expect(await snapshot(page)).toEqual(split);
    await history(page, "redo");
    expect(
      await page
        .locator("#paste-framework ol > li")
        .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
    ).toEqual([1, 1, 2, 3, 1, 2]);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
  });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控跨编号边界纯文本粘贴及撤销`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      const before = await snapshot(page);
      await page.evaluate(() => navigator.clipboard.writeText("  a. 开头\n  a. 乙中段\n  b. 丙"));
      await select(page, "甲开头", 1, "乙中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const after = await snapshot(page);
      expect(after.json.content!.map((node) => node.type)).toEqual([
        "orderedList",
        "paragraph",
        "paragraph",
        "orderedList",
        "paragraph",
      ]);
      expect(
        after.json.content![0].content!.map((item) => item.content![0].content?.map((t) => t.text).join("") ?? ""),
      ).toEqual(["父", "甲  a. 开头"]);
      expect(
        after.json.content![3].content!.map((item) => item.content![0].content?.map((t) => t.text).join("") ?? ""),
      ).toEqual(["中段", "丙结尾", "丁后续"]);
      expect(
        await page
          .locator("#paste-framework ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 2, 1, 2]);
      expect(await page.evaluate(() => window.sequencePasteFramework.changes.length)).toBe(1);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控跨编号边界粘贴保留序列和历史`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      const before = await snapshot(page);
      await copy(page);
      await select(page, "甲开头", 1, "乙中段", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const after = await snapshot(page);
      await expect(page.locator("#paste-framework ol > li p")).toHaveText([
        "父",
        "甲开头",
        "乙中段",
        "丙中段",
        "丙结尾",
        "丁后续",
      ]);
      expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
      expect(after.json.content![0].content!.map((item) => item.attrs!.semloEditorListSequence)).toEqual([
        "R",
        "A",
        "A",
        "A",
        "B",
        "B",
      ]);
      expect(await page.evaluate(() => window.sequencePasteFramework.changes.length)).toBe(1);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework} ${echo}受控多行纯文本粘贴和历史保持编号`, async ({ page }) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      const before = await snapshot(page);
      await page.evaluate(() => navigator.clipboard.writeText("  a. 开头\n\n  a. 乙中段\n  b. 丙"));
      await select(page, "丁后续", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const after = await snapshot(page);
      expect(after.json.content!.map((node) => node.type)).toEqual([
        "orderedList",
        "paragraph",
        "paragraph",
        "paragraph",
        "orderedList",
        "paragraph",
      ]);
      expect(after.json.content![1].content ?? []).toEqual([]);
      expect(after.json.content![2].content![0].text).toBe("  a. 乙中段");
      expect(after.json.content![3].content![0].text).toBe("  b. 丙");
      expect(
        await page
          .locator("#paste-framework .semlo-editor-prose > ol > li")
          .evaluateAll((items) => items.map((item) => (item as HTMLLIElement).value)),
      ).toEqual([1, 1, 1, 2, 3, 4]);
      expect(await page.evaluate(() => window.sequencePasteFramework.changes.length)).toBe(1);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    });

  for (const echo of ["json", "html"] as const)
    test(`${framework}公开包${echo}真实受控paste保持身份/单步历史，readonly与卸载重挂隔离`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await mount(page, framework, echo);
      const before = await snapshot(page);
      await copy(page);
      await select(page, "丁后续", 1);
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      const after = await snapshot(page);
      await expect(page.locator("#paste-framework ol > li p")).toHaveText([
        "父",
        "甲开头",
        "乙中段",
        "丙结尾",
        "丁开头",
        "乙中段",
        "丙后续",
      ]);
      expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
      expect(await page.evaluate(() => window.sequencePasteFramework.changes.length)).toBe(1);
      expect(await page.evaluate(() => window.sequencePasteFramework.events)).toEqual([
        { type: "copy", trusted: true },
        { type: "paste", trusted: true },
      ]);
      await history(page, "undo");
      expect(await snapshot(page)).toEqual(before);
      await history(page, "redo");
      expect(await snapshot(page)).toEqual(after);
      await page.evaluate((content) => window.sequencePasteFramework.setContent(content), after.html);
      await settle(page);
      expect(await snapshot(page)).toEqual(after);
      await select(page, "丙后续", 1, "丙后续", 2);
      await page.evaluate(() => window.sequencePasteFramework.setEditable(false));
      await settle(page);
      await expect(page.locator("#paste-framework .semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
      await page.keyboard.press("ControlOrMeta+v");
      await settle(page);
      expect(await snapshot(page)).toEqual(after);
      expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(() => {
          const fixture = window.sequencePasteFramework;
          fixture.destroy();
          return fixture.controller.editor.isDestroyed;
        }),
      ).toBe(true);
      await expect(page.locator(".semlo-editor-prose")).toHaveCount(0);
      await page.evaluate(({ framework, echo }) => window.mountSequencePasteFramework(framework, echo), {
        framework,
        echo,
      });
      await settle(page);
      expect(await snapshot(page)).toEqual(before);
      await page.evaluate(() => window.sequencePasteFramework.destroy());
    });

  test(`${framework}提交后宿主同步undo不被旧echo或粘贴后的closeHistory覆盖`, async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await mount(page, framework, "html");
    const before = await snapshot(page);
    await copy(page);
    await select(page, "丁后续", 1);
    await page.evaluate(() => window.sequencePasteFramework.armUndo());
    await page.keyboard.press("ControlOrMeta+v");
    await settle(page);
    expect(await page.evaluate(() => window.sequencePasteFramework.undoResults)).toEqual([true]);
    expect(await snapshot(page)).toEqual(before);
    await history(page, "redo");
    expect((await snapshot(page)).json.content![0].content).toHaveLength(7);
    expect((await snapshot(page)).json.content![0].attrs).toEqual(before.json.content![0].attrs);
    expect(await page.evaluate(() => window.sequencePasteFramework.errors)).toEqual([]);
    await page.evaluate(() => window.sequencePasteFramework.destroy());
  });
}
