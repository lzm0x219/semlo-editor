import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInThisContext } from "node:vm";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

function loadFixture(): (page: Page) => Promise<{ skipped?: string }> {
  const body = readFileSync("tests/browser/cases/browser-local-font-emphasis.ts", "utf8");
  return runInThisContext(stripTypeScriptTypes(`(${body}\n)`)) as (page: Page) => Promise<{ skipped?: string }>;
}

test("an empty native font list finishes the emphasis fixture without timing out", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("Rstest browser server was not started");
  await installFixtureGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", { configurable: true, writable: true, value: async () => [] });
  });
  await page.goto(origin);
  page.setDefaultTimeout(2500);
  await expect(loadFixture()(page)).resolves.toEqual({ skipped: "No usable regular/bold local font family was found" });
});

test("a native font request that never settles reports a specific skip", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("Rstest browser server was not started");
  await installFixtureGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => new Promise(() => {}),
    });
  });
  await page.goto(origin);
  await expect(loadFixture()(page)).resolves.toEqual({
    skipped: "Native local font enumeration did not settle within 8 seconds",
  });
});

test("a hanging font request does not hide a browser error", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("Rstest browser server was not started");
  await installFixtureGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => {
        setTimeout(() => {
          throw new Error("font page error");
        }, 0);
        return new Promise(() => {});
      },
    });
  });
  await page.goto(origin);
  await expect(loadFixture()(page)).rejects.toThrow("font page error");
});

test("a rejected native font request is reported as an error", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("Rstest browser server was not started");
  await installFixtureGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => Promise.reject(new Error("font query failed")),
    });
  });
  await page.goto(origin);
  await expect(loadFixture()(page)).rejects.toThrow("Native local font enumeration failed: Error: font query failed");
});

test("a native font request that throws synchronously is reported as an error", async ({ page }) => {
  const origin = process.env.SEMLO_TEST_ORIGIN;
  if (!origin) throw new Error("Rstest browser server was not started");
  await installFixtureGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("font query threw");
      },
    });
  });
  await page.goto(origin);
  await expect(loadFixture()(page)).rejects.toThrow("Native local font enumeration failed: Error: font query threw");
});
