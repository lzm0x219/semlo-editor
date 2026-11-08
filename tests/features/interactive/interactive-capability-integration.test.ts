import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-public-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-public-interactive-"));
  const builder = await createInlineFixtureRsbuild(
    "integration",
    resolve("tests/fixtures/interactive/interactive-public-fixture.ts"),
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
async function mount(page: Page, mode: "core" | "react" | "vue" | "solid", enabled = true) {
  await page.setContent('<div id="editor" style="width:900px;margin:100px"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ mode, enabled }) => window.__semloRequireFixture("publicMount")(mode, enabled), {
    mode,
    enabled,
  });
  await page.waitForFunction(() => Boolean(window.publicEditor));
}
for (const kind of ["vote", "checkin"] as const) {
  test(`single ${kind} service enables only its own creation`, async ({ page }) => {
    await mount(page, "core");
    await page.evaluate((kind) => {
      const vote = {
        getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      };
      const checkin = { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) };
      window.__semloRequireFixture("publicEditor").setIntegrations({
        interactiveCardHost: {
          createActivity: async () => ({ cardId: "created" }),
          verifyConfiguration: async () => true,
          syncConfiguration: async () => {},
          ...(kind === "vote" ? { vote } : { checkin }),
        },
        onInteractiveCardAbandoned: () => {},
      });
    }, kind);
    await page.getByRole("button", { name: "插入内容" }).click();
    const panel = page.getByRole("dialog", { name: "插入内容" });
    await expect(panel.locator(`.semlo-editor-card-item[data-command="${kind}"]`)).toBeEnabled();
    await expect(
      panel.locator(`.semlo-editor-card-item[data-command="${kind === "vote" ? "checkin" : "vote"}"]`),
    ).toBeDisabled();
  });
}

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: removing host closes an open insertion panel and refreshed options are disabled`, async ({ page }) => {
    await mount(page, mode);
    await page.getByRole("button", { name: "插入内容" }).click();
    await expect(page.getByRole("dialog", { name: "插入内容" })).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("publicReplace")(false));
    await expect(page.getByRole("dialog", { name: "插入内容" })).toHaveCount(0);
    await page.getByRole("button", { name: "插入内容" }).click();
    await expect(
      page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="vote"]'),
    ).toBeDisabled();
  });
}

test("removing the callback closes the slash popup without removing the typed text", async ({ page }) => {
  await mount(page, "core");
  await page.evaluate(() => {
    const host = {
      createActivity: async () => ({ cardId: "created" }),
      verifyConfiguration: async () => true,
      syncConfiguration: async () => {},
      vote: {
        getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      },
    };
    Reflect.set(window, "auditHost", host);
    window
      .__semloRequireFixture("publicEditor")
      .setIntegrations({ interactiveCardHost: host, onInteractiveCardAbandoned: () => {} });
  });
  await page.locator("#editor .semlo-editor-prose p").click();
  await page.keyboard.type("/vote");
  await expect(page.locator('.semlo-editor-slash-menu .semlo-editor-card-item[data-command="vote"]')).toBeEnabled();
  await page.evaluate(() =>
    window.__semloRequireFixture("publicEditor").setIntegrations({
      interactiveCardHost: Reflect.get(window, "auditHost"),
      onInteractiveCardAbandoned: undefined,
    }),
  );
  await expect(page.locator(".semlo-editor-slash-menu")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("publicEditor").getSnapshot().text)).toContain("/vote");
  expect(await page.evaluate(() => window.__semloRequireFixture("activityPending").length)).toBe(0);
});
