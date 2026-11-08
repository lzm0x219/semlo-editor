import { test, expect } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../fixtures/browser/fixture-rsbuild";
declare global {
  interface Window {
    slashFrameworkIndependent: {
      mount(name: string, id: string): Promise<void>;
      html(id: string): string;
      snapshot(id: string): string;
      changes(id: string): string[];
      dispose(): void;
    };
  }
}
const setup = async () => {
  const r = await createFixtureRsbuild("./tests/fixtures/insertion/slash-framework-independent-fixture.ts", {
    framework: true,
    publicDir: false,
  });
  return r.startDevServer();
};
for (const framework of ["react", "vue", "solid"])
  test(`${framework}: controlled echo preserves text and isolates undo/redo in two editors`, async ({ page }) => {
    await installFixtureGuards(page);
    const { port, server } = await setup();
    try {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(async (f) => {
        await window.slashFrameworkIndependent.mount(f, "first");
        await window.slashFrameworkIndependent.mount(f, "second");
      }, framework);
      await page.locator("#second .semlo-editor-prose p").nth(1).click();
      await page.keyboard.type("xyz");
      const other = "<p>前文</p><p>xyz</p><p>乙</p>";
      await expect.poll(() => page.evaluate(() => window.slashFrameworkIndependent.snapshot("second"))).toBe(other);
      const otherChanges = await page.evaluate(() => window.slashFrameworkIndependent.changes("second").slice());
      await page.locator("#first .semlo-editor-prose p").nth(1).click();
      await page.keyboard.type("/p");
      await expect
        .poll(() => page.evaluate(() => window.slashFrameworkIndependent.html("first")))
        .toBe("<p>前文</p><p>/p</p><p>乙</p>");
      expect(await page.evaluate(() => window.slashFrameworkIndependent.snapshot("first"))).toBe(
        "<p>前文</p><p></p><p>乙</p>",
      );
      await page.keyboard.press("Enter");
      await page.keyboard.type("abc");
      const edited = "<p>前文</p><p>abc</p><p>乙</p>";
      await expect.poll(() => page.evaluate(() => window.slashFrameworkIndependent.snapshot("first"))).toBe(edited);
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(() => page.evaluate(() => window.slashFrameworkIndependent.html("first")))
        .toBe("<p>前文</p><p>/</p><p>乙</p>");
      await expect
        .poll(() => page.evaluate(() => window.slashFrameworkIndependent.changes("first").at(-1)))
        .toBe("<p>前文</p><p></p><p>乙</p>");
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(() => page.evaluate(() => window.slashFrameworkIndependent.html("first"))).toBe(edited);
      await expect
        .poll(() => page.evaluate(() => window.slashFrameworkIndependent.changes("first").at(-1)))
        .toBe(edited);
      expect(await page.evaluate(() => window.slashFrameworkIndependent.snapshot("first"))).toBe(edited);
      expect(await page.evaluate(() => window.slashFrameworkIndependent.changes("first"))).toContain(edited);
      expect(await page.evaluate(() => window.slashFrameworkIndependent.html("second"))).toBe(other);
      expect(await page.evaluate(() => window.slashFrameworkIndependent.changes("second"))).toEqual(otherChanges);
    } finally {
      await page.evaluate(() => window.slashFrameworkIndependent?.dispose());
      await server.close();
    }
  });

for (const framework of ["react", "vue", "solid"])
  test(`${framework}: Escape commits an active query through controlled snapshot echo`, async ({ page }) => {
    await installFixtureGuards(page);
    const { port, server } = await setup();
    try {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate((name) => window.slashFrameworkIndependent.mount(name, "draft"), framework);
      await page.locator("#draft .semlo-editor-prose p").nth(1).click();
      await page.keyboard.type("/p");
      await expect
        .poll(() => page.evaluate(() => window.slashFrameworkIndependent.html("draft")))
        .toBe("<p>前文</p><p>/p</p><p>乙</p>");
      expect(await page.evaluate(() => window.slashFrameworkIndependent.snapshot("draft"))).toBe(
        "<p>前文</p><p></p><p>乙</p>",
      );
      await page.keyboard.press("Escape");
      const committed = "<p>前文</p><p>/p</p><p>乙</p>";
      await expect.poll(() => page.evaluate(() => window.slashFrameworkIndependent.snapshot("draft"))).toBe(committed);
      await expect
        .poll(() => page.evaluate(() => window.slashFrameworkIndependent.changes("draft").at(-1)))
        .toBe(committed);
      expect(await page.evaluate(() => window.slashFrameworkIndependent.html("draft"))).toBe(committed);
    } finally {
      await page.evaluate(() => window.slashFrameworkIndependent?.dispose());
      await server.close();
    }
  });
