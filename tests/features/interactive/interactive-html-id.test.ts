import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-history-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-history-card-"));
  const builder = await createInlineFixtureRsbuild(
    "deadline",
    resolve("tests/fixtures/interactive/interactive-history-fixture.ts"),
    directory,
  );
  await builder.build();
  bundle = await readInlineFixtureBundle(directory);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: Page, kind: "vote" | "checkin", _content?: string) {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((kind) => window.__semloRequireFixture("mountHistoryCard")(kind), kind);
}

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} without an activity ID round-trips through HTML as unbound`, async ({ page }) => {
    await mount(page, kind);
    const result = await page.evaluate((kind) => {
      const editor = window.__semloRequireFixture("historyCardEditor");
      editor.commands.updateAttributes(kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", { cardId: null });
      const html = editor.getHTML();
      editor.commands.setContent(html);
      return { html, cardId: editor.getJSON().content?.[0].attrs?.cardId };
    }, kind);
    expect(result.cardId).toBeNull();
  });
}
