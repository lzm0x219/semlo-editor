import { expect, test, type Page } from "@rstest/playwright";
import type { MarkType, Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import type { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import type { Step } from "@tiptap/pm/transform";

import type { CodeIndentResult } from "../../../packages/core/src/features/code-block/keyboard";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    cooperativeEditor?: EditorController;
    cooperativeSecond?: EditorController;
    cooperativeStart?: (editor: EditorController) => Promise<CodeIndentResult>;
    cooperativeStartAt?: (editor: EditorController, position: number) => Promise<CodeIndentResult>;
    cooperativeIsPending?: (editor: EditorController) => boolean;
    cooperativeReference?: (text: string, language: string, mode: "space" | "tab", width: number) => string;
    cooperativeReferenceJSON?: (editor: EditorController, pos: number) => unknown;
    cooperativeApplyReference?: (editor: EditorController, pos: number) => void;
    cooperativeReferenceMappings?: (
      editor: EditorController,
      pos: number,
    ) => Array<{
      position: number;
      assoc: number;
      mapped: number;
      deleted: boolean;
      deletedBefore: boolean;
      deletedAfter: boolean;
      deletedAcross: boolean;
    }>;
    cooperativeCompareRebases?: (editor: EditorController, grouped: Step, pos: number, count: number) => unknown[];
    cooperativeAttachDecoration?: (editor: EditorController, from: number, to: number) => void;
    cooperativeDecorations?: (editor: EditorController) => Array<{ from: number; to: number }>;
    cooperativeRestoreStep?: (schema: Schema, json: unknown) => Step;
    cooperativeStartStuck?: (editor: EditorController) => Promise<CodeIndentResult>;
    cooperativeShowProgress?: (message: string) => () => void;
    cooperativeRestoreAutolink?: (editor: EditorController) => void;
    cooperativePlugin?: typeof Plugin;
    cooperativePluginKey?: typeof PluginKey;
    cooperativeRestoreCodeMarks?: () => void;
    cooperativeCanSkipAutolink?: (transaction: Transaction, link: MarkType) => boolean;
    cooperativeLinkConfiguration?: (
      allow: boolean,
      enabled: boolean,
    ) => { href: string | null; calls: number; openOnClick: boolean };
    cooperativeUndoDepth?: (editor: EditorController) => number;
    cooperativeLastStep?: Step;
    cooperativeBeforeDoc?: ProseMirrorNode;
    cooperativePending?: Promise<CodeIndentResult>;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, createStarterKitWithCodeFonts, Editor, autoIndentCodeBlock, isAutoIndentPending, referenceCodeIndent, referenceCodeIndentJSON, applyReferenceCodeIndent, referenceCodeIndentMappings, compareCodeIndentRebases, attachCodeIndentDecoration, codeIndentDecorations, codeIndentUndoDepth, showCodeProgress, Step, Plugin, PluginKey, restoreOriginalAutolink, canSkipCodeIndentAutolink } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'cooperative-editor'
      document.body.append(host)
      window.cooperativeEditor = createEditor({ element: host, outline: false, content: '<pre><code>one</code></pre>' })
      window.cooperativeStart = editor => autoIndentCodeBlock(editor.editor.view, 0)
      window.cooperativeStartAt = (editor, position) => autoIndentCodeBlock(editor.editor.view, position)
      window.cooperativeIsPending = editor => isAutoIndentPending(editor.editor.view)
      window.cooperativeReference = referenceCodeIndent
      window.cooperativeReferenceJSON = referenceCodeIndentJSON
      window.cooperativeApplyReference = applyReferenceCodeIndent
      window.cooperativeReferenceMappings = referenceCodeIndentMappings
      window.cooperativeCompareRebases = compareCodeIndentRebases
      window.cooperativeAttachDecoration = attachCodeIndentDecoration
      window.cooperativeDecorations = codeIndentDecorations
      window.cooperativeRestoreStep = (schema, json) => Step.fromJSON(schema, json)
      window.cooperativeUndoDepth = codeIndentUndoDepth
      window.cooperativeShowProgress = message => showCodeProgress(document, message)
      window.cooperativeRestoreAutolink = restoreOriginalAutolink
      window.cooperativePlugin = Plugin
      window.cooperativePluginKey = PluginKey
      window.cooperativeCanSkipAutolink = canSkipCodeIndentAutolink
      window.cooperativeLinkConfiguration = (allow, enabled) => {
        let calls = 0
        const element = document.createElement('div')
        document.body.append(element)
        const editor = new Editor({
          element,
          content: '<p>example.com</p>',
          extensions: [createStarterKitWithCodeFonts([]).configure({
            link: { autolink: enabled, openOnClick: false, shouldAutoLink: () => { calls++; return allow } },
          })],
        })
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' ')
        const href = element.querySelector('a')?.getAttribute('href') ?? null
        const openOnClick = editor.extensionManager.extensions.find(extension => extension.name === 'link').options.openOnClick
        editor.destroy()
        element.remove()
        return { href, calls, openOnClick }
      }
      window.cooperativeStartStuck = editor => {
        let clock = 0
        return autoIndentCodeBlock(editor.editor.view, 0, {
          ensureTree: () => { clock += 10; return null },
          now: () => clock,
          parseTimeoutMs: 25,
        })
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.cooperativeEditor && window.cooperativeStart));
  return page.locator("#cooperative-editor");
}

async function setCode(
  page: Page,
  text: string,
  language: string,
  mode: "space" | "tab" = "space",
  width: 2 | 4 | 8 = 2,
) {
  await page.evaluate(
    ({ text, language, mode, width }) => {
      const editor = window.__semloRequireFixture("cooperativeEditor").editor;
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language, indentMode: mode, indentWidth: width },
            content: text ? [{ type: "text", text }] : [],
          },
        ],
      });
      editor.commands.focus();
      editor.commands.setTextSelection(1);
    },
    { text, language, mode, width },
  );
}

