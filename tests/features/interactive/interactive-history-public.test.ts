import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-history-public-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-public-history-"));
  const builder = await createInlineFixtureRsbuild(
    "integration",
    resolve("tests/fixtures/interactive/interactive-history-public-fixture.ts"),
    directory,
    { framework: true },
  );
  await builder.build();
  bundle = await readInlineFixtureBundle(directory);
  styles = [
    readEditorStyles(),
    await readFile(resolve("packages/core/src/features/blocks/actions/block-actions.css"), "utf8"),
  ].join("\n");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: Page, kind: "vote" | "checkin") {
  await page.setContent('<div id="editor" style="width:900px;margin:100px"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((kind) => window.__semloRequireFixture("mountPublicHistory")(kind), kind);
  await page.waitForFunction(() => Boolean(window.publicHistoryEditor));
}

for (const kind of ["vote", "checkin"] as const) {
  test(`public editor synchronizes ${kind} undo and redo`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    await page.getByLabel("标题").fill("更改标题");
    if (kind === "checkin") await page.getByRole("button", { name: "确定" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("publicHistorySyncs").length === 1);
    await page.evaluate(() => window.__semloRequireFixture("publicHistoryEditor").editor.commands.undo());
    await page.waitForFunction(() => window.__semloRequireFixture("publicHistorySyncs").length === 2, undefined, {
      timeout: 4000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("publicHistorySyncs")[1].title)).toBe("原始标题");
    await page.evaluate(() => window.__semloRequireFixture("publicHistoryEditor").editor.commands.redo());
    await page.waitForFunction(() => window.__semloRequireFixture("publicHistorySyncs").length === 3, undefined, {
      timeout: 4000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("publicHistorySyncs")[2].title)).toBe("更改标题");
  });
}
