import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-end-boundary-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());

type Container = "root" | "quote" | "details";
type Shape =
  | "simple"
  | "next-text"
  | "heading-soft-break"
  | "paragraph-soft-break"
  | "wrapped"
  | "paragraph"
  | "heading-bold"
  | "heading-numbered"
  | "next-bold"
  | "next-indent"
  | "extra-after"
  | "two-next-text";
type Initial = "home" | "reverse" | "end" | "middle";
type Sample = {
  name: string;
  container: Container;
  shape: Shape;
  before?: boolean;
  beforeText?: boolean;
  level?: number;
  format?: "bold" | "italic" | "mixed" | "numbered" | "both";
  initial: Initial;
  key: string;
  targeted: boolean;
  deletion?: "Backspace" | "Delete";
  multilineTarget?: boolean;
  synthetic?: "isComposing" | "keyCode229" | "compositionstart";
};
function emptiedHeading(json: JSONContent): JSONContent {
  const copy = JSON.parse(JSON.stringify(json)) as JSONContent;
  const visit = (node: JSONContent) => {
    if (node.type === "heading") delete node.content;
    else for (const child of node.content ?? []) visit(child);
  };
  visit(copy);
  return copy;
}

const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (content: JSONContent[] = []): JSONContent => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
function documentFor(sample: Sample): JSONContent {
  const textContent = sample.shape === "wrapped" ? "长".repeat(100) : sample.format === "mixed" ? "abcd" : "test";
  const body: JSONContent[] = [
    ...(sample.before ? [paragraph()] : sample.beforeText ? [paragraph([text("first")])] : []),
    sample.shape === "paragraph"
      ? paragraph([text(textContent)])
      : {
          type: "heading",
          attrs: {
            level: sample.level ?? 3,
            ...(sample.shape === "heading-numbered" || sample.format === "numbered"
              ? { semloEditorHeadingNumbering: "mixed" }
              : {}),
          },
          content:
            sample.shape === "heading-soft-break"
              ? [text("te"), { type: "hardBreak" }, text("st")]
              : sample.format === "mixed"
                ? [text("a"), { ...text("bc"), marks: [{ type: "bold" }] }, text("d")]
                : sample.format === "bold" || sample.format === "italic"
                  ? [{ ...text(textContent), marks: [{ type: sample.format }] }]
                  : sample.format === "both"
                    ? [{ ...text(textContent), marks: [{ type: "bold" }, { type: "italic" }] }]
                    : [
                        sample.shape === "heading-bold"
                          ? { ...text(textContent), marks: [{ type: "bold" }] }
                          : text(textContent),
                      ],
        },
    sample.shape === "next-indent"
      ? { type: "paragraph", attrs: { semloEditorIndent: 1 } }
      : paragraph(
          sample.shape === "next-text" || sample.shape === "two-next-text" || sample.format
            ? [text("next")]
            : sample.shape === "next-bold"
              ? [{ ...text("next"), marks: [{ type: "bold" }] }]
              : sample.shape === "paragraph-soft-break"
                ? [{ type: "hardBreak" }]
                : [],
        ),
    ...(sample.shape === "extra-after" ? [paragraph([text("末尾")])] : []),
    ...(sample.shape === "two-next-text" ? [paragraph([text("third")])] : []),
  ];
  if (sample.container === "root") return { type: "doc", content: body };
  if (sample.container === "quote") return { type: "doc", content: [{ type: "blockquote", content: body }] };
  return {
    type: "doc",
    content: [
      {
        type: "details",
        attrs: { open: true },
        content: [{ type: "detailsSummary" }, { type: "detailsContent", content: body }],
      },
    ],
  };
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const selection = editor.state.selection;
    const native = window.getSelection();
    return {
      json: editor.getJSON(),
      selection: {
        anchor: selection.anchor,
        head: selection.head,
        anchorType: selection.$anchor.parent.type.name,
        anchorOffset: selection.$anchor.parentOffset,
        headType: selection.$head.parent.type.name,
        headOffset: selection.$head.parentOffset,
        text: native?.toString() ?? null,
        nativeCollapsed: native?.isCollapsed ?? null,
        focused: editor.view.hasFocus(),
      },
    };
  });
}