const csharp = "class C {\nvoid Run() {\nif (ok) {\nCall();\n}\n}\n}\n".repeat(430);

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("code URLs and existing link marks match the original autolink plugin", async ({ page }) => {
  await mount(page);
  const samples = [
    "if (x) {\nhttps://example.com\nrun();\n}",
    "if (x) {\nrun(); // https://example.com\nrun();\n}",
    "if (x) {\n  visit('https://example.com')\nrun();\n}",
    "if (x) {\n  https://example.com\n  run();\n}\nnext()",
  ];
  const collect = async () => {
    const result: unknown[] = [];
    for (const text of samples) {
      await setCode(page, text, "javascript");
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
      );
      result.push(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.getJSON()));
    }
    for (const existingLink of [false, true]) {
      await setCode(page, "if (x) {\nhttps://example.com\nrun();\n}", "javascript");
      await page.evaluate((existingLink) => {
        const editor = window.__semloRequireFixture("cooperativeEditor").editor;
        // Simulate a host-supplied code node schema that permits link marks.
        const code = editor.schema.nodes.codeBlock as typeof editor.schema.nodes.codeBlock & { markSet: unknown };
        const previous = code.markSet;
        code.markSet = null;
        window.cooperativeRestoreCodeMarks = () => {
          code.markSet = previous;
        };
        if (existingLink) {
          const from = editor.state.doc.textContent.indexOf("https://") + 1;
          editor.view.dispatch(
            editor.state.tr.addMark(
              from,
              from + "https://example.com".length,
              editor.schema.marks.link.create({ href: "https://example.com" }),
            ),
          );
        }
      }, existingLink);
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
      );
      result.push(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.getJSON()));
      await page.evaluate(() => window.__semloRequireFixture("cooperativeRestoreCodeMarks")());
    }
    return result;
  };
  const wrapped = await collect();
  await page.evaluate(() =>
    window.__semloRequireFixture("cooperativeRestoreAutolink")(window.__semloRequireFixture("cooperativeEditor")),
  );
  const original = await collect();
  expect(wrapped).toEqual(original);
  expect(JSON.stringify(wrapped.at(-1))).toContain('"type":"link"');
  expect(JSON.stringify(wrapped.at(-1))).toContain("https://example.com");
});

test("autolink retains appended prose changes on both sides of its plugin", async ({ page }) => {
  for (const before of [true, false]) {
    for (const original of [false, true]) {
      await mount(page);
      await page.evaluate(
        ({ before, original }) => {
          const controller = window.__semloRequireFixture("cooperativeEditor");
          const editor = controller.editor;
          editor.commands.setContent({
            type: "doc",
            content: [
              {
                type: "codeBlock",
                attrs: { language: "javascript" },
                content: [{ type: "text", text: "if (x) {\nrun();\n}" }],
              },
              { type: "paragraph", content: [{ type: "text", text: "example.com" }] },
            ],
          });
          if (original) window.__semloRequireFixture("cooperativeRestoreAutolink")(controller);
          const plugin = new (window.__semloRequireFixture("cooperativePlugin"))({
            key: new (window.__semloRequireFixture("cooperativePluginKey"))("semlo-editor-autolink-host-probe"),
            appendTransaction(transactions, _oldState, newState) {
              if (
                !transactions.some((tr) =>
                  tr.steps.some((step) => step.toJSON().stepType === "semloEditorCodeIndentV1"),
                )
              )
                return null;
              return newState.tr.insertText(" ", newState.doc.content.size - 1);
            },
          });
          editor.registerPlugin(plugin, (next, plugins) => {
            const index = plugins.findIndex((item) => (item as Plugin & { key: string }).key.startsWith("autolink$"));
            if (index < 0) throw new Error("Missing autolink");
            const at = index + (before ? 0 : 1);
            return [...plugins.slice(0, at), next, ...plugins.slice(at)];
          });
          editor.commands.focus();
          editor.commands.setTextSelection(1);
        },
        { before, original },
      );
      expect(
        await page.evaluate(() =>
          window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
        ),
      ).toBe("success");
      const paragraph = page.locator("#cooperative-editor .ProseMirror p");
      await expect(paragraph).toHaveText("example.com ");
      await expect(paragraph.locator("a")).toHaveAttribute("href", "http://example.com");
    }
  }
});

test("serialized steps cannot skip autolink for prose or non-whitespace edits", async ({ page }) => {
  await mount(page);
  const choices = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cooperativeEditor").editor;
    const results: boolean[] = [];
    const testStep = (type: "codeBlock" | "paragraph", input: string, insert: string) => {
      editor.commands.setContent({ type: "doc", content: [{ type, content: [{ type: "text", text: input }] }] });
      const at = input.length + 1;
      const step = window.__semloRequireFixture("cooperativeRestoreStep")(editor.schema, {
        stepType: "semloEditorCodeIndentV1",
        edits: [{ from: at, to: at, slice: { content: [{ type: "text", text: insert }] } }],
      });
      const tr = editor.state.tr.step(step);
      results.push(window.__semloRequireFixture("cooperativeCanSkipAutolink")(tr, editor.schema.marks.link));
      return tr;
    };
    testStep("codeBlock", "run();", " ");
    testStep("codeBlock", "run();", "x");
    const prose = testStep("paragraph", "example.com", " ");
    editor.view.dispatch(prose);
    return { results, linked: Boolean(editor.view.dom.querySelector('p a[href="http://example.com"]')) };
  });
  expect(choices.results).toEqual([true, false, false]);
  expect(choices.linked).toBe(true);
});

