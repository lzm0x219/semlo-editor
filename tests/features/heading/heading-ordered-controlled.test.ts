import { expect, test } from "@rstest/playwright";
import type { Editor, JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    orderedControlledProbe?: {
      editor: Editor;
      echoes: Array<{ emitted: JSONContent; normalized: JSONContent }>;
      updates: JSONContent[];
    };
  }
}

const content =
  '<ol><li><p>甲甲</p></li><li data-semlo-editor-list-indent="1"><p>乙乙</p></li><li><p>丙丙</p></li><li data-semlo-editor-list-indent="1"><p>丁丁</p></li><li><p>戊戊</p></li></ol><p>尾段</p>';

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controlled content preserves a split list's level starts and selection`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    const host = page.locator(`#${framework}`);
    const prose = host.locator(".semlo-editor-prose");
    await expect(prose).toBeVisible();
    await page.evaluate(
      ({ name, html }) => {
        const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
        if (!element?.editor) throw new Error("Missing controlled editor");
        element.editor.commands.setContent(html);
      },
      { name: framework, html: content },
    );
    await expect(prose.getByText("戊戊", { exact: true })).toBeVisible();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    const before = await page.evaluate((name) => {
      const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
      const editor = element.editor;
      const echoes: Array<{ emitted: JSONContent; normalized: JSONContent }> = [];
      const updates: JSONContent[] = [];
      window.orderedControlledProbe = { editor, echoes, updates };
      const schema = editor.schema;
      const parse = schema.nodeFromJSON;
      schema.nodeFromJSON = (value) => {
        const parsed = parse.call(schema, value);
        if (value?.type === "doc") {
          echoes.push({ emitted: JSON.parse(JSON.stringify(value)) as JSONContent, normalized: parsed.toJSON() });
        }
        return parsed;
      };
      editor.on("update", () => updates.push(editor.getJSON()));
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "丙丙") position = pos + 3;
      });
      if (position < 0) throw new Error("Missing selected item");
      editor.view.focus();
      editor.commands.setTextSelection(position);
      return editor.getJSON();
    }, framework);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const converted = await page.evaluate(() => {
      const { editor } = window.__semloRequireFixture("orderedControlledProbe");
      const { $anchor } = editor.state.selection;
      return { json: editor.getJSON(), selection: { text: $anchor.parent.textContent, offset: $anchor.parentOffset } };
    });
    const suffix = converted.json.content?.find(
      (node) => node.type === "orderedList" && JSON.stringify(node.content).includes("丁丁"),
    );
    expect(suffix?.attrs).toMatchObject({ start: 2, semloEditorListLevelStarts: { "0": 2 } });
    expect(converted.selection).toEqual({ text: "丙丙", offset: 2 });
    await expect
      .poll(() =>
        page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").echoes.at(-1)?.normalized ?? null),
      )
      .toEqual(converted.json);
    const emitted = await page.evaluate(
      () => window.__semloRequireFixture("orderedControlledProbe").echoes.at(-1)?.emitted,
    );
    const emittedSuffix = emitted?.content?.find(
      (node) => node.type === "orderedList" && JSON.stringify(node.content).includes("丁丁"),
    );
    expect(emittedSuffix?.attrs).toMatchObject({ start: 2, semloEditorListLevelStarts: { "0": 2 } });
    for (const node of emitted?.content ?? []) {
      if (node.type === "orderedList" && node !== emittedSuffix)
        expect(Object.hasOwn(node.attrs ?? {}, "semloEditorListLevelStarts")).toBe(false);
    }
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").updates)).toEqual([
      converted.json,
    ]);
    expect(
      await page.evaluate(() => {
        const { $anchor } = window.__semloRequireFixture("orderedControlledProbe").editor.state.selection;
        return { text: $anchor.parent.textContent, offset: $anchor.parentOffset };
      }),
    ).toEqual(converted.selection);
    const markerInfo = async (text: string) =>
      prose.getByText(text, { exact: true }).evaluate((node) => {
        const item = node.closest("li")!;
        return { value: item.getAttribute("value"), style: getComputedStyle(item).listStyleType };
      });
    expect(await markerInfo("丁丁")).toEqual({ value: "2", style: "lower-alpha" });
    expect(await markerInfo("戊戊")).toEqual({ value: "2", style: "decimal" });
    await page.keyboard.insertText("续");
    await expect(prose.locator("h3")).toContainText("丙丙续");
    const edited = await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.getJSON());
    await expect
      .poll(() =>
        page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").echoes.at(-1)?.normalized ?? null),
      )
      .toEqual(edited);
    expect(await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").updates)).toEqual([
      converted.json,
      edited,
    ]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.getJSON())).toEqual(
      converted.json,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.commands.undo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.getJSON())).toEqual(
      before,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.commands.redo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.getJSON())).toEqual(
      converted.json,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.commands.redo()),
    ).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("orderedControlledProbe").editor.getJSON())).toEqual(
      edited,
    );
    expect(errors).toEqual([]);
  });
}
