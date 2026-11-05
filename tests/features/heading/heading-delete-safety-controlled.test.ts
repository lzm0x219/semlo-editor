import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-delete-controlled-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/heading/heading-delete-controlled-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());

// These cases protect against deleting unrelated content; their exact behavior
// has not been compared with Yuque.
type SafetyCase = {
  name: string;
  heading: string;
  next: string;
  headingMarks?: readonly string[];
  nextType: string;
  nextMarks?: readonly string[];
  numbered?: boolean;
};
const cases: SafetyCase[] = [
  {
    name: "bold and italic heading",
    heading: "<h3><strong><em>test</em></strong></h3>",
    next: "<p>next</p>",
    headingMarks: ["bold", "italic"],
    nextType: "paragraph",
  },
  {
    name: "underlined heading",
    heading: "<h3><u>test</u></h3>",
    next: "<p>next</p>",
    headingMarks: ["underline"],
    nextType: "paragraph",
  },
  {
    name: "numbered bold heading",
    heading: '<h3 data-semlo-editor-heading-numbering="mixed"><strong>test</strong></h3>',
    next: "<p>next</p>",
    headingMarks: ["bold"],
    numbered: true,
    nextType: "paragraph",
  },
  {
    name: "numbered italic heading",
    heading: '<h3 data-semlo-editor-heading-numbering="mixed"><em>test</em></h3>',
    next: "<p>next</p>",
    headingMarks: ["italic"],
    numbered: true,
    nextType: "paragraph",
  },
  {
    name: "numbered underlined heading",
    heading: '<h3 data-semlo-editor-heading-numbering="mixed"><u>test</u></h3>',
    next: "<p>next</p>",
    headingMarks: ["underline"],
    numbered: true,
    nextType: "paragraph",
  },
  {
    name: "numbered bold italic heading",
    heading: '<h3 data-semlo-editor-heading-numbering="mixed"><strong><em>test</em></strong></h3>',
    next: "<p>next</p>",
    headingMarks: ["bold", "italic"],
    numbered: true,
    nextType: "paragraph",
  },
  {
    name: "following bold paragraph",
    heading: "<h3>test</h3>",
    next: "<p><strong>next</strong></p>",
    nextType: "paragraph",
    nextMarks: ["bold"],
  },
  {
    name: "following italic paragraph",
    heading: "<h3>test</h3>",
    next: "<p><em>next</em></p>",
    nextType: "paragraph",
    nextMarks: ["italic"],
  },
  {
    name: "following mixed-format paragraph",
    heading: "<h3>test</h3>",
    next: "<p>ne<strong>x</strong><em>t</em></p>",
    nextType: "paragraph",
    nextMarks: ["bold", "italic"],
  },
  { name: "following heading", heading: "<h3>test</h3>", next: "<h4>next</h4>", nextType: "heading" },
  {
    name: "following unordered list",
    heading: "<h3>test</h3>",
    next: "<ul><li><p>next</p></li><li><p>more</p></li></ul>",
    nextType: "bulletList",
  },
  {
    name: "following ordered list",
    heading: "<h3>test</h3>",
    next: '<ol start="7"><li><p>next</p></li><li><p>more</p></li></ol>',
    nextType: "orderedList",
  },
  {
    name: "following code block",
    heading: "<h3>test</h3>",
    next: '<pre><code class="language-javascript">next();\nmore();</code></pre>',
    nextType: "codeBlock",
  },
];

async function mount(page: Page, framework: RestartFramework, html: string) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), html);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  await page.evaluate(() => window.__semloRequireFixture("closeHeadingDeleteHistory")());
}