test("the existing link extension keeps configured autolink and validation options", async ({ page }) => {
  await mount(page);
  const [allowed, rejected, disabled] = await page.evaluate(() => [
    window.__semloRequireDefined("cooperativeLinkConfiguration")(true, true),
    window.__semloRequireDefined("cooperativeLinkConfiguration")(false, true),
    window.__semloRequireDefined("cooperativeLinkConfiguration")(true, false),
  ]);
  expect(allowed).toMatchObject({ href: "http://example.com", openOnClick: false });
  expect(allowed.calls).toBeGreaterThan(0);
  expect(rejected).toMatchObject({ href: null, openOnClick: false });
  expect(rejected.calls).toBeGreaterThan(0);
  expect(disabled).toEqual({ href: null, calls: 0, openOnClick: false });
});

test("the multi-range step maps every document position like the original individual edits", async ({ page }) => {
  await mount(page);
  const original = "function f(){\n    first();\n \n\tif(y){\nrun();\n }\n}";
  await setCode(page, original, "javascript", "space", 2);
  const expected = await page.evaluate(() =>
    window.__semloRequireFixture("cooperativeReferenceMappings")(window.__semloRequireFixture("cooperativeEditor"), 0),
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cooperativeEditor").editor;
    editor.on("transaction", ({ transaction }) => {
      const step = transaction.steps.find((candidate) => candidate.toJSON().stepType === "semloEditorCodeIndentV1");
      if (step) window.cooperativeLastStep = step;
    });
  });
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
    ),
  ).toBe("success");
  const mismatches = await page.evaluate((reference) => {
    const map = window.cooperativeLastStep!.getMap();
    return reference.filter((item) => {
      const actual = map.mapResult(item.position, item.assoc);
      return (
        actual.pos !== item.mapped ||
        actual.deleted !== item.deleted ||
        actual.deletedBefore !== item.deletedBefore ||
        actual.deletedAfter !== item.deletedAfter ||
        actual.deletedAcross !== item.deletedAcross
      );
    });
  }, expected);
  expect(mismatches).toEqual([]);
});

test("the atomic step maps host decorations and survives JSON, inversion and non-history edits", async ({ page }) => {
  const host = await mount(page);
  const original = "function f(){\nlet item=1;\nif(item){\nrun(item);\n}\n}";
  await setCode(page, original, "javascript", "space", 2);
  const index = original.indexOf("run(item)") + "run(".length;
  await page.evaluate(
    ({ from, to }) => {
      const editor = window.__semloRequireFixture("cooperativeEditor").editor;
      window.__semloRequireFixture("cooperativeAttachDecoration")(
        window.__semloRequireFixture("cooperativeEditor"),
        from,
        to,
      );
      window.cooperativeBeforeDoc = editor.state.doc;
      editor.on("transaction", ({ transaction }) => {
        const step = transaction.steps.find((candidate) => candidate.toJSON().stepType === "semloEditorCodeIndentV1");
        if (step) window.cooperativeLastStep = step;
      });
    },
    { from: index + 1, to: index + 5 },
  );
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
    ),
  ).toBe("success");
  await expect(host.locator(".indent-probe")).toHaveText("item");
  const formatted = await page.evaluate(
    () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
  );
  const nextIndex = formatted.indexOf("run(item)") + "run(".length;
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeDecorations")(window.__semloRequireFixture("cooperativeEditor")),
    ),
  ).toEqual([{ from: nextIndex + 1, to: nextIndex + 5 }]);
  const roundTrip = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cooperativeEditor").editor;
    const before = window.cooperativeBeforeDoc!;
    const after = editor.state.doc;
    const step = window.cooperativeLastStep!;
    const json = step.toJSON();
    const restored = window.__semloRequireFixture("cooperativeRestoreStep")(editor.schema, json);
    return {
      type: json.stepType,
      ranges: json.edits.length,
      apply: restored.apply(before).doc?.eq(after),
      invert: restored.invert(before).apply(after).doc?.eq(before),
    };
  });
  expect(roundTrip.type).toBe("semloEditorCodeIndentV1");
  expect(roundTrip.ranges).toBeGreaterThan(1);
  expect(roundTrip.apply).toBe(true);
  expect(roundTrip.invert).toBe(true);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cooperativeEditor").editor;
    const text = editor.state.doc.firstChild!.textContent;
    const position = 1 + text.indexOf("run(item)") + "run(".length;
    editor.view.dispatch(editor.state.tr.insertText("Z", position).setMeta("addToHistory", false));
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(original.replace("run(item)", "run(Zitem)"));
  await expect(host.locator(".indent-probe")).toHaveText("item");
  expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(formatted.replace("run(item)", "run(Zitem)"));
  await expect(host.locator(".indent-probe")).toHaveText("item");
});

