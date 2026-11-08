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
  test(`${kind} undo and redo restore and synchronize the original activity configuration`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    await page.getByLabel("标题").fill("新标题");
    if (kind === "checkin") await page.getByRole("button", { name: "确定" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[0].config.title)).toBe("新标题");
    await page.evaluate(() => window.__semloRequireFixture("historyCardUndo")());
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 2, undefined, {
      timeout: 3000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[1].config.title)).toBe("原标题");
    await page.evaluate(() => window.__semloRequireFixture("historyCardRedo")());
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 3, undefined, {
      timeout: 3000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[2].config.title)).toBe("新标题");
  });
}

test("check-in edit does not synchronize a different activity after a reentrant replacement", async ({ page }) => {
  await mount(page, "checkin");
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("本地改动");
  await page.evaluate(() => {
    const replace = () => {
      window.__semloRequireFixture("historyCardEditor").off("update", replace);
      window
        .__semloRequireFixture("historyCardEditor")
        .commands.updateAttributes("semloEditorCheckin", { cardId: "other", title: "外部内容" });
    };
    window.__semloRequireFixture("historyCardEditor").on("update", replace);
  });
  await page.getByRole("button", { name: "确定" }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
});

test("check-in edit does not synchronize to a reentrantly replaced host", async ({ page }) => {
  await mount(page, "checkin");
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await page.getByLabel("标题").fill("本地改动");
  await page.evaluate(() => {
    const replace = () => {
      window.__semloRequireFixture("historyCardEditor").off("update", replace);
      window.__semloRequireFixture("replaceHistoryHost")();
    };
    window.__semloRequireFixture("historyCardEditor").on("update", replace);
  });
  await page.getByRole("button", { name: "确定" }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
});

test("a rapid vote undo cancels the unsent edit and synchronizes the restored value", async ({ page }) => {
  await mount(page, "vote");
  await page.getByLabel("标题").fill("短暂修改");
  await page.evaluate(() => window.__semloRequireFixture("historyCardUndo")());
  await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length >= 1);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs").map((item) => item.config.title)),
  ).toEqual(["原标题"]);
});

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} external document changes do not write to the host`, async ({ page }) => {
    await mount(page, kind);
    await page.evaluate(
      (kind) =>
        window
          .__semloRequireFixture("historyCardEditor")
          .commands.updateAttributes(kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", {
            title: "外部文档变更",
          }),
      kind,
    );
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs"))).toEqual([]);
  });
}

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} history restoration never writes through a reentrantly replaced host`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    await page.getByLabel("标题").fill("新标题");
    if (kind === "checkin") await page.getByRole("button", { name: "确定" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
    await page.evaluate(() => {
      window.swapHostOnHistory = true;
      window.__semloRequireFixture("historyCardUndo")();
    });
    await page.waitForTimeout(700);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs").map((item) => item.service)),
    ).toEqual(["old"]);
  });
}

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} history sync survives a reentrant non-document transaction`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    await page.getByLabel("标题").fill("新标题");
    if (kind === "checkin") await page.getByRole("button", { name: "确定" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 1);
    await page.evaluate(() => {
      window.noopOnHistory = true;
      window.__semloRequireFixture("historyCardUndo")();
    });
    await page.waitForFunction(() => window.__semloRequireFixture("historyCardSyncs").length === 2, undefined, {
      timeout: 3000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("historyCardSyncs")[1].config.title)).toBe("原标题");
  });
}
