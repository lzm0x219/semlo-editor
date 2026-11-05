import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-line-interior-fixture";
let origin = "",
  stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const r = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-line-interior-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await r.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));
const samples = [
  { name: "flex-order", css: "h3{display:flex!important} h3 strong{order:2!important} h3 em{order:1!important}" },
  { name: "row-reverse", css: "h3{display:flex!important;flex-direction:row-reverse!important}" },
  {
    name: "grid-placement",
    css: "h3{display:grid!important;grid-template-columns:repeat(2,max-content)!important} h3 strong{grid-column:2!important} h3 em{grid-column:1!important}",
  },
  { name: "float", css: "h3 strong{float:right!important} h3 em{float:left!important}" },
  {
    name: "relative",
    css: "h3 strong{position:relative!important;left:70px!important} h3 em{position:relative!important;left:-35px!important}",
  },
] as const;
for (const sample of samples)
  test(`line-interior handling does not guess reordered ${sample.name}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountLineInterior === "function");
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3 },
          content: [
            { type: "text", text: "AB", marks: [{ type: "bold" }] },
            { type: "text", text: "CD", marks: [{ type: "italic" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
      ],
    };
    await page.evaluate((value) => window.__semloRequireFixture("mountLineInterior")(value, "early"), content);
    await page.addStyleTag({ content: `#heading-line-interior ${sample.css.replaceAll("h3", "h3")}` });
    await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
    const before = await page.evaluate(() => {
      const e = window.__semloRequireFixture("lineInterior").controller.editor,
        h = e.view.dom.querySelector("h3")!,
        strong = h.querySelector("strong")!,
        em = h.querySelector("em")!,
        node = strong.firstChild!;
      const range = document.createRange();
      range.setStart(node, 1);
      range.setEnd(node, 2);
      const target = range.getBoundingClientRect(),
        a = strong.getBoundingClientRect(),
        b = em.getBoundingClientRect();
      return {
        json: e.getJSON(),
        point: { x: target.left + target.width * 0.2, y: (target.top + target.bottom) / 2 },
        geometry: {
          strong: { left: a.left, right: a.right, top: a.top },
          em: { left: b.left, right: b.right, top: b.top },
          display: getComputedStyle(h).display,
          flexDirection: getComputedStyle(h).flexDirection,
          strongOrder: getComputedStyle(strong).order,
          emOrder: getComputedStyle(em).order,
        },
      };
    });
    await page.mouse.click(before.point.x, before.point.y);
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
    const after = await page.evaluate(() => {
      const f = window.__semloRequireFixture("lineInterior"),
        e = f.controller.editor;
      return {
        json: e.getJSON(),
        keys: f.keys,
        events: f.events.map((x) => ({ trusted: x.isTrusted, prevented: x.defaultPrevented })),
        focused: e.view.hasFocus(),
      };
    });
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
    const undone = await page.evaluate(() => window.__semloRequireFixture("lineInterior").controller.editor.getJSON());
    expect(before.geometry.strong.left).toBeGreaterThan(before.geometry.em.left);
    expect(after.focused).toBe(true);
    expect(after.events).toHaveLength(1);
    expect(after.events[0].trusted).toBe(true);
    if (after.events[0].prevented) {
      const selection = after.keys.find((key) => key.key === "Backspace")!;
      expect(selection.text).toBe("B");
      expect(after.json.content?.at(-1)?.type).toBe("paragraph");
    }
    expect(undone).toEqual(before.json);
  });
