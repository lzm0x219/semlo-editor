import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-history-fixture";

declare global {
  interface Window {
    releaseOldStatus?: () => void;
  }
}

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
  test(`${kind} late status from a deleted card cannot update its undo-restored replacement`, async ({ page }) => {
    await mount(page, kind);
    await page.evaluate((kind) => {
      const host = window.__semloRequireFixture("historyCardHost");
      const editor = window.__semloRequireFixture("historyCardEditor");
      let calls = 0;
      const getStatus = async (_id: string, signal: AbortSignal) => {
        calls++;
        document.body.dataset.statusCalls = String(calls);
        if (calls === 1)
          return await new Promise<{ checkedIn: boolean; canVote: boolean; selectedOptionIds: string[] }>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                document.body.dataset.oldAborted = "yes";
              },
              { once: true },
            );
            window.releaseOldStatus = () => resolve({ checkedIn: true, canVote: false, selectedOptionIds: [] });
          });
        return { checkedIn: false, canVote: true, selectedOptionIds: [] };
      };
      host.setHost({
        createActivity: async () => ({ cardId: "unused" }),
        verifyConfiguration: async () => true,
        syncConfiguration: async () => {},
        vote: { getStatus, submitVote: async (_id, ids) => ({ canVote: false, selectedOptionIds: ids }) },
        checkin: { getStatus, checkIn: async () => ({ checkedIn: true }) },
      });
      if (kind === "vote") editor.setEditable(false);
    }, kind);
    await page.waitForFunction(() => document.body.dataset.statusCalls === "1");
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("historyCardEditor");
      editor.commands.setContent("<p>临时内容</p>");
      window.__semloRequireFixture("historyCardUndo")();
    });
    await page.waitForFunction(() => Number(document.body.dataset.statusCalls) >= 2);
    expect(await page.evaluate(() => document.body.dataset.oldAborted)).toBe("yes");
    await page.evaluate(() => window.__semloRequireFixture("releaseOldStatus")());
    await page.waitForTimeout(100);
    if (kind === "vote") {
      await expect(page.locator(".semlo-editor-vote-card input").first()).toBeEnabled();
      expect(await page.getByText("当前不可投票").count()).toBe(0);
    } else {
      await expect(page.getByRole("button", { name: "我已读", exact: true })).toBeEnabled();
      expect(await page.getByRole("button", { name: "已打卡" }).count()).toBe(0);
    }
  });
}

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} late status from a replaced host cannot overwrite the new host`, async ({ page }) => {
    await mount(page, kind);
    await page.evaluate((kind) => {
      const host = window.__semloRequireFixture("historyCardHost");
      const oldStatus = async (_id: string, signal: AbortSignal) => {
        document.body.dataset.oldStarted = "yes";
        signal.addEventListener(
          "abort",
          () => {
            document.body.dataset.oldAborted = "yes";
          },
          { once: true },
        );
        return await new Promise<{ checkedIn: boolean; canVote: boolean; selectedOptionIds: string[] }>((resolve) => {
          window.releaseOldStatus = () => resolve({ checkedIn: true, canVote: false, selectedOptionIds: [] });
        });
      };
      host.setHost({
        createActivity: async () => ({ cardId: "unused" }),
        verifyConfiguration: async () => true,
        syncConfiguration: async () => {},
        vote: { getStatus: oldStatus, submitVote: async (_id, ids) => ({ canVote: false, selectedOptionIds: ids }) },
        checkin: { getStatus: oldStatus, checkIn: async () => ({ checkedIn: true }) },
      });
      if (kind === "vote") window.__semloRequireFixture("historyCardEditor").setEditable(false);
    }, kind);
    await page.waitForFunction(() => document.body.dataset.oldStarted === "yes");
    await page.evaluate(() => {
      window.__semloRequireFixture("historyCardHost").setHost({
        createActivity: async () => ({ cardId: "unused" }),
        verifyConfiguration: async () => true,
        syncConfiguration: async () => {},
        vote: {
          getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
          submitVote: async (_id, ids) => ({ canVote: false, selectedOptionIds: ids }),
        },
        checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
      });
    });
    expect(await page.evaluate(() => document.body.dataset.oldAborted)).toBe("yes");
    if (kind === "vote") await expect(page.locator(".semlo-editor-vote-card input").first()).toBeEnabled();
    else await expect(page.getByRole("button", { name: "我已读", exact: true })).toBeEnabled();
    await page.evaluate(() => window.__semloRequireFixture("releaseOldStatus")());
    await page.waitForTimeout(100);
    if (kind === "vote") await expect(page.locator(".semlo-editor-vote-card input").first()).toBeEnabled();
    else await expect(page.getByRole("button", { name: "我已读", exact: true })).toBeEnabled();
  });
}
