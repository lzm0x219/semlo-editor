import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-deadline-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let directory: string, bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-deadline-"));
  const builder = await createInlineFixtureRsbuild(
    "deadline",
    resolve("tests/fixtures/interactive/interactive-deadline-fixture.ts"),
    directory,
  );
  await builder.build();
  bundle = await readInlineFixtureBundle(directory);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: Page, kind: "vote" | "checkin", content?: string) {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ kind, content }) => window.__semloRequireFixture("mountDeadline")(kind, content), {
    kind,
    content,
  });
}
for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} preserves second-precision local deadlines through service sync and HTML`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    if (kind === "checkin") await page.getByLabel("设置截止日期").check();
    if (kind === "vote") {
      await page.getByLabel("截止日期", { exact: true }).fill("2030-05-01 12:34:56");
      await page.getByLabel("截止日期", { exact: true }).press("Enter");
    } else {
      await page.getByLabel("截止日期", { exact: true }).fill("2030-05-01");
      await page.getByLabel("截止时间").fill("12:34:56");
    }
    if (kind === "checkin") {
      await page.getByRole("button", { name: "确定" }).click();
      await expect(page.getByText("截止日期：2030-05-01 12:34:56")).toBeVisible();
    }
    await page.waitForFunction(() => window.__semloRequireFixture("deadlineSyncs").length > 0);
    expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs")[0].deadline)).toBe(
      "2030-05-01T12:34:56",
    );
    const html = await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getHTML());
    await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").destroy());
    await mount(page, kind, html);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getJSON().content?.[0]?.attrs?.deadline),
    ).toBe("2030-05-01T12:34:56");
    if (kind === "checkin") {
      await page.getByRole("button", { name: "编辑打卡" }).click();
      await expect(page.getByLabel("截止时间")).toHaveValue("12:34:56");
    } else await expect(page.getByLabel("截止日期", { exact: true })).toHaveValue("2030-05-01 12:34:56");
  });
  test(`${kind} refuses a time without a date`, async ({ page }) => {
    await mount(page, kind);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    if (kind === "checkin") {
      await page.getByLabel("设置截止日期").check();
      await page.getByLabel("截止日期", { exact: true }).fill("");
    }
    if (kind === "vote") {
      await page.getByLabel("截止日期", { exact: true }).click();
      const picker = page.getByRole("dialog", { name: "选择截止日期和时间" });
      await picker.getByRole("option", { name: "小时 12" }).click();
      await picker.getByRole("button", { name: "确定" }).click();
    } else {
      await page.getByLabel("截止时间").fill("12:34:56");
      await page.getByRole("button", { name: "确定" }).click();
    }
    await expect(page.getByRole("form", { name: kind === "vote" ? "编辑投票" : "编辑打卡" })).toBeVisible();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getJSON().content?.[0]?.attrs?.deadline),
    ).toBeNull();
    expect(await page.evaluate(() => window.__semloRequireFixture("deadlineSyncs").length)).toBe(0);
  });
}

test("check-in deadline switch initializes a local time and can clear the deadline", async ({ page }) => {
  await mount(page, "checkin");
  await page.getByRole("button", { name: "编辑打卡" }).click();
  const toggle = page.getByRole("checkbox", { name: "设置截止日期" });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByLabel("截止日期", { exact: true })).toBeHidden();
  await toggle.check();
  await expect(page.getByLabel("截止日期", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("截止时间")).not.toHaveValue("");
  await page.getByLabel("截止日期", { exact: true }).fill("2030-05-01");
  await page.getByLabel("截止时间").fill("12:34:56");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("截止日期：2030-05-01 12:34:56")).toBeVisible();
  await page.getByRole("button", { name: "编辑打卡" }).click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole("button", { name: "确定" }).click();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getJSON().content?.[0]?.attrs?.deadline),
  ).toBeNull();
});

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} keeps legacy date-only values when edited`, async ({ page }) => {
    const content = `<div data-semlo-editor-${kind}="" data-card-id="legacy" data-deadline="2030-05-01"></div>`;
    await mount(page, kind, content);
    if (kind === "checkin") await page.getByRole("button", { name: "编辑打卡" }).click();
    await expect(page.getByLabel("截止日期", { exact: true })).toHaveValue("2030-05-01");
    if (kind === "checkin") {
      await expect(page.getByLabel("截止时间")).toHaveValue("");
      await page.getByRole("button", { name: "确定" }).click();
    }
    expect(
      await page.evaluate(() => window.__semloRequireFixture("deadlineEditor").getJSON().content?.[0]?.attrs?.deadline),
    ).toBe("2030-05-01");
  });
}
