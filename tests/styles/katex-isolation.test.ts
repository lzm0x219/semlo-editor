import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@rstest/playwright";

test("KaTeX preserves host counters and formula rendering in the demo and built stylesheet", async ({ page }) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "semlo-style-"));
  try {
    execFileSync(process.execPath, ["packages/core/scripts/copy-style.ts", tempDirectory]);
    const built = readFileSync(join(tempDirectory, "style.css"), "utf8");
    const upstream = readFileSync("packages/core/node_modules/katex/dist/katex.min.css", "utf8");
    const local = readFileSync("packages/core/src/styles/katex.css", "utf8");
    expect(readFileSync(join(tempDirectory, "KATEX-LICENSE.txt"), "utf8")).toBe(
      readFileSync("packages/core/node_modules/katex/LICENSE", "utf8"),
    );
    expect(readFileSync("packages/core/licenses/KATEX-LICENSE.txt", "utf8")).toBe(
      readFileSync("packages/core/node_modules/katex/LICENSE", "utf8"),
    );
    expect(built).toContain("url(fonts/KaTeX_Main-Regular.woff2)");
    expect(readFileSync(join(tempDirectory, "fonts/KaTeX_Main-Regular.woff2")).length).toBeGreaterThan(0);

    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    const expected = upstream
      .replace("body{counter-reset:katexEqnNo mmlEqnNo}", ".semlo-editor{counter-reset:katexEqnNo mmlEqnNo}")
      .replaceAll("url(fonts/", "url(../../node_modules/katex/dist/fonts/");
    expect(
      await page.evaluate(
        ({ first, second }) => {
          const a = new CSSStyleSheet();
          const b = new CSSStyleSheet();
          a.replaceSync(first);
          b.replaceSync(second);
          return (
            Array.from(a.cssRules, (rule) => rule.cssText).join("\n") ===
            Array.from(b.cssRules, (rule) => rule.cssText).join("\n")
          );
        },
        { first: expected, second: local },
      ),
    ).toBe(true);

    await page.evaluate(() => {
      const hostStyle = document.createElement("style");
      hostStyle.textContent = "body { counter-reset: host-counter 7; }";
      document.head.prepend(hostStyle);
    });
    await page.getByRole("combobox", { name: "选择示例" }).selectOption("formula");
    const formula = page.locator("#editor-host .semlo-editor-formula-node .katex").first();
    await expect(formula).toBeVisible();
    const demo = await formula.evaluate(async (element) => {
      await document.fonts.ready;
      return {
        html: element.outerHTML,
        family: getComputedStyle(element).fontFamily,
        width: element.getBoundingClientRect().width,
        loaded: document.fonts.check("16px KaTeX_Main"),
        body: getComputedStyle(document.body).counterReset,
        editor: getComputedStyle(element.closest(".semlo-editor")!).counterReset,
      };
    });
    expect(demo.body).toBe("host-counter 7");
    expect(demo.editor).toContain("katexEqnNo");
    expect(demo.family).toContain("KaTeX_Main");
    expect(demo.width).toBeGreaterThan(0);
    expect(demo.loaded).toBe(true);

    await page.route("**/semlo-style-test/fonts/**", (route) =>
      route.fulfill({ path: join(tempDirectory, "fonts", new URL(route.request().url()).pathname.split("/").pop()!) }),
    );
    await page.setContent(
      `<style>body { counter-reset: host-counter 7; }</style><div class="semlo-editor">${demo.html}</div>`,
    );
    await page.addStyleTag({ content: built.replaceAll("url(fonts/", "url(/semlo-style-test/fonts/") });
    const builtFormula = await page.locator(".semlo-editor .katex").evaluate(async (element) => {
      await document.fonts.ready;
      return {
        family: getComputedStyle(element).fontFamily,
        width: element.getBoundingClientRect().width,
        loaded: document.fonts.check("16px KaTeX_Main"),
        body: getComputedStyle(document.body).counterReset,
        editor: getComputedStyle(element.closest(".semlo-editor")!).counterReset,
      };
    });
    expect(builtFormula.body).toBe(demo.body);
    expect(builtFormula.editor).toBe(demo.editor);
    expect(builtFormula.family).toBe(demo.family);
    expect(builtFormula.width).toBeGreaterThan(0);
    expect(builtFormula.loaded).toBe(true);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