test("rebased undo matches individual ProseMirror steps after overlapping non-history edits", async ({ page }) => {
  const original = "function f(){\nlet item=1;\nif(item){\nrun(item);\n}\n}";
  for (const kind of ["inside-text", "replace-indent", "delete-between", "delete-lines"] as const) {
    await mount(page);
    await setCode(page, original, "javascript", "space", 2);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        document.body.append(host)
        window.cooperativeSecond = createEditor({ element: host, outline: false, content: '<pre><code>second</code></pre>' })
      `,
    });
    await page.waitForFunction(() => Boolean(window.cooperativeSecond));
    await page.evaluate((text) => {
      const second = window.__semloRequireFixture("cooperativeSecond").editor;
      second.commands.setContent({
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text }] }],
      });
      second.commands.setTextSelection(1);
      window.__semloRequireFixture("cooperativeEditor").editor.view.focus();
    }, original);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
      ),
    ).toBe("success");
    await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeApplyReference")(window.__semloRequireFixture("cooperativeSecond"), 0),
    );
    await page.evaluate((editKind) => {
      for (const controller of [
        window.__semloRequireFixture("cooperativeEditor"),
        window.__semloRequireFixture("cooperativeSecond"),
      ]) {
        const editor = controller.editor;
        const text = editor.state.doc.firstChild!.textContent;
        let tr = editor.state.tr;
        if (editKind === "inside-text") {
          const at = 1 + text.indexOf("run(item)") + "run(".length;
          tr = tr.insertText("Z", at);
        } else if (editKind === "replace-indent") {
          const at = 1 + text.indexOf("\n  let") + 1;
          tr = tr.insertText("\t", at, at + 1);
        } else if (editKind === "delete-between") {
          tr = tr.delete(1 + text.indexOf("let") + 2, 1 + text.indexOf("run") + 2);
        } else {
          tr = tr.delete(1 + text.indexOf("\n") + 1, 1 + text.lastIndexOf("\n}"));
        }
        editor.view.dispatch(tr.setMeta("addToHistory", false));
      }
    }, kind);
    const beforeUndo = await page.evaluate(() => [
      window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON(),
      window.__semloRequireFixture("cooperativeSecond").editor.state.doc.toJSON(),
    ]);
    expect(beforeUndo[0]).toEqual(beforeUndo[1]);
    const undoResults = await page.evaluate(() => [
      window.__semloRequireFixture("cooperativeEditor").editor.commands.undo(),
      window.__semloRequireFixture("cooperativeSecond").editor.commands.undo(),
    ]);
    expect(undoResults[0]).toBe(undoResults[1]);
    const afterUndo = await page.evaluate(() => [
      window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON(),
      window.__semloRequireFixture("cooperativeSecond").editor.state.doc.toJSON(),
    ]);
    expect(afterUndo[0]).toEqual(afterUndo[1]);
    const redoResults = await page.evaluate(() => [
      window.__semloRequireFixture("cooperativeEditor").editor.commands.redo(),
      window.__semloRequireFixture("cooperativeSecond").editor.commands.redo(),
    ]);
    expect(redoResults[0]).toBe(redoResults[1]);
    const afterRedo = await page.evaluate(() => [
      window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON(),
      window.__semloRequireFixture("cooperativeSecond").editor.state.doc.toJSON(),
    ]);
    expect(afterRedo[0]).toEqual(afterRedo[1]);
  }
});

test("collaboration rebasing matches individual indentation steps across overlapping changes", async ({ page }) => {
  await mount(page);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      document.body.append(host)
      window.cooperativeSecond = createEditor({ element: host, outline: false, content: '<pre><code>second</code></pre>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.cooperativeSecond));
  const cases = [
    { language: "javascript", text: "function f(){\n    first();\nif(y){\nrun();\n }\n}" },
    { language: "csharp", text: "class C {\nvoid Run() {\n if(ok){\n  Call();\n}\n}\n}" },
    { language: "python", text: "def test():\n  if ready:\n      run()\n\n  return 3" },
  ];
  for (const item of cases) {
    await setCode(page, item.text, item.language, "space", 2);
    await page.evaluate(({ text, language }) => {
      const editor = window.__semloRequireFixture("cooperativeEditor").editor;
      window.cooperativeLastStep = undefined;
      editor.on("transaction", ({ transaction }) => {
        const step = transaction.steps.find((candidate) => candidate.toJSON().stepType === "semloEditorCodeIndentV1");
        if (step) window.cooperativeLastStep = step;
      });
      window.__semloRequireFixture("cooperativeSecond").editor.commands.setContent({
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] }],
      });
      editor.view.focus();
    }, item);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
      ),
    ).toBe("success");
    const mismatches = await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeCompareRebases")(
        window.__semloRequireFixture("cooperativeSecond"),
        window.cooperativeLastStep!,
        0,
        500,
      ),
    );
    expect(mismatches).toEqual([]);
  }
});

test("single-step commit preserves the same text-style marks as individual indentation edits", async ({ page }) => {
  await mount(page);
  for (const stored of [false, true]) {
    await page.evaluate((withStoredMark) => {
      const editor = window.__semloRequireFixture("cooperativeEditor").editor;
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "javascript", indentMode: "space", indentWidth: 4 },
            content: [
              { type: "text", text: "if (x) {\n", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
              { type: "text", text: "  one();\n", marks: [{ type: "textStyle", attrs: { color: "#0000ff" } }] },
              { type: "text", text: "if (y) {\n" },
              { type: "text", text: "two();\n", marks: [{ type: "textStyle", attrs: { color: "#008800" } }] },
              { type: "text", text: "}\n}", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
            ],
          },
        ],
      });
      editor.view.focus();
      editor.commands.setTextSelection(2);
      if (withStoredMark) editor.commands.setMark("textStyle", { color: "#abcdef" });
    }, stored);
    const before = await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON(),
    );
    const expected = await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeReferenceJSON")(window.__semloRequireFixture("cooperativeEditor"), 0),
    );
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
      ),
    ).toBe("success");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON()),
    ).toEqual(expected);
    expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(
      await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON()),
    ).toEqual(before);
  }
});

test("chunked indentation matches CodeMirror indentRange for language, width and tab modes", async ({ page }) => {
  await mount(page);
  const cases: Array<{ language: string; text: string; mode: "space" | "tab"; width: 2 | 4 | 8 }> = [
    { language: "javascript", text: "function f(){\nif(x){\nrun();\n}\n}\n".repeat(90), mode: "space", width: 2 },
    { language: "csharp", text: csharp, mode: "space", width: 4 },
    { language: "csharp", text: csharp, mode: "tab", width: 4 },
    { language: "python", text: "def f():\n if x:\n  run()\n\n".repeat(100), mode: "space", width: 4 },
    {
      language: "html",
      text: "<div>\n<section>\n<span>x</span>\n</section>\n</div>\n".repeat(60),
      mode: "space",
      width: 2,
    },
    { language: "plaintext", text: "    alpha\n      beta\n\n".repeat(150), mode: "space", width: 2 },
  ];
  for (const item of cases) {
    const expected = await page.evaluate(
      ({ text, language, mode, width }) =>
        window.__semloRequireFixture("cooperativeReference")(text, language, mode, width),
      item,
    );
    await setCode(page, item.text, item.language, item.mode, item.width);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor")),
      ),
    ).toBe("success");
    expect(
      await page.evaluate(
        () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
      ),
    ).toBe(expected);
  }
});

test("a long indentation yields to browser tasks and is one undoable edit with selection preserved", async ({
  page,
}) => {
  await mount(page);
  const expected = await page.evaluate(
    (text) => window.__semloRequireFixture("cooperativeReference")(text, "csharp", "space", 4),
    csharp,
  );
  await setCode(page, csharp, "csharp", "space", 4);
  const selected = csharp.indexOf("Call();");
  await page.evaluate(
    ({ from, to }) => window.__semloRequireFixture("cooperativeEditor").editor.commands.setTextSelection({ from, to }),
    {
      from: selected + 1 + "Call();".length,
      to: selected + 1,
    },
  );
  const result = await page.evaluate(async () => {
    let ticks = 0;
    const interval = window.setInterval(() => {
      ticks += 1;
    }, 5);
    const outcome = await window.__semloRequireFixture("cooperativeStart")(
      window.__semloRequireFixture("cooperativeEditor"),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    window.clearInterval(interval);
    return { outcome, ticks };
  });
  expect(result.outcome).toBe("success");
  expect(result.ticks).toBeGreaterThan(2);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(expected);
  const selection = await page.evaluate(() => {
    const { state } = window.__semloRequireFixture("cooperativeEditor").editor;
    return {
      anchor: state.selection.anchor,
      head: state.selection.head,
      text: state.doc.textBetween(state.selection.from, state.selection.to),
    };
  });
  expect(selection.anchor).toBeGreaterThan(selection.head);
  expect(selection.text).toBe("Call();");
  expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(csharp);
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("cooperativeEditor").editor;
      return {
        backward: state.selection.anchor > state.selection.head,
        text: state.doc.textBetween(state.selection.from, state.selection.to),
      };
    }),
  ).toEqual({ backward: true, text: "Call();" });
  expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(expected);
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("cooperativeEditor").editor;
      return {
        backward: state.selection.anchor > state.selection.head,
        text: state.doc.textBetween(state.selection.from, state.selection.to),
      };
    }),
  ).toEqual({ backward: true, text: "Call();" });
});

test("indentation maps selections outside or spanning the code block, including backward selections", async ({
  page,
}) => {
  await mount(page);
  for (const selection of ["before", "after-backward", "spanning-backward"] as const) {
    const { codePos, anchor, head, expectedAnchor, expectedHead } = await page.evaluate((selection) => {
      const controller = window.__semloRequireFixture("cooperativeEditor");
      const editor = controller.editor;
      editor.commands.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "before" }] },
          {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: "if (x) {\nrun();\n}" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      });
      editor.commands.focus();
      const codePos = editor.state.doc.firstChild!.nodeSize;
      const code = editor.state.doc.nodeAt(codePos)!;
      const after = codePos + code.nodeSize + 1;
      const [anchor, head] =
        selection === "before" ? [2, 5] : selection === "after-backward" ? [after + 4, after + 1] : [after + 4, 2];
      editor.commands.setTextSelection({ from: anchor, to: head });
      const expected = window.__semloRequireFixture("cooperativeReferenceMappings")(controller, codePos);
      const mapped = (position: number) =>
        expected.find((item) => item.position === position && item.assoc === 1)!.mapped;
      return { codePos, anchor, head, expectedAnchor: mapped(anchor), expectedHead: mapped(head) };
    }, selection);
    expect(
      await page.evaluate(
        (pos) =>
          window.__semloRequireFixture("cooperativeStartAt")(window.__semloRequireFixture("cooperativeEditor"), pos),
        codePos,
      ),
    ).toBe("success");
    const selected = await page.evaluate(() => {
      const { selection } = window.__semloRequireFixture("cooperativeEditor").editor.state;
      return { anchor: selection.anchor, head: selection.head };
    });
    expect(selected).toEqual({ anchor: expectedAnchor, head: expectedHead });
    expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(
      await page.evaluate(() => {
        const { selection } = window.__semloRequireFixture("cooperativeEditor").editor.state;
        return { anchor: selection.anchor, head: selection.head };
      }),
    ).toEqual({ anchor, head });
    expect(await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.redo())).toBe(
      true,
    );
    expect(
      await page.evaluate(() => {
        const { selection } = window.__semloRequireFixture("cooperativeEditor").editor.state;
        return { anchor: selection.anchor, head: selection.head };
      }),
    ).toEqual({ anchor: expectedAnchor, head: expectedHead });
  }
});

test("typing, selection, stored marks, focus changes and destroy cancel pending work", async ({ page }) => {
  const host = await mount(page);
  for (const action of ["type", "edit-undo", "selection", "stored-marks", "focus", "destroy"] as const) {
    await setCode(page, csharp, "csharp", "space", 4);
    const beforeSelection = await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.selection.from,
    );
    await page.evaluate(() => {
      window.cooperativePending = window.__semloRequireFixture("cooperativeStart")(
        window.__semloRequireFixture("cooperativeEditor"),
      );
    });
    if (action === "type") await page.keyboard.type("Z");
    else if (action === "edit-undo")
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("cooperativeEditor").editor;
        editor.commands.insertContent("Z");
        editor.commands.undo();
      });
    else if (action === "selection")
      await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.commands.setTextSelection(3));
    else if (action === "stored-marks")
      await page.evaluate(() =>
        window.__semloRequireFixture("cooperativeEditor").editor.commands.setMark("textStyle", { color: "#abcdef" }),
      );
    else if (action === "focus") {
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.id = "cooperative-other-focus";
        document.body.append(input);
        input.focus();
      });
      expect(
        await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").editor.state.selection.from),
      ).toBe(beforeSelection);
    } else await page.evaluate(() => window.__semloRequireFixture("cooperativeEditor").destroy());

    const afterAction =
      action === "destroy"
        ? null
        : await page.evaluate(
            () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
          );
    expect(await page.evaluate(() => window.cooperativePending)).toBe("cancelled");
    if (action !== "destroy") {
      const text = await page.evaluate(
        () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
      );
      expect(text).toBe(afterAction);
      if (action === "type") expect(text).toBe(`Z${csharp}`);
      if (action !== "type" && action !== "edit-undo") expect(text).toBe(csharp);
      if (action === "focus") await expect(page.locator("#cooperative-other-focus")).toBeFocused();
    }
  }
  await expect(host.locator(".semlo-editor-prose")).toHaveCount(0);
});

test("large work is deferred and an edit before its first slice cancels it", async ({ page }) => {
  await mount(page);
  await setCode(page, csharp, "csharp", "space", 4);
  const result = await page.evaluate(async () => {
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const held = new Map<number, () => void>();
    let nextId = -1;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 0 && typeof handler === "function") {
        const id = nextId--;
        held.set(id, () => handler(...args));
        return id;
      }
      return originalSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id: number | undefined) => {
      if (id !== undefined && id < 0) held.delete(id);
      else originalClearTimeout(id);
    }) as typeof window.clearTimeout;
    try {
      const task = window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor"));
      const pendingBeforeInput = window.__semloRequireFixture("cooperativeIsPending")(
        window.__semloRequireFixture("cooperativeEditor"),
      );
      const queuedBeforeInput = held.size;
      window.__semloRequireFixture("cooperativeEditor").editor.commands.insertContent("Z");
      const callbacks = [...held.values()];
      held.clear();
      for (const callback of callbacks) callback();
      return { pendingBeforeInput, queuedBeforeInput, outcome: await task };
    } finally {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });
  expect(result.pendingBeforeInput).toBe(true);
  expect(result.queuedBeforeInput).toBeGreaterThan(0);
  expect(result.outcome).toBe("cancelled");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(`Z${csharp}`);
});

test("an unfinished parser fails within its budget without changing content or undo history", async ({ page }) => {
  await mount(page);
  await setCode(page, csharp, "csharp", "space", 4);
  const before = await page.evaluate(() => ({
    doc: window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON(),
    undo: window.__semloRequireFixture("cooperativeUndoDepth")(window.__semloRequireFixture("cooperativeEditor")),
  }));
  const started = await page.evaluate(() => {
    const task = window.__semloRequireFixture("cooperativeStartStuck")(
      window.__semloRequireFixture("cooperativeEditor"),
    );
    const dismiss = window.__semloRequireFixture("cooperativeShowProgress")("正在自动缩进…");
    window.cooperativePending = task.then((result) => {
      dismiss();
      return result;
    });
    return {
      pending: window.__semloRequireFixture("cooperativeIsPending")(window.__semloRequireFixture("cooperativeEditor")),
      status: document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent,
    };
  });
  expect(started).toEqual({ pending: true, status: "正在自动缩进…" });
  expect(await page.evaluate(() => window.cooperativePending)).toBe("failed");
  await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeIsPending")(window.__semloRequireFixture("cooperativeEditor")),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => ({
      doc: window.__semloRequireFixture("cooperativeEditor").editor.state.doc.toJSON(),
      undo: window.__semloRequireFixture("cooperativeUndoDepth")(window.__semloRequireFixture("cooperativeEditor")),
    })),
  ).toEqual(before);
});

test("editor transactions and focus changes cancel immediately before a deferred slice runs", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "cooperative-immediate-focus";
    document.body.append(input);
  });
  for (const action of ["type", "focus", "window"] as const) {
    await setCode(page, csharp, "csharp", "space", 4);
    const result = await page.evaluate(async (kind) => {
      const originalSetTimeout = window.setTimeout;
      const originalClearTimeout = window.clearTimeout;
      const held = new Map<number, () => void>();
      let nextId = -1;
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 0 && typeof handler === "function") {
          const id = nextId--;
          held.set(id, () => handler(...args));
          return id;
        }
        return originalSetTimeout(handler, delay, ...args);
      }) as typeof window.setTimeout;
      window.clearTimeout = ((id: number | undefined) => {
        if (id !== undefined && id < 0) held.delete(id);
        else originalClearTimeout(id);
      }) as typeof window.clearTimeout;
      try {
        const editor = window.__semloRequireFixture("cooperativeEditor").editor;
        const beforeSelection = editor.state.selection.from;
        const hadFocus = document.hasFocus();
        const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
        editor.view.dom.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "f",
            shiftKey: true,
            metaKey: mac,
            ctrlKey: !mac,
            bubbles: true,
            cancelable: true,
          }),
        );
        const pending = document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent;
        const queued = held.size;
        if (kind === "type") editor.commands.insertContent("Z");
        else if (kind === "focus") document.querySelector<HTMLInputElement>("#cooperative-immediate-focus")!.focus();
        else window.dispatchEvent(new Event("blur"));
        await Promise.resolve();
        const statusBeforeRelease =
          document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent ?? null;
        const callbacks = [...held.values()];
        held.clear();
        for (const callback of callbacks) callback();
        await Promise.resolve();
        return {
          pending,
          queued,
          hadFocus,
          statusBeforeRelease,
          statusAfterRelease: document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent ?? null,
          selectionBefore: beforeSelection,
          selectionAfter: editor.state.selection.from,
          text: editor.state.doc.firstChild!.textContent,
          active: document.activeElement?.id ?? "",
        };
      } finally {
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
      }
    }, action);
    expect(result.pending).toBe("正在自动缩进…");
    expect(result.queued).toBeGreaterThan(0);
    if (action === "window") expect(result.hadFocus).toBe(true);
    expect(result.statusBeforeRelease).toBeNull();
    expect(result.statusAfterRelease).toBeNull();
    expect(result.text).toBe(action === "type" ? `Z${csharp}` : csharp);
    if (action !== "type") expect(result.selectionAfter).toBe(result.selectionBefore);
    if (action === "focus") expect(result.active).toBe("cooperative-immediate-focus");
  }
});

test("new work cancels only the previous job for the same editor", async ({ page }) => {
  await mount(page);
  await setCode(page, csharp, "csharp", "space", 4);
  const result = await page.evaluate(async () => {
    const first = window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor"));
    const wasPending = window.__semloRequireFixture("cooperativeIsPending")(
      window.__semloRequireFixture("cooperativeEditor"),
    );
    const second = window.__semloRequireFixture("cooperativeStart")(window.__semloRequireFixture("cooperativeEditor"));
    return { wasPending, results: await Promise.all([first, second]) };
  });
  expect(result).toEqual({ wasPending: true, results: ["cancelled", "success"] });
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("cooperativeIsPending")(window.__semloRequireFixture("cooperativeEditor")),
    ),
  ).toBe(false);
});

test("editing one editor cancels its pending job without cancelling another editor", async ({ page }) => {
  await mount(page);
  await setCode(page, csharp, "csharp", "space", 4);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'cooperative-second'
      document.body.append(host)
      window.cooperativeSecond = createEditor({ element: host, outline: false, content: '<pre><code>second</code></pre>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.cooperativeSecond));
  const expected = await page.evaluate(
    (text) => window.__semloRequireFixture("cooperativeReference")(text, "csharp", "space", 4),
    csharp,
  );
  const results = await page.evaluate(async (text) => {
    const first = window.__semloRequireFixture("cooperativeEditor").editor;
    const second = window.__semloRequireFixture("cooperativeSecond").editor;
    second.commands.setContent({
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "csharp", indentWidth: 4 }, content: [{ type: "text", text }] },
      ],
    });
    first.view.focus();
    first.commands.setTextSelection(1);
    const firstPending = window.__semloRequireFixture("cooperativeStart")(
      window.__semloRequireFixture("cooperativeEditor"),
    );
    const secondPending = window.__semloRequireFixture("cooperativeStart")(
      window.__semloRequireFixture("cooperativeSecond"),
    );
    first.commands.insertContent("Z");
    return Promise.all([firstPending, secondPending]);
  }, csharp);
  expect(results).toEqual(["cancelled", "success"]);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(`Z${csharp}`);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeSecond").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(expected);
});

test("menu-triggered work shows pending and immediately yields to typing without stale changes", async ({ page }) => {
  const host = await mount(page);
  await setCode(page, csharp, "csharp", "space", 4);
  const card = host.locator(".semlo-editor-code-card");
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  const menu = page.getByRole("menu", { name: "代码块设置" });
  await menu.getByRole("menuitem", { name: "自动缩进" }).click();
  await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveText("正在自动缩进…");
  await page.keyboard.type("Z");
  await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
    ),
  ).toBe(`Z${csharp}`);
  await expect(menu).toBeVisible();
});

test("keyboard-triggered work cancels on typing or focus change without stealing input", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "cooperative-keyboard-other";
    document.body.append(input);
  });
  for (const action of ["type", "focus"] as const) {
    await setCode(page, csharp, "csharp", "space", 4);
    await expect(host.locator(".ProseMirror")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+F");
    await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveText("正在自动缩进…");
    if (action === "type") await page.keyboard.type("Z");
    else await page.locator("#cooperative-keyboard-other").focus();
    await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.__semloRequireFixture("cooperativeEditor").editor.state.doc.firstChild!.textContent,
      ),
    ).toBe(action === "type" ? `Z${csharp}` : csharp);
    if (action === "focus") await expect(page.locator("#cooperative-keyboard-other")).toBeFocused();
  }
});

test("destroying an older editor cannot clear another editor's pending indicator", async ({ page }) => {
  await mount(page);
  await setCode(page, csharp, "csharp", "space", 4);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'cooperative-second'
      document.body.append(host)
      window.cooperativeSecond = createEditor({ element: host, outline: false, content: '<pre><code>second</code></pre>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.cooperativeSecond));
  await page.evaluate((text) => {
    const second = window.__semloRequireFixture("cooperativeSecond").editor;
    second.commands.setContent({
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "csharp", indentWidth: 4 }, content: [{ type: "text", text }] },
      ],
    });
    document.querySelector<HTMLElement>("#cooperative-editor")!.style.cssText =
      "position:fixed;top:0;left:0;width:600px;height:120px;overflow:auto";
    document.querySelector<HTMLElement>("#cooperative-second")!.style.cssText =
      "position:fixed;top:150px;left:0;width:600px;height:120px;overflow:auto";
    const start = (id: string) => {
      document.querySelector<HTMLButtonElement>(`#${id} .semlo-editor-code-more`)!.click();
      const menus = document.querySelectorAll<HTMLElement>(".semlo-editor-code-settings-menu");
      menus[menus.length - 1].querySelector<HTMLButtonElement>('[aria-label="自动缩进"]')!.click();
    };
    start("cooperative-editor");
    start("cooperative-second");
    window.__semloRequireFixture("cooperativeEditor").destroy();
  }, csharp);
  await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveText("正在自动缩进…");
  await page.evaluate(() => window.__semloRequireFixture("cooperativeSecond").destroy());
  await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveCount(0);
});