async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const selection = editor.state.selection;
    const native = window.getSelection();
    const fragment = native?.rangeCount ? native.getRangeAt(0).cloneContents() : null;
    fragment
      ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
      .forEach((node) => node.remove());
    return {
      snapshot: fixture.controller.getSnapshot(),
      selection: {
        empty: selection.empty,
        anchorType: selection.$anchor.parent.type.name,
        anchorText: selection.$anchor.parent.textContent,
        anchorOffset: selection.$anchor.parentOffset,
        headType: selection.$head.parent.type.name,
        headText: selection.$head.parent.textContent,
        headOffset: selection.$head.parentOffset,
      },
      domSelection: { empty: native?.isCollapsed ?? true, text: fragment?.textContent ?? "" },
      focused: editor.view.hasFocus(),
      changes: fixture.changes,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
    };
  });
}

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const item of cases) {
    test(`${framework}: safety expectation, ${item.name} preserves following content`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await mount(page, framework, item.heading + item.next);
      const before = await read(page);
      expect(before.changes).toHaveLength(0);
      const expected = structuredClone(before.snapshot.json);
      const headingNode = expected.content?.[0];
      expect(headingNode).toMatchObject({ type: "heading", attrs: { level: 3 } });
      expect(headingNode?.content?.map((node) => node.text).join("")).toBe("test");
      expect(expected.content?.length).toBeGreaterThan(1);
      const headingMarks = headingNode?.content?.flatMap((node) => node.marks?.map((mark) => mark.type) ?? []) ?? [];
      expect(headingMarks).toEqual(expect.arrayContaining([...(item.headingMarks ?? [])]));
      if (item.numbered) expect(headingNode?.attrs?.semloEditorHeadingNumbering).toBe("mixed");
      const following = expected.content?.[1];
      expect(following?.type).toBe(item.nextType);
      const followingMarks = following?.content?.flatMap((node) => node.marks?.map((mark) => mark.type) ?? []) ?? [];
      expect(followingMarks).toEqual(expect.arrayContaining([...(item.nextMarks ?? [])]));
      if (item.nextType === "bulletList" || item.nextType === "orderedList") expect(following?.content).toHaveLength(2);
      if (item.nextType === "codeBlock")
        expect(following?.content?.map((node) => node.text).join("")).toBe("next();\nmore();");
      delete headingNode!.content;
      const heading = page.locator("#restart-controlled-fixture .semlo-editor-prose > h3");
      await heading.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const removed = await read(page);
      expect(removed.snapshot.json).toEqual(expected);
      expect(removed.changes).toHaveLength(1);
      expect(removed.changes[0].json).toEqual(expected);
      expect(removed.changes[0].html).toEqual(removed.snapshot.html);
      expect(removed.documentChanges - before.documentChanges).toBe(1);
      expect(removed.focused).toBe(true);
      expect(removed.selection).toMatchObject({
        empty: true,
        anchorType: "heading",
        anchorText: "",
        anchorOffset: 0,
        headType: "heading",
        headText: "",
        headOffset: 0,
      });
      expect(removed.domSelection.empty).toBe(true);
      await expect(heading).toHaveCount(1);

      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await read(page);
      expect(undone.snapshot.json).toEqual(before.snapshot.json);
      expect(undone.selection).toMatchObject({
        empty: false,
        anchorType: "heading",
        anchorText: "test",
        anchorOffset: 0,
        headType: "heading",
        headText: "test",
        headOffset: 4,
      });
      expect(undone.domSelection).toEqual({ empty: false, text: "test" });
      expect(undone.focused).toBe(true);
      expect(undone.changes).toHaveLength(2);
      expect(undone.changes[1].json).toEqual(before.snapshot.json);
      expect(undone.documentChanges - before.documentChanges).toBe(2);

      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(expected);
      expect(redone.selection).toEqual(removed.selection);
      expect(redone.focused).toBe(true);
      expect(redone.changes).toHaveLength(3);
      expect(redone.changes[2].json).toEqual(expected);
      expect(redone.documentChanges - before.documentChanges).toBe(3);

      for (const saved of [removed.snapshot.json, removed.snapshot.html]) {
        await page.evaluate(() =>
          window.__semloRequireFixture("restartControlledFixture").setContent("<p>临时替换</p>"),
        );
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        await page.evaluate(
          (value) => window.__semloRequireFixture("restartControlledFixture").setContent(value),
          saved,
        );
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        const restored = await read(page);
        expect(restored.snapshot.json).toEqual(expected);
        expect(restored.changes).toHaveLength(3);
      }
      expect((await read(page)).errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
}
