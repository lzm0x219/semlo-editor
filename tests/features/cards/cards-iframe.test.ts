import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  const r = await createFixtureRsbuild("./tests/fixtures/cards/cards-iframe-fixture.ts");
  const { port, server } = await r.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());
test("status and formula panels stay in the editor document and handle keyboard", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(Reflect.get(window, "iframeCardController")));
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "状态：状态" }).click();
  const status = frame.getByRole("dialog", { name: "编辑状态" });
  await expect(status).toBeVisible();
  await status.getByLabel("状态文字").fill("修改");
  await status.getByLabel("状态文字").press("Escape");
  await expect(status).toHaveCount(0);
  await frame.getByRole("button", { name: "公式：x", exact: true }).click();
  const formula = frame.getByRole("dialog", { name: "编辑公式" });
  await formula.getByLabel("TeX 公式").fill("x+1");
  await formula.getByLabel("TeX 公式").press("ControlOrMeta+Enter");
  await expect(formula).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "公式：x+1", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "编辑公式" })).toHaveCount(0);
});

test("date and calendar panels operate in their editor document", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(Reflect.get(window, "iframeCardController")));
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "日期：2026-11-03" }).click();
  const picker = frame.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
  await expect(frame.getByRole("button", { name: "日期：2026-11-05" })).toBeVisible();
  await frame.getByRole("button", { name: "日程：日程" }).first().click();
  const event = frame.getByRole("dialog", { name: "编辑日程" });
  await expect(event.getByLabel("日程标题")).toHaveValue("日程");
  await event.getByLabel("日程标题").press("Escape");
  await expect(event).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "编辑日程" })).toHaveCount(0);
});
