import { expect, test, type Page } from "@rstest/playwright";
import type { Editor, JSONContent } from "@tiptap/core";

import type { EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Probe = {
  editor: Editor;
  echoes: Array<{ emitted: JSONContent; normalized: JSONContent }>;
  updates: JSONContent[];
};

declare global {
  interface Window {
    listParagraphControlledProbe?: Probe;
  }
}

const paragraph = (text: string, mark?: "bold" | "italic"): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(mark ? { marks: [{ type: mark }] } : {}) }],
});
const item = (text: string, indent: number, mark?: "bold" | "italic"): JSONContent => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text, mark)],
});
const content: JSONContent = {
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { start: 1, semloEditorOrderedStyle: "decimal" },
      content: [item("乙", 0, "bold"), item("丙", 1, "italic"), item("丁", 0), item("戊", 0)],
    },
    paragraph("末尾"),
  ],
};

async function settle(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const probe = window.listParagraphControlledProbe;
    if (!probe) throw new Error("Missing controlled probe");
    const { editor } = probe;
    const { selection } = editor.state;
    const browser = document.getSelection();
    return {
      json: editor.getJSON() as JSONContent,
      selection: {
        anchor: selection.anchor,
        head: selection.head,
        parent: selection.$from.parent.textContent,
        offset: selection.$from.parentOffset,
        collapsed: browser?.isCollapsed ?? false,
      },
      focused: editor.view.hasFocus(),
    };
  });
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controlled echo preserves a flat parent-to-paragraph conversion`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    const host = page.locator(`#${framework}`);
    const prose = host.locator(".semlo-editor-prose");
    await expect(prose).toBeVisible();
    await page.evaluate(
      ({ framework, content }) => {
        const element = document.querySelector(`#${framework} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
        if (!element?.editor) throw new Error("Missing controlled editor");
        element.editor.commands.setContent(content);
      },
      { framework, content },
    );
    await expect(prose.getByText("戊", { exact: true })).toBeVisible();
    await settle(page);
    await page.evaluate((name) => {
      const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
      if (!element?.editor) throw new Error("Missing controlled editor");
      const editor = element.editor;
      const echoes: Probe["echoes"] = [];
      const updates: JSONContent[] = [];
      window.listParagraphControlledProbe = { editor, echoes, updates };
      const schema = editor.schema;
      const parse = schema.nodeFromJSON;
      schema.nodeFromJSON = (value) => {
        const parsed = parse.call(schema, value);
        if (value?.type === "doc")
          echoes.push({ emitted: JSON.parse(JSON.stringify(value)) as JSONContent, normalized: parsed.toJSON() });
        return parsed;
      };
      editor.on("update", () => updates.push(editor.getJSON()));
    }, framework);
    const before = await inspect(page);
    await prose.getByText("乙", { exact: true }).hover();
    const handle = page.locator(".semlo-editor-block-handle:visible");
    await handle.waitFor({ state: "visible" });
    await handle.click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();

    const converted = await inspect(page);
    const nodes = converted.json.content ?? [];
    expect(nodes.map((node) => node.type)).toEqual(["paragraph", "paragraph", "orderedList", "paragraph"]);
    expect(nodes[0].content?.[0].text).toBe("乙");
    expect(nodes[0].content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(nodes[1].content?.[0].text).toBe("丙");
    expect(nodes[1].content?.[0].marks).toEqual([{ type: "italic" }]);
    expect(nodes[0].attrs?.semloEditorIndent).toBe(0);
    expect(nodes[1].attrs?.semloEditorIndent).toBe(1);
    expect(nodes[2].attrs?.start).toBe(1);
    expect(nodes[2].content?.map((node) => node.content?.[0].content?.[0].text)).toEqual(["丁", "戊"]);
    const markers = () =>
      prose.locator(":scope > ol > li").evaluateAll((items) =>
        items.map((element) => ({
          text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
          marker: getComputedStyle(element).listStyleType,
        })),
      );
    expect(await markers()).toEqual([
      { text: "丁", marker: '"1. "' },
      { text: "戊", marker: '"2. "' },
    ]);
    expect(converted.focused).toBe(true);
    expect(converted.selection).toMatchObject({ parent: "乙", offset: 0, collapsed: true });
    expect(converted.selection.anchor).toBe(converted.selection.head);
    await expect
      .poll(() => page.evaluate(() => window.listParagraphControlledProbe?.echoes.at(-1)?.normalized ?? null))
      .toEqual(converted.json);
    await settle(page);
    const afterEcho = await inspect(page);
    expect(afterEcho.json).toEqual(converted.json);
    expect(afterEcho.selection).toEqual(converted.selection);
    expect(afterEcho.focused).toBe(true);
    expect(await page.evaluate(() => window.listParagraphControlledProbe?.updates)).toEqual([converted.json]);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => inspect(page).then((value) => value.json)).toEqual(before.json);
    await expect
      .poll(() => page.evaluate(() => window.listParagraphControlledProbe?.echoes.at(-1)?.normalized ?? null))
      .toEqual(before.json);
    await settle(page);
    expect((await inspect(page)).focused).toBe(true);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => inspect(page).then((value) => value.json)).toEqual(converted.json);
    await expect
      .poll(() => page.evaluate(() => window.listParagraphControlledProbe?.echoes.at(-1)?.normalized ?? null))
      .toEqual(converted.json);
    await settle(page);
    expect(await page.evaluate(() => window.listParagraphControlledProbe?.updates)).toEqual([
      converted.json,
      before.json,
      converted.json,
    ]);

    const publicJSON = await page.evaluate(() => window.listParagraphControlledProbe?.echoes.at(-1)?.emitted);
    if (!publicJSON) throw new Error("Missing controlled echo");
    const baseline = await page.evaluate(
      async ({ name, json }) => {
        await window.__semloRequireFixture("mountDynamicEditor")(name);
        const fixture = window.__semloRequireFixture("dynamicEditor");
        fixture.setIntegrations({ content: json });
        await fixture.settle();
        return fixture.controller.getSnapshot();
      },
      { name: framework, json: publicJSON },
    );
    expect(baseline.json).toEqual(publicJSON);
    expect(baseline.html).toContain('data-semlo-editor-indent="1"');
    expect(baseline.html).toContain("<strong>乙</strong>");
    expect(baseline.html).toContain("<em>丙</em>");
    for (const format of ["html", "json"] as const) {
      const restored: EditorSnapshot = await page.evaluate(async (value) => {
        const fixture = window.__semloRequireFixture("dynamicEditor");
        fixture.setIntegrations({ content: "<p>临时内容</p>" });
        await fixture.settle();
        if (!fixture.controller.getSnapshot().text.includes("临时内容")) throw new Error("Replacement failed");
        fixture.setIntegrations({ content: value });
        await fixture.settle();
        return fixture.controller.getSnapshot();
      }, baseline[format]);
      expect(restored.json).toEqual(baseline.json);
      expect(restored.text).toBe(baseline.text);
    }
    expect(await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());

    const unsupported = structuredClone(content);
    const child = unsupported.content?.[0].content?.[1].content?.[0];
    if (!child) throw new Error("Missing child paragraph");
    child.attrs = { ...child.attrs, semloEditorIndent: 1 };
    await page.evaluate((value) => {
      const probe = window.listParagraphControlledProbe;
      if (!probe) throw new Error("Missing controlled probe");
      probe.editor.commands.setContent(value);
    }, unsupported);
    await settle(page);
    await page.evaluate(() => {
      const probe = window.listParagraphControlledProbe;
      if (!probe) throw new Error("Missing controlled probe");
      const editor = probe.editor;
      let start = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "戊") start = pos + 1;
      });
      if (start < 0) throw new Error("Missing unselected item");
      editor.view.focus();
      editor.commands.setTextSelection({ from: start + 1, to: start });
    });
    const beforeFailure = await inspect(page);
    expect(beforeFailure.selection.anchor).toBeGreaterThan(beforeFailure.selection.head);
    const updateCount = await page.evaluate(() => window.listParagraphControlledProbe?.updates.length);
    await prose.getByText("乙", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "正文", exact: true }).click();
    await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法无损转换");
    await settle(page);
    const afterFailure = await inspect(page);
    expect(afterFailure.json).toEqual(beforeFailure.json);
    expect(afterFailure.selection).toEqual(beforeFailure.selection);
    expect(await page.evaluate(() => window.listParagraphControlledProbe?.updates.length)).toBe(updateCount);
    expect(pageErrors).toEqual([]);
  });
}
