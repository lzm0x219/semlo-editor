import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/vote-card-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let directory: string;
let bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-vote-"));
  const builder = await createInlineFixtureRsbuild(
    "vote",
    resolve("tests/fixtures/interactive/vote-card-fixture.ts"),
    directory,
  );
  await builder.build();
  bundle = await readInlineFixtureBundle(directory);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: import("@rstest/playwright").Page, service: boolean, content?: string) {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ service, content }) => window.__semloRequireFixture("mountVote")(service, content), {
    service,
    content,
  });
}

test("edits vote directly and submits IDs only through the host", async ({ page }) => {
  await mount(page, true);
  await expect(page.getByRole("form", { name: "编辑投票" })).toBeVisible();
  await page.getByLabel("标题").fill("调查");
  await page.evaluate(() =>
    window.__semloRequireFixture("votePending")[0].resolve({ canVote: true, selectedOptionIds: [] }),
  );
  await expect(page.getByLabel("标题")).toHaveValue("调查");
  expect(await page.evaluate(() => window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!.title)).toBe(
    "调查",
  );
  await page.getByRole("button", { name: "添加选项" }).click();
  await page.getByLabel("选项 3", { exact: true }).fill("丙");
  await page.getByLabel("投票类型").selectOption("multiple");
  await page.getByLabel("截止日期", { exact: true }).fill("2030-05-01");
  await page.getByLabel("截止日期", { exact: true }).press("Enter");
  const attrs = await page.evaluate(() => window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!);
  expect(attrs).toMatchObject({ title: "调查", multiple: true, deadline: "2030-05-01" });
  await page.evaluate(() => window.__semloRequireFixture("voteEditor").setEditable(false));
  await page.waitForFunction(() => window.__semloRequireFixture("votePending").length >= 2);
  await page.evaluate(() =>
    window.__semloRequireFixture("votePending").at(-1)!.resolve({ canVote: true, selectedOptionIds: [] }),
  );
  await page.getByLabel("甲", { exact: true }).check();
  await page.getByLabel("丙", { exact: true }).check();
  await page.getByRole("button", { name: "投票", exact: true }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("voteCalls").some((call) => call.kind === "submit"));
  expect(await page.evaluate(() => window.__semloRequireFixture("voteCalls").at(-1))).toEqual({
    kind: "submit",
    id: "vote-1",
    choices: ["a", attrs.options[2].id],
  });
  await page.evaluate(() =>
    window
      .__semloRequireFixture("votePending")
      .at(-1)!
      .resolve({
        canVote: false,
        selectedOptionIds: ["a", window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!.options[2].id],
      }),
  );
  await expect(page.getByText("当前不可投票")).toBeVisible();
  const html = await page.evaluate(() => window.__semloRequireFixture("voteEditor").getHTML());
  expect(html).not.toContain("当前不可投票");
  await page.evaluate(() => window.__semloRequireFixture("voteEditor").destroy());
  await mount(page, false, html);
  await expect(page.getByLabel("标题")).toHaveValue("调查");
  await expect(page.getByLabel("截止日期", { exact: true })).toHaveValue("2030-05-01");
  await page.evaluate(() => window.__semloRequireFixture("voteEditor").setEditable(false));
  await expect(page.getByText("投票服务未配置")).toBeVisible();
  await expect(page.getByRole("button", { name: "投票", exact: true })).toBeDisabled();
});

test("rejects invalid status, aborts stale requests and permits read-only participation", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => window.__semloRequireFixture("voteEditor").setEditable(false));
  await page.waitForFunction(() => window.__semloRequireFixture("votePending").length >= 2);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("votePending")
      .at(-1)!
      .resolve({ canVote: true, selectedOptionIds: ["missing"] }),
  );
  await expect(page.getByText("投票状态获取或提交失败")).toBeVisible();
  await page.getByRole("button", { name: "重新获取状态" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("votePending").length >= 3);
  const previous = await page.evaluate(() => window.__semloRequireFixture("votePending").length - 1);
  await page.evaluate(() =>
    window.__semloRequireFixture("voteEditor").commands.updateAttributes("semloEditorVote", { cardId: "vote-2" }),
  );
  await page.waitForFunction((count) => window.__semloRequireFixture("votePending").length > count, previous + 1);
  expect(
    await page.evaluate((index) => window.__semloRequireFixture("votePending")[index].signal.aborted, previous),
  ).toBe(true);
  await page.evaluate((index) => {
    window.__semloRequireFixture("votePending")[index].resolve({ canVote: false, selectedOptionIds: [] });
    window.__semloRequireFixture("votePending").at(-1)!.resolve({ canVote: true, selectedOptionIds: [] });
  }, previous);
  await page.getByLabel("乙", { exact: true }).check();
  await page.getByRole("button", { name: "投票", exact: true }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("voteCalls").at(-1)?.kind === "submit");
  expect(await page.evaluate(() => window.__semloRequireFixture("voteCalls").at(-1))).toEqual({
    kind: "submit",
    id: "vote-2",
    choices: ["b"],
  });
  await page.evaluate(() => window.__semloRequireFixture("voteEditor").destroy());
  expect(await page.evaluate(() => window.__semloRequireFixture("votePending").at(-1)!.signal.aborted)).toBe(true);
});

