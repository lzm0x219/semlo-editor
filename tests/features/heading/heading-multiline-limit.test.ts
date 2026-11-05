import { writeFile } from "node:fs/promises";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
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
      window.__semloRequireFixture("mountHeadingEndBoundary")(doc, 260, native);
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
  await page.locator("#heading-end-boundary .semlo-editor-prose h3").click({ position: { x: 50, y: 8 } });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await page.evaluate(() =>
    window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON(),
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await page.evaluate(() => {
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    return {
      text: document.getSelection()?.toString(),
      json: window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON(),
      pm: [view.state.selection.anchor, view.state.selection.head],
      type: [view.state.selection.$anchor.parent.type.name, view.state.selection.$head.parent.type.name],
      timing: window.__semloRequireFixture("headingLimitTiming"),
    };
  });
  return { before, after };
}
for (const item of samples)
  test(item.name, async ({ page }) => {
    const candidate = await run(page, item, false);
    results.push({ name: item.name, ...candidate.after });
    expect(candidate.after.timing.trusted).toBe(true);
    expect(candidate.after.json).toEqual(candidate.before);
    if (item.expectedHandled) expect(candidate.after.timing.prevented).toBe(true);
    if (candidate.after.timing.prevented) {
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