const cases: Sample[] = [];
for (const container of ["root", "quote", "details"] as const) {
  for (const before of [false, true]) {
    for (const deletion of ["Backspace", "Delete"] as const) {
      cases.push({
        name: `${container}/before-${before}/${deletion}`,
        container,
        shape: "simple",
        before,
        initial: "home",
        key: "Shift+End",
        targeted: true,
        deletion,
      });
    }
  }
}
cases.push(
  {
    name: "bold-italic",
    container: "root",
    shape: "next-text",
    format: "both",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "heading-bold",
    container: "root",
    shape: "heading-bold",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "heading-numbered",
    container: "root",
    shape: "heading-numbered",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "next-bold",
    container: "root",
    shape: "next-bold",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "next-indent",
    container: "root",
    shape: "next-indent",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "extra-after",
    container: "root",
    shape: "extra-after",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "nonempty-next",
    container: "root",
    shape: "next-text",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "nonempty-next-delete",
    container: "root",
    shape: "next-text",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Delete",
  },
  {
    name: "quote-nonempty-next",
    container: "quote",
    shape: "next-text",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "quote-nonempty-next-delete",
    container: "quote",
    shape: "next-text",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Delete",
  },
  {
    name: "observed-root-h3-before-after",
    container: "root",
    shape: "next-text",
    beforeText: true,
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "observed-root-h6-two-following",
    container: "root",
    shape: "two-next-text",
    level: 6,
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "details-nonempty-next",
    container: "details",
    shape: "next-text",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "details-nonempty-next-delete",
    container: "details",
    shape: "next-text",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Delete",
  },
  {
    name: "reverse-selection",
    container: "root",
    shape: "simple",
    initial: "reverse",
    key: "Shift+End",
    targeted: false,
  },
  { name: "shift-home", container: "root", shape: "simple", initial: "end", key: "Shift+Home", targeted: false },
  {
    name: "middle-shift-end",
    container: "root",
    shape: "simple",
    initial: "middle",
    key: "Shift+End",
    targeted: false,
  },
  {
    name: "heading-soft-break",
    container: "root",
    shape: "heading-soft-break",
    initial: "home",
    key: "Shift+End",
    targeted: false,
    multilineTarget: true,
  },
  {
    name: "paragraph-soft-break",
    container: "root",
    shape: "paragraph-soft-break",
    initial: "home",
    key: "Shift+End",
    targeted: true,
    deletion: "Backspace",
  },
  {
    name: "wrapped-heading",
    container: "root",
    shape: "wrapped",
    initial: "home",
    key: "Shift+End",
    targeted: false,
    multilineTarget: true,
  },
  {
    name: "ordinary-paragraph",
    container: "root",
    shape: "paragraph",
    initial: "home",
    key: "Shift+End",
    targeted: false,
  },
  { name: "alt-shift-end", container: "root", shape: "simple", initial: "home", key: "Alt+Shift+End", targeted: false },
  {
    name: "ctrl-shift-end",
    container: "root",
    shape: "simple",
    initial: "home",
    key: "Control+Shift+End",
    targeted: false,
  },
  {
    name: "meta-shift-end",
    container: "root",
    shape: "simple",
    initial: "home",
    key: "Meta+Shift+End",
    targeted: false,
  },
  {
    name: "synthetic-ime",
    container: "root",
    shape: "simple",
    initial: "home",
    key: "Shift+End",
    synthetic: "isComposing",
    targeted: false,
  },
  {
    name: "synthetic-229",
    container: "root",
    shape: "simple",
    initial: "home",
    key: "Shift+End",
    synthetic: "keyCode229",
    targeted: false,
  },
  {
    name: "synthetic-compositionstart",
    container: "root",
    shape: "simple",
    initial: "home",
    key: "Shift+End",
    synthetic: "compositionstart",
    targeted: false,
  },
);

// H1–H6 in root plus nonempty text and root H3 within a quote or a
// details body were observed in Yuque; other combinations are limited extensions.
for (const container of ["root", "quote", "details"] as const)
  for (const level of [1, 2, 4, 5, 6])
    for (const shape of ["simple", "next-text"] as const)
      for (const deletion of ["Backspace", "Delete"] as const)
        cases.push({
          name: `${container}/level-${level}/${shape}/${deletion}`,
          container,
          shape,
          level,
          initial: "home",
          key: "Shift+End",
          targeted: true,
          deletion,
        });

// Root H3 with numbering, bold, italic and mixed plain/bold text were
// observed in Yuque; applying the same rule to other levels is a limited extension.
for (const level of [1, 2, 3, 4, 5, 6])
  for (const format of ["bold", "italic", "mixed", "numbered"] as const)
    for (const deletion of ["Backspace", "Delete"] as const)
      cases.push({
        name: `root/level-${level}/${format}/${deletion}`,
        container: "root",
        shape: "next-text",
        level,
        format,
        initial: "home",
        key: "Shift+End",
        targeted: true,
        deletion,
      });

for (const key of ["Shift+Home", "Alt+Home", "Control+Home", "Meta+Home"])
  cases.push({
    name: `numbered-unobserved-${key}`,
    container: "root",
    shape: "next-text",
    format: "numbered",
    initial: "end",
    key,
    targeted: false,
  });
for (const synthetic of ["isComposing", "keyCode229", "compositionstart"] as const)
  cases.push({
    name: `numbered-home-${synthetic}`,
    container: "root",
    shape: "next-text",
    format: "numbered",
    initial: "end",
    key: "Home",
    synthetic,
    targeted: false,
  });