test("separate cards retain independent selections and direct edits", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("voteEditor")
      .commands.insertContentAt(window.__semloRequireFixture("voteEditor").state.doc.content.size, {
        type: "semloEditorVote",
        attrs: {
          cardId: "vote-2",
          title: "第二个",
          options: [
            { id: "x", label: "选甲" },
            { id: "y", label: "选乙" },
          ],
        },
      }),
  );
  const cards = page.locator(".semlo-editor-vote-card");
  await cards.nth(0).getByLabel("标题").fill("直接保存");
  expect(await page.evaluate(() => window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!.title)).toBe(
    "直接保存",
  );
  await page.evaluate(() => window.__semloRequireFixture("voteEditor").setEditable(false));
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("voteCalls").filter((call) => call.kind === "get" && call.id === "vote-2").length >=
      1,
  );
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("voteCalls").filter((call) => call.kind === "get" && call.id === "vote-1").length >=
      2,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("votePending")
      .forEach((request) => request.resolve({ canVote: true, selectedOptionIds: [] })),
  );
  await cards.nth(0).getByLabel("甲", { exact: true }).check();
  await cards.nth(1).getByLabel("选甲", { exact: true }).check();
  await expect(cards.nth(0).getByLabel("甲", { exact: true })).toBeChecked();
});

test("direct typing keeps focus and coalesces host configuration sync", async ({ page }) => {
  await mount(page, true);
  const title = page.getByLabel("标题");
  await title.click();
  await title.fill("");
  await title.pressSequentially("连贯输入");
  await page.evaluate(() =>
    window.__semloRequireFixture("votePending")[0].resolve({ canVote: true, selectedOptionIds: [] }),
  );
  await expect(title).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!.title)).toBe(
    "连贯输入",
  );
  await page.waitForFunction(() => window.__semloRequireFixture("voteSyncs").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("voteSyncs")[0].title)).toBe("连贯输入");
});

test("changing hosts cancels scheduled configuration writes", async ({ page }) => {
  await mount(page, true);
  await page.getByLabel("标题").fill("未同步");
  await page.evaluate(() => window.__semloRequireFixture("voteHost").setHost(null));
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__semloRequireFixture("voteSyncs"))).toEqual([]);
  await expect(page.getByText("投票服务未配置")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!.title)).toBe(
    "未同步",
  );
});

test("a pending local edit is not synced to a replacement activity", async ({ page }) => {
  await mount(page, true);
  await page.getByLabel("标题").fill("待同步");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("voteEditor")
      .commands.updateAttributes("semloEditorVote", { cardId: "different", title: "远端内容" }),
  );
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__semloRequireFixture("voteSyncs"))).toEqual([]);
  await expect(page.getByLabel("标题")).toHaveValue("远端内容");
});

test("a failed automatic configuration sync remains visible and can be retried", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => {
    window.voteSyncFails = true;
  });
  await page.getByLabel("标题").fill("本地内容");
  await expect(page.getByText("投票配置尚未与服务同步")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("voteEditor").getJSON().content![0].attrs!.title)).toBe(
    "本地内容",
  );
  await page.evaluate(() => {
    window.voteSyncFails = false;
  });
  await page.getByRole("button", { name: "同步投票配置" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("voteSyncs").length >= 2);
  expect(await page.evaluate(() => window.__semloRequireFixture("voteSyncs").at(-1)!.title)).toBe("本地内容");
});

test("reentrant document replacement cannot schedule a sync for the replacement", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => {
    const replace = () => {
      window.__semloRequireFixture("voteEditor").off("update", replace);
      window
        .__semloRequireFixture("voteEditor")
        .commands.updateAttributes("semloEditorVote", { cardId: "other", title: "外部内容" });
    };
    window.__semloRequireFixture("voteEditor").on("update", replace);
  });
  await page.getByLabel("标题").fill("原活动修改");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__semloRequireFixture("voteSyncs"))).toEqual([]);
  await expect(page.getByLabel("标题")).toHaveValue("外部内容");
});

test("reentrant host refresh invalidates the old edit's pending sync", async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => {
    const replace = () => {
      window.__semloRequireFixture("voteEditor").off("update", replace);
      window.__semloRequireFixture("voteHost").setHost(window.__semloRequireFixture("voteHost").getHost());
    };
    window.__semloRequireFixture("voteEditor").on("update", replace);
  });
  await page.getByLabel("标题").fill("原活动修改");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__semloRequireFixture("voteSyncs"))).toEqual([]);
});

test("an edit-mode status failure can be retried without rebuilding the inputs", async ({ page }) => {
  await mount(page, true);
  const title = page.getByLabel("标题");
  await title.focus();
  await page.evaluate(() => window.__semloRequireFixture("votePending")[0].reject());
  await expect(page.getByText("投票状态获取或提交失败")).toBeVisible();
  await expect(title).toBeFocused();
  await page.getByRole("button", { name: "重新获取状态" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("votePending").length === 2);
  await page.evaluate(() =>
    window.__semloRequireFixture("votePending")[1].resolve({ canVote: true, selectedOptionIds: [] }),
  );
  await expect(page.getByText("投票状态获取或提交失败")).toHaveCount(0);
});
