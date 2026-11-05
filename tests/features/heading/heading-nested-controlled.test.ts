import { expect, test } from "@rstest/playwright";
import type { Editor, JSONContent } from "@tiptap/core";

import type { EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Block = {
  type: string;
  text: string;
  depth: number | null;
  level: number | null;
  numbering: string | null;
  content: JSONContent[] | undefined;
};

type Probe = {
  editor: Editor;
  echoes: Array<{ emitted: JSONContent; normalized: JSONContent }>;
  updates: JSONContent[];
  blocks(): Block[];
};

declare global {
  interface Window {
    nestedHeadingControlledProbe?: Probe;
  }
}

// The selected second-level item has children, and the selected third-level
// item has siblings on both sides. All other blocks retain their marks/depth.
const nestedList =
  "<ul><li><p>祖父</p><ul>" +
  "<li><p><em>前项</em></p></li>" +
  "<li><p>父列表</p><ul><li><p>孙一</p></li><li><p>孙二</p></li><li><p><strong>孙三</strong></p></li></ul></li>" +
  "<li><p>后项</p></li>" +
  "</ul></li><li><p>祖父同级</p></li></ul>";

const expectedTextAndDepth = [
  ["祖父", 0],
  ["前项", 1],
  ["父列表", 1],
  ["孙一", 2],
  ["孙二", 2],
  ["孙三", 2],
  ["后项", 1],
  ["祖父同级", 0],
] as const;

for (const framework of ["react", "vue", "solid"] as const) {
  for (const target of ["父列表", "孙二"] as const) {
    test(`${framework} echoes and round-trips a three-level list after converting ${target} to H3`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
      const host = page.locator(`#${framework}`);
      const prose = host.locator(".semlo-editor-prose");
      await expect(prose).toBeVisible();

      // The existing fixtures already write their real adapter onChange JSON
      // back to framework state. Seed through the editor to exercise that path.
      await page.evaluate(
        ({ name, content }) => {
          const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
          if (!element?.editor) throw new Error("Missing controlled editor");
          element.editor.commands.setContent(content);
        },
        { name: framework, content: nestedList },
      );
      await expect(prose.getByText("孙二", { exact: true })).toBeVisible();
      // Flush the seed's controlled update before observing the conversion.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );

      const before = await page.evaluate((name) => {
        const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
        const editor = element.editor;
        const echoes: Probe["echoes"] = [];
        const updates: JSONContent[] = [];
        const blocks = (): Block[] => {
          const result: Block[] = [];
          editor.state.doc.descendants((node, position) => {
            if (!node.isTextblock) return true;
            const resolved = editor.state.doc.resolve(position + 1);
            let listCount = 0;
            let itemIndent = 0;
            for (let depth = 1; depth < resolved.depth; depth += 1) {
              const ancestor = resolved.node(depth);
              if (ancestor.type.name === "bulletList" || ancestor.type.name === "orderedList") listCount += 1;
              if (ancestor.type.name === "listItem") itemIndent += Number(ancestor.attrs.semloEditorListIndent ?? 0);
            }
            result.push({
              type: node.type.name,
              text: node.textContent,
              depth: listCount ? listCount - 1 + itemIndent : null,
              level: node.type.name === "heading" ? Number(node.attrs.level) : null,
              numbering: node.type.name === "heading" ? (node.attrs.semloEditorHeadingNumbering ?? null) : null,
              content: node.toJSON().content as JSONContent[] | undefined,
            });
            return false;
          });
          return result;
        };
        window.nestedHeadingControlledProbe = { editor, echoes, updates, blocks };

        // A document-level JSON parse is observable when the adapter supplies
        // its onChange value back as a controlled `content` prop. This also
        // works for Vue proxies without exposing private framework state.
        const schema = editor.schema;
        const nodeFromJSON = schema.nodeFromJSON;
        schema.nodeFromJSON = (value) => {
          const parsed = nodeFromJSON.call(schema, value);
          if (value?.type === "doc")
            echoes.push({ emitted: JSON.parse(JSON.stringify(value)) as JSONContent, normalized: parsed.toJSON() });
          return parsed;
        };
        editor.on("update", () => updates.push(editor.getJSON()));
        return blocks();
      }, framework);
      expect(before.map(({ text, depth }) => [text, depth])).toEqual(expectedTextAndDepth);

      await page.evaluate((selected) => {
        const editor = window.__semloRequireFixture("nestedHeadingControlledProbe").editor;
        let caret: number | undefined;
        editor.state.doc.descendants((node, position) => {
          if (node.isTextblock && node.textContent === selected) caret = position + node.nodeSize - 1;
        });
        if (caret === undefined) throw new Error("Missing selected list item");
        editor.view.focus();
        editor.commands.setTextSelection(caret);
      }, target);
      await host.getByRole("button", { name: "段落样式" }).click();
      await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();

      const converted = await page.evaluate(() => {
        const probe = window.__semloRequireFixture("nestedHeadingControlledProbe");
        const { selection } = probe.editor.state;
        return {
          json: probe.editor.getJSON(),
          blocks: probe.blocks(),
          selection: { type: selection.$from.parent.type.name, offset: selection.$from.parentOffset },
        };
      });
      expect(converted.blocks.map(({ text }) => text)).toEqual(before.map(({ text }) => text));
      expect(converted.blocks.find(({ text }) => text === target)).toMatchObject({
        type: "heading",
        depth: null,
        level: 3,
        numbering: "mixed",
      });
      expect(converted.blocks.filter(({ text }) => text !== target)).toEqual(
        before.filter(({ text }) => text !== target),
      );
      expect(converted.selection).toEqual({ type: "heading", offset: target.length });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__semloRequireFixture("nestedHeadingControlledProbe").echoes.at(-1)?.normalized ?? null,
          ),
        )
        .toEqual(converted.json);

      // Equivalent controlled feedback must not reset the selection or cause
      // another document update; ordinary typing must still reach host state.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      const afterEcho = await page.evaluate(() => {
        const probe = window.__semloRequireFixture("nestedHeadingControlledProbe");
        const { selection } = probe.editor.state;
        return {
          updates: probe.updates,
          selection: { type: selection.$from.parent.type.name, offset: selection.$from.parentOffset },
        };
      });
      expect(afterEcho.updates).toEqual([converted.json]);
      expect(afterEcho.selection).toEqual(converted.selection);
      await page.keyboard.insertText("续");
      await expect(prose.locator("h3")).toContainText(`${target}续`);
      const edited = await page.evaluate(() =>
        window.__semloRequireFixture("nestedHeadingControlledProbe").editor.getJSON(),
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__semloRequireFixture("nestedHeadingControlledProbe").echoes.at(-1)?.normalized ?? null,
          ),
        )
        .toEqual(edited);
      expect(await page.evaluate(() => window.__semloRequireFixture("nestedHeadingControlledProbe").updates)).toEqual([
        converted.json,
        edited,
      ]);
      const publicJSON = await page.evaluate(
        () => window.__semloRequireFixture("nestedHeadingControlledProbe").echoes.at(-1)?.emitted,
      );
      if (!publicJSON) throw new Error("Missing controlled echo");

      // Rehydrate the actual converted JSON through the same framework's
      // dynamic content prop. Its controller produces the public export HTML.
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
      expect(baseline.html).toContain("data-semlo-editor-heading-marker");
      for (const format of ["html", "json"] as const) {
        const restored: EditorSnapshot = await page.evaluate(async (content) => {
          const fixture = window.__semloRequireFixture("dynamicEditor");
          fixture.setIntegrations({ content: "<p>临时内容</p>" });
          await fixture.settle();
          if (!fixture.controller.getSnapshot().text.includes("临时内容")) throw new Error("Replacement failed");
          fixture.setIntegrations({ content });
          await fixture.settle();
          return fixture.controller.getSnapshot();
        }, baseline[format]);
        expect(restored.json).toEqual(publicJSON);
        expect(restored.text).toBe(baseline.text);
      }
      expect(await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").errors)).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
    });
  }
}