test("an older synchronous completion cannot replace a newer pending indicator", async ({ page }) => {
  for (const origin of ["keyboard", "menu"] as const) {
    await mount(page);
    await setCode(page, "    alpha\n      beta", "plaintext", "space", 2);
    await page.locator("#cooperative-editor .ProseMirror").focus();
    await page.keyboard.press("ControlOrMeta+Shift+F");
    await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveText("自动缩进成功");
    await setCode(page, "    alpha\n      beta", "plaintext", "space", 2);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'cooperative-second'
        document.body.append(host)
        window.cooperativeSecond = createEditor({ element: host, outline: false, content: '<pre><code>second</code></pre>' })
      `,
    });
    await page.waitForFunction(() => Boolean(window.cooperativeSecond));
    const result = await page.evaluate(
      async ({ text, origin }) => {
        const first = window.__semloRequireFixture("cooperativeEditor").editor;
        const second = window.__semloRequireFixture("cooperativeSecond").editor;
        second.commands.setContent({
          type: "doc",
          content: [
            { type: "codeBlock", attrs: { language: "csharp", indentWidth: 4 }, content: [{ type: "text", text }] },
          ],
        });
        document.querySelector<HTMLElement>("#cooperative-editor")!.style.cssText =
          "position:fixed;top:0;left:0;width:600px;height:120px;overflow:auto";
        document.querySelector<HTMLElement>("#cooperative-second")!.style.cssText =
          "position:fixed;top:150px;left:0;width:600px;height:120px;overflow:auto";
        const key = (editor: typeof first) => {
          editor.view.focus();
          editor.commands.setTextSelection(1);
          const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
          editor.view.dom.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "f",
              shiftKey: true,
              metaKey: mac,
              ctrlKey: !mac,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        if (origin === "keyboard") key(first);
        else {
          document.querySelector<HTMLButtonElement>("#cooperative-editor .semlo-editor-code-more")!.click();
          document
            .querySelector<HTMLButtonElement>('.semlo-editor-code-settings-menu [aria-label="自动缩进"]')!
            .click();
        }
        const firstTextImmediately = first.state.doc.firstChild!.textContent;
        key(second);
        const pendingBeforeMicrotasks = document.querySelector(
          '.semlo-editor-code-feedback[role="status"]',
        )?.textContent;
        await Promise.resolve();
        const pendingAfterMicrotasks = document.querySelector(
          '.semlo-editor-code-feedback[role="status"]',
        )?.textContent;
        second.commands.insertContent("Z");
        await Promise.resolve();
        return {
          firstTextImmediately,
          pendingBeforeMicrotasks,
          pendingAfterMicrotasks,
          statusAfterCancel: document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent ?? null,
        };
      },
      { text: csharp, origin },
    );
    expect(result.firstTextImmediately).toBe("alpha\n      beta");
    expect(result.pendingBeforeMicrotasks).toBe("正在自动缩进…");
    expect(result.pendingAfterMicrotasks).toBe("正在自动缩进…");
    expect(result.statusAfterCancel).toBeNull();
  }
});

test("a completed command cannot replace a newer task in the same editor", async ({ page }) => {
  for (const origin of ["keyboard", "menu"] as const) {
    await mount(page);
    await setCode(page, "    alpha\n      beta", "plaintext", "space", 2);
    await page.locator("#cooperative-editor .ProseMirror").focus();
    await page.keyboard.press("ControlOrMeta+Shift+F");
    await expect(page.locator('.semlo-editor-code-feedback[role="status"]')).toHaveText("自动缩进成功");
    await setCode(page, "    alpha\n      beta", "plaintext", "space", 2);
    const result = await page.evaluate(
      async ({ text, origin }) => {
        const editor = window.__semloRequireFixture("cooperativeEditor").editor;
        const key = () => {
          editor.view.focus();
          editor.commands.setTextSelection(1);
          const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
          editor.view.dom.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "f",
              shiftKey: true,
              metaKey: mac,
              ctrlKey: !mac,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        if (origin === "keyboard") key();
        else {
          document.querySelector<HTMLButtonElement>("#cooperative-editor .semlo-editor-code-more")!.click();
          document
            .querySelector<HTMLButtonElement>('.semlo-editor-code-settings-menu [aria-label="自动缩进"]')!
            .click();
        }
        const firstTextImmediately = editor.state.doc.firstChild!.textContent;
        editor.commands.setContent({
          type: "doc",
          content: [
            { type: "codeBlock", attrs: { language: "csharp", indentWidth: 4 }, content: [{ type: "text", text }] },
          ],
        });
        key();
        await Promise.resolve();
        const status = document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent;
        editor.commands.insertContent("Z");
        await Promise.resolve();
        return {
          firstTextImmediately,
          status,
          afterCancel: document.querySelector('.semlo-editor-code-feedback[role="status"]')?.textContent ?? null,
        };
      },
      { text: csharp, origin },
    );
    expect(result.firstTextImmediately).toBe("alpha\n      beta");
    expect(result.status).toBe("正在自动缩进…");
    expect(result.afterCancel).toBeNull();
  }
});
