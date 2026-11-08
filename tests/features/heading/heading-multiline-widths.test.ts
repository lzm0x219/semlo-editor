import { writeFile } from "node:fs/promises";

import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    headingWidthEvent?: { event?: KeyboardEvent };
  }
}

const widths = [260, 280, 300, 320, 340, 360, 400, 440, 480, 520, 580, 620];
const text = (value: string, mark?: string): JSONContent => ({
  type: "text",
  text: value,
  ...(mark ? { marks: [{ type: mark }] } : {}),
});
const cases = ["combining", "zwj", "surrogate"] as const;
function content(kind: (typeof cases)[number]): JSONContent {
  const runs: JSONContent[] = [];
  for (let index = 0; index < 18; index++) {
    runs.push(text("甲 "));
    if (kind === "combining") runs.push(text("e", "bold"), text("\u0301 ", "italic"));
    else if (kind === "zwj") runs.push(text("👨", "bold"), text("\u200d👩\u200d", "italic"), text("👧\u200d👦 "));
    else runs.push(text("\ud83d", "bold"), text("\ude00 ", "italic"));
  }
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: runs },
      { type: "paragraph", content: [text("NEXT")] },
    ],
  };
}
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
  if (output) await writeFile(`${output}/heading-multiline-widths-results.json`, JSON.stringify(results, null, 2));
  await stop?.();
});
async function run(page: Page, sample: JSONContent, width: number, native: boolean) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ sample, width, native }) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(sample, width, native);
      const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
      const holder: { event?: KeyboardEvent } = {};
      window.headingWidthEvent = holder;
      view.dom.addEventListener("keydown", (event) => {
        if (event.key === "End") holder.event = event;
      });
    },
    { sample, width, native },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  await page
    .locator("#heading-end-boundary .semlo-editor-prose h3")
    .first()
    .click({ position: { x: 50, y: 8 } });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const initial = await page.evaluate(() =>
    window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON(),
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const selected = await page.evaluate(() => {
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    const sel = view.state.selection;
    const heading = view.state.doc.firstChild!;
    const text = heading.textBetween(0, heading.content.size, "", "\n");
    const boundaries = [
      0,
      ...Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
        (segment) => segment.index + segment.segment.length,
      ),
    ];
    const inHeading = sel.$anchor.parent.type.name === "heading" && sel.$anchor.sameParent(sel.$head);
    const startRect = inHeading ? view.coordsAtPos(sel.anchor, 1) : null;
    const endRect = inHeading ? view.coordsAtPos(sel.head, -1) : null;
    const next = inHeading ? boundaries.find((boundary) => boundary > sel.$head.parentOffset) : undefined;
    const nextRect = next === undefined ? null : view.coordsAtPos(sel.$head.start() + next, -1);
    return {
      json: view.state.doc.toJSON(),
      prevented: window.__semloRequireFixture("headingWidthEvent").event?.defaultPrevented,
      text: document.getSelection()?.toString(),
      from: sel.$anchor.parentOffset,
      to: sel.$head.parentOffset,
      inHeading,
      boundaries,
      full: text,
      start: startRect && { top: startRect.top, bottom: startRect.bottom },
      end: endRect && { top: endRect.top, bottom: endRect.bottom },
      next: nextRect && { top: nextRect.top, bottom: nextRect.bottom },
    };
  });
  return { initial, selected };
}
for (const kind of cases)
  for (const width of widths) {
    test(`${kind} at ${width}px`, async ({ page }) => {
      const sample = content(kind);
      const candidate = await run(page, sample, width, false);
      const { selected } = candidate;
      if (selected.prevented) {
        expect(selected.inHeading).toBe(true);
        expect(selected.boundaries).toContain(selected.from);
        expect(selected.boundaries).toContain(selected.to);
        expect(selected.text).toBe(selected.full.slice(selected.from, selected.to));
        const middle = (selected.start!.top + selected.start!.bottom) / 2;
        expect(selected.end!.top).toBeLessThanOrEqual(middle);
        expect(selected.end!.bottom).toBeGreaterThanOrEqual(middle);
        if (selected.next) expect(selected.next.top).toBeGreaterThan(middle);
        await page.keyboard.press("Backspace");
        const after = await page.evaluate(
          () => window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON() as JSONContent,
        );
        expect(after.content?.[1].content?.[0].text).toBe("NEXT");
        await page.keyboard.press("ControlOrMeta+z");
        expect(
          await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON()),
        ).toEqual(candidate.initial);
      } else {
        expect(
          await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON()),
        ).toEqual(candidate.initial);
      }
      results.push({
        kind,
        width,
        handled: selected.prevented,
        inHeading: selected.inHeading,
        from: selected.from,
        to: selected.to,
        text: selected.text,
      });
    });
  }
