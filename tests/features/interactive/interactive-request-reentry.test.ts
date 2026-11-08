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
  test(`${kind} abort reentry keeps only the latest status request`, async ({ page }) => {
    await mount(page, kind);
    await page.evaluate((kind) => {
      const host = window.__semloRequireFixture("historyCardHost");
      let calls = 0;
      const service = {
        getStatus: async (_id: string, signal: AbortSignal) => {
          calls++;
          document.body.dataset.statusCalls = String(calls);
          if (calls === 1) signal.addEventListener("abort", () => host.refresh("activity"), { once: true });
          return await new Promise<never>(() => {});
        },
        checkIn: async () => ({ checkedIn: true }),
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      };
      host.setHost({
        createActivity: async () => ({ cardId: "unused" }),
        verifyConfiguration: async () => true,
        syncConfiguration: async () => {},
        ...(kind === "vote" ? { vote: service } : { checkin: service }),
      });
    }, kind);
    await page.waitForFunction(() => document.body.dataset.statusCalls === "1");
    await page.evaluate(() => window.__semloRequireFixture("historyCardHost").refresh("activity"));
    await page.waitForFunction(() => Number(document.body.dataset.statusCalls) >= 2);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Number(document.body.dataset.statusCalls))).toBe(2);
  });
}

test("vote editing does not overwrite a card replaced by an abort callback", async ({ page }) => {
  await mount(page, "vote");
  await page.evaluate(() => {
    const host = window.__semloRequireFixture("historyCardHost");
    const editor = window.__semloRequireFixture("historyCardEditor");
    host.setHost({
      createActivity: async () => ({ cardId: "unused" }),
      verifyConfiguration: async () => true,
      syncConfiguration: async () => {},
      vote: {
        getStatus: async (_id, signal) => {
          document.body.dataset.waitingStatus = "yes";
          signal.addEventListener(
            "abort",
            () => {
              editor.commands.updateAttributes("semloEditorVote", { cardId: "other", title: "外部内容" });
            },
            { once: true },
          );
          return await new Promise<never>(() => {});
        },
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      },
    });
  });
  await page.waitForFunction(() => document.body.dataset.waitingStatus === "yes");
  await page.getByLabel("标题").fill("过期输入");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("historyCardEditor").getJSON().content?.[0].attrs?.title),
  ).toBe("外部内容");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("historyCardEditor").getJSON().content?.[0].attrs?.cardId),
  ).toBe("other");
});
