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
  test(`${kind} detached participation controls cannot act on a replacement activity`, async ({ page }) => {
    await mount(page, kind);
    await page.evaluate(() => {
      const host = window.__semloRequireFixture("historyCardHost");
      const editor = window.__semloRequireFixture("historyCardEditor");
      host.setHost({
        createActivity: async () => ({ cardId: "unused" }),
        verifyConfiguration: async () => true,
        syncConfiguration: async () => {},
        vote: {
          getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
          submitVote: async (id, ids) => {
            document.body.dataset.submitted = id;
            return { canVote: false, selectedOptionIds: ids };
          },
        },
        checkin: {
          getStatus: async () => ({ checkedIn: false }),
          checkIn: async (id) => {
            document.body.dataset.submitted = id;
            return { checkedIn: true };
          },
        },
      });
      editor.setEditable(false);
    });
    if (kind === "vote") {
      await page.locator(".semlo-editor-vote-card input").first().check();
      await page.getByRole("button", { name: "投票", exact: true }).waitFor();
    } else await page.getByRole("button", { name: "我已读", exact: true }).waitFor();
    await page.evaluate((kind) => {
      const card = document.querySelector(kind === "vote" ? ".semlo-editor-vote-card" : ".semlo-editor-checkin-card")!;
      const action = [...card.querySelectorAll("button")].find(
        (button) => button.textContent === (kind === "vote" ? "投票" : "我已读"),
      )!;
      const editor = window.__semloRequireFixture("historyCardEditor");
      editor.commands.updateAttributes(kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", {
        cardId: "replacement",
      });
      action.click();
    }, kind);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.body.dataset.submitted)).toBeUndefined();
  });
}

test("a detached check-in form cannot close a replacement form", async ({ page }) => {
  await mount(page, "checkin");
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.evaluate(() => {
    const oldForm = document.querySelector<HTMLFormElement>('form[aria-label="编辑打卡"]')!;
    const oldCancel = [...oldForm.querySelectorAll("button")].find((button) => button.textContent === "取消")!;
    window
      .__semloRequireFixture("historyCardEditor")
      .commands.updateAttributes("semloEditorCheckin", { cardId: "replacement" });
    document.querySelector<HTMLButtonElement>("[data-checkin-edit]")!.click();
    oldCancel.click();
  });
  expect(await page.locator('form[aria-label="编辑打卡"]').count()).toBe(1);
});
