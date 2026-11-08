import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/cards-multi-editor-fixture.ts"));
});
afterAll(async () => closeServer?.());

for (const type of ["semloEditorFormula", "semloEditorBlockFormula"] as const) {
  for (const latex of [null, 17, { future: "preserve" }] as const) {
    test(`${type} displays and preserves non-string latex ${JSON.stringify(latex)}`, async ({ page }) => {
      await installFixtureGuards(page);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
      const result = await page.evaluate(
        ({ kind, raw }) => {
          const c = window.__semloRequireFixture("cardMultiEditors")[0];
          const node = { type: kind, attrs: { latex: raw, id: "malformed" } };
          const content = kind === "semloEditorFormula" ? [{ type: "paragraph", content: [node] }] : [node];
          c.setContent({ type: "doc", content });
          const json = c.getSnapshot().json;
          const value =
            kind === "semloEditorFormula" ? json.content![0].content![0].attrs!.latex : json.content![0].attrs!.latex;
          return { value, html: c.getSnapshot().html };
        },
        { kind: type, raw: latex },
      );
      expect(result.value).toEqual(latex);
      const button = page.locator('[data-editor-name="甲"] [data-formula-id="malformed"] .semlo-editor-formula');
      await expect(button).toBeVisible();
      await expect(page.locator('[data-editor-name="甲"] .semlo-editor-error')).toBeHidden();
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("aria-label", "公式数据格式无法识别");
      const after = await page.evaluate(
        ({ kind, html }) => {
          const c = window.__semloRequireFixture("cardMultiEditors")[0];
          c.setContent(html);
          const json = c.getSnapshot().json;
          return kind === "semloEditorFormula"
            ? json.content![0].content![0].attrs!.latex
            : json.content![0].attrs!.latex;
        },
        { kind: type, html: result.html },
      );
      expect(after).toEqual(latex);
      expect(pageErrors).toEqual([]);
    });
  }
}