async function exercise(page: Page, sample: Sample, native: boolean) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ content, width, native }) => window.__semloRequireFixture("mountHeadingEndBoundary")(content, width, native),
    {
      content: documentFor(sample),
      width: sample.shape === "wrapped" ? 240 : 850,
      native,
    },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const target = page
    .locator(
      `#heading-end-boundary .semlo-editor-prose ${sample.shape === "paragraph" ? "p" : `h${sample.level ?? 3}`}`,
    )
    .first();
  await expect(target).toBeVisible();
  if (sample.initial === "home") {
    if (sample.shape === "wrapped" || sample.shape === "heading-soft-break") {
      await page.evaluate(
        (value) => window.__semloRequireFixture("headingEndBoundary").select(value, 0, 0),
        sample.shape === "wrapped" ? "长".repeat(100) : "test",
      );
    } else await target.click();
    await page.keyboard.press("Home");
  } else {
    const [anchor, head] = sample.initial === "reverse" ? [4, 1] : sample.initial === "end" ? [4, 4] : [2, 2];
    await page.evaluate(
      ({ anchor, head }) => window.__semloRequireFixture("headingEndBoundary").select("test", anchor, head),
      { anchor, head },
    );
  }
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await inspect(page);
  let defaultPrevented: boolean | undefined;
  if (sample.synthetic) {
    defaultPrevented = await page.evaluate(
      ({ kind, key }) => {
        const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
        if (kind === "compositionstart")
          view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        const event = new KeyboardEvent("keydown", {
          key: key.includes("Home") ? "Home" : "End",
          shiftKey: key.includes("Shift+"),
          bubbles: true,
          cancelable: true,
          isComposing: kind === "isComposing",
        });
        if (kind === "keyCode229") Object.defineProperty(event, "keyCode", { value: 229 });
        view.dom.dispatchEvent(event);
        const prevented = event.defaultPrevented;
        if (kind === "compositionstart")
          view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        return prevented;
      },
      { kind: sample.synthetic, key: sample.key },
    );
  } else await page.keyboard.press(sample.key);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await inspect(page);
  expect(after.json).toEqual(before.json);
  return { before, after, defaultPrevented, target };
}

for (const sample of cases) {
  test(sample.name, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (sample.multilineTarget) {
      const { before, after } = await exercise(page, sample, false);
      expect(after.selection).toMatchObject({
        anchorType: "heading",
        anchorOffset: 0,
        headType: "heading",
        nativeCollapsed: false,
        focused: true,
      });
      const removed = after.selection.headOffset;
      expect(removed).toBeGreaterThan(0);
      const expected = JSON.parse(JSON.stringify(before.json)) as JSONContent;
      const heading = expected.content![0];
      if (sample.shape === "heading-soft-break") {
        expect(after.selection.text).toBe("te");
        expect(removed).toBe(2);
        heading.content!.shift();
      } else {
        expect(removed).toBeLessThan(100);
        expect(after.selection.text).toBe("长".repeat(removed));
        heading.content![0].text = "长".repeat(100 - removed);
      }
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      expect((await inspect(page)).json).toEqual(expected);
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const undone = await inspect(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.selection).toEqual(after.selection);
    } else if (sample.name === "middle-shift-end") {
      // This is a local safety rule; the available Yuque observations differ by browser.
      const { before, after } = await exercise(page, sample, false);
      expect(after.selection).toMatchObject({
        anchorType: "heading",
        anchorOffset: 2,
        headType: "heading",
        headOffset: 4,
        text: "st",
        nativeCollapsed: false,
        focused: true,
      });
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const expected = JSON.parse(JSON.stringify(before.json)) as JSONContent;
      expected.content![0].content![0].text = "te";
      const deleted = await inspect(page);
      expect(deleted.json).toEqual(expected);
      expect(deleted.selection).toMatchObject({
        anchorType: "heading",
        anchorOffset: 2,
        headType: "heading",
        headOffset: 2,
        focused: true,
      });
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const undone = await inspect(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.selection).toEqual(after.selection);
    } else if (!sample.targeted) {
      // Disable only this plugin in a fresh instance and compare real browser
      // behavior, so untouched scenarios do not depend on a specific OS keymap.
      const original = await exercise(page, sample, true);
      const candidate = await exercise(page, sample, false);
      expect(candidate.after).toEqual(original.after);
      expect(candidate.defaultPrevented).toEqual(original.defaultPrevented);
    } else {
      const { before, after, target } = await exercise(page, sample, false);
      expect(after.selection).toMatchObject({
        anchorType: "heading",
        anchorOffset: 0,
        headType: "heading",
        headOffset: 4,
        text: sample.format === "mixed" ? "abcd" : "test",
        nativeCollapsed: false,
        focused: true,
      });
      await page.keyboard.press(sample.deletion!);
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const deleted = await inspect(page);
      expect(deleted.json).toEqual(emptiedHeading(before.json));
      expect(deleted.selection).toMatchObject({
        anchorType: "heading",
        anchorOffset: 0,
        headType: "heading",
        headOffset: 0,
        focused: true,
      });
      expect(
        await target.evaluate((element) => {
          const copy = element.cloneNode(true) as HTMLElement;
          copy
            .querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
            .forEach((node) => node.remove());
          return copy.textContent;
        }),
      ).toBe("");
      if (sample.format === "numbered") await expect(target.locator(".semlo-editor-heading-number")).toBeVisible();
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const undone = await inspect(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.selection).toEqual(after.selection);
    }
    expect(errors).toEqual([]);
  });
}
