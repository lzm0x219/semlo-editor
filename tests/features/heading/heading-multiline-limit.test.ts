import { writeFile } from "node:fs/promises";

import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    headingLimitTiming?: { elapsed?: number; calls?: number; prevented?: boolean; trusted?: boolean };
  }
}

type Sample = { name: string; content: JSONContent[]; expectedHandled: boolean };
const text = (value: string, mark?: string): JSONContent => ({
  type: "text",
  text: value,
  ...(mark ? { marks: [{ type: mark }] } : {}),
});
const samples: Sample[] = [
  { name: "4096 model units", content: [text("test ".repeat(819) + "t")], expectedHandled: true },
  { name: "4097 model units", content: [text("test ".repeat(819) + "te")], expectedHandled: false },
  {
    name: "257 marked nodes",
    content: Array.from({ length: 257 }, (_, index) => text("a", index % 2 ? "bold" : "italic")),
    expectedHandled: false,
  },
];
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
const results: unknown[] = [];
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => {
  const output = process.env.SEMLO_MULTILINE_DIAGNOSTICS;
  if (output) await writeFile(`${output}/heading-multiline-limit-results.json`, JSON.stringify(results, null, 2));
  await stop?.();
});
async function run(page: Page, item: Sample, native: boolean) {
  const doc: JSONContent = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: item.content },
      { type: "paragraph", content: [text("NEXT")] },
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ doc, native }) => {
      // 保持矩形数量低于另一项几何上限，单独验证模型长度边界。
      window.__semloRequireFixture("mountHeadingEndBoundary")(doc, 360, native);
      const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
      const original = view.coordsAtPos.bind(view);
      let calls = 0;
      let started = 0;
      const timing: { elapsed?: number; calls?: number; prevented?: boolean; trusted?: boolean } = {};
      window.headingLimitTiming = timing;
      view.coordsAtPos = (pos, side) => {
        calls++;
        return original(pos, side);
      };
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "End" && event.shiftKey) {
            calls = 0;
            started = performance.now();
          }
        },
        true,
      );
      view.dom.addEventListener("keydown", (event) => {
        if (event.key === "End" && event.shiftKey)
          Object.assign(timing, {
            elapsed: performance.now() - started,
            calls,
            prevented: event.defaultPrevented,
            trusted: event.isTrusted,
          });
      });
    },
    { doc, native },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  if (item.expectedHandled) {
    const rectCount = await page.locator("#heading-end-boundary .semlo-editor-prose h3").evaluate((heading) => {
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      let count = 0;
      while (walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        count += range.getClientRects().length;
      }
      return count;
    });
    expect(rectCount).toBeLessThanOrEqual(256);
  }
  await page.locator("#heading-end-boundary .semlo-editor-prose h3").click({ position: { x: 100, y: 8 } });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await page.evaluate(() =>
    window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON(),
  );
  const initial = await page.evaluate(() => {
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    const selection = document.getSelection()!;
    return {
      pm: [view.state.selection.anchor, view.state.selection.head],
      dom: [
        view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
        view.posAtDOM(selection.focusNode!, selection.focusOffset),
      ],
    };
  });
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await page.evaluate(() => {
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    const selection = document.getSelection()!;
    return {
      text: selection.toString(),
      json: window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON(),
      pm: [view.state.selection.anchor, view.state.selection.head],
      dom: [
        view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
        view.posAtDOM(selection.focusNode!, selection.focusOffset),
      ],
      type: [view.state.selection.$anchor.parent.type.name, view.state.selection.$head.parent.type.name],
      timing: window.__semloRequireFixture("headingLimitTiming"),
    };
  });
  return { before, initial, after };
}
for (const item of samples)
  test(item.name, async ({ page }) => {
    const candidate = await run(page, item, false);
    results.push({ name: item.name, ...candidate.after });
    expect(candidate.after.timing.trusted).toBe(true);
    expect(candidate.after.json).toEqual(candidate.before);
    expect(candidate.after.timing.prevented).toBe(true);
    if (!item.expectedHandled) {
      // 超过几何验证上限时只停止本次行选择，不退回可能跨正文的原生扩选。
      expect(candidate.after.text).toBe("");
      expect(candidate.after.pm).toEqual(candidate.initial.pm);
      expect(candidate.after.dom).toEqual(candidate.initial.dom);
      expect(candidate.after.type).toEqual(["heading", "heading"]);
      expect(candidate.after.timing.calls).toBeLessThan(40);
    } else {
      expect(candidate.after.type).toEqual(["heading", "heading"]);
      expect(candidate.after.text).toBeTruthy();
      expect(
        item.content
          .map((node) => node.text ?? "")
          .join("")
          .startsWith(candidate.after.text ?? ""),
      ).toBe(true);
      expect(candidate.after.text).not.toContain("NEXT");
      expect(candidate.after.timing.calls).toBeLessThan(40);
      await page.keyboard.press("Backspace");
      expect(
        (
          await page.evaluate(
            () => window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON() as JSONContent,
          )
        ).content?.at(-1)?.content?.[0].text,
      ).toBe("NEXT");
      await page.keyboard.press("ControlOrMeta+z");
      expect(
        await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON()),
      ).toEqual(candidate.before);
    }
  });
