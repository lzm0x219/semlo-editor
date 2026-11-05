import { readdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { runInThisContext } from "node:vm";

import { test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

// Rstest owns discovery and runs each TypeScript browser fixture in an isolated context.
const fixtureDir = join(process.cwd(), "tests", "browser", "cases");
const fixtures = readdirSync(fixtureDir)
  .filter((name) => /^browser-.*\.ts$/.test(name) && !/[.](?:test|spec|d)\.ts$/.test(name))
  .sort();
if (!fixtures.length) throw new Error("No browser regression fixtures were found");

for (const name of fixtures) {
  test(name, async ({ page, skip }) => {
    const origin = process.env.SEMLO_TEST_ORIGIN;
    if (!origin) throw new Error("Rstest browser server was not started");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(origin);
    const path = join(fixtureDir, name);
    const body = readFileSync(path, "utf8");
    const compiled = stripTypeScriptTypes(`(${body}\n)`);
    const run = runInThisContext(compiled, { filename: path }) as (page: Page) => Promise<unknown>;
    const result = (await run(page)) as Record<string, unknown> | undefined;
    if (errors.length) throw new Error(`Browser errors in ${name}: ${errors.join("; ")}`);
    if (typeof result?.skipped === "string") {
      process.stderr.write(`${name}: skipped: ${result.skipped}\n`);
      skip();
    }
    if (result?.realNativeItalicAndCombined === false)
      process.stderr.write(
        `${name}: native italic and bold-italic font checks were skipped: suitable fonts unavailable\n`,
      );
  });
}
