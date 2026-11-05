import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    statusFidelityEditor?: EditorController;
  }
}

async function mount(page: Page, content: EditorContent = "<p>正文</p>") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'status-fidelity-test'
      document.body.prepend(host)
      window.statusFidelityEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.statusFidelityEditor));
  return page.locator("#status-fidelity-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("inserting a status opens its editor and applies text and color immediately", async ({ page }) => {
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");
  await prose.locator("p").click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const insert = page.getByRole("dialog", { name: "插入内容" });
  await insert.getByRole("option", { name: "状态 插入状态", exact: true }).click();
  const status = host.getByRole("button", { name: "状态：设置状态" });
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  const input = panel.getByLabel("状态文字");
  await expect(status).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  const panelBox = await panel.boundingBox();
  const inputBox = await input.boundingBox();
  if (!panelBox || !inputBox) throw new Error("Missing status editor geometry");
  expect(panelBox.width).toBe(178);
  expect(panelBox.height).toBe(92);
  expect(inputBox.width).toBe(144);
  expect(inputBox.height).toBe(32);
  const swatches = panel.locator(".semlo-editor-status-colors button");
  await expect(swatches).toHaveCount(6);
  await expect(swatches.first()).toHaveAttribute("aria-pressed", "true");

  await input.fill("进行中");
  await expect(host.getByRole("button", { name: "状态：进行中" })).toBeVisible();
  await panel.getByRole("button", { name: "蓝色" }).click();
  await expect(input).toBeFocused();
  await expect(panel.getByRole("button", { name: "蓝色" })).toHaveAttribute("aria-pressed", "true");
  await expect(host.getByRole("button", { name: "状态：进行中" })).toHaveCSS("background-color", "rgb(192, 221, 252)");
  await input.press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(prose).toBeFocused();

  await host.getByRole("button", { name: "状态：进行中" }).click();
  await expect(input).toHaveValue("进行中");
  await input.fill("已完成");
  await input.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(host.getByRole("button", { name: "状态：已完成" })).toBeVisible();
});

test("status editing respects IME confirmation, keyboard colors and lifecycle changes", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "原始", color: 0 } }] }],
  });
  await host.getByRole("button", { name: "状态：原始" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  const input = panel.getByLabel("状态文字");
  await input.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
  });
  await expect(panel).toBeVisible();
  const green = panel.getByRole("button", { name: "绿色" });
  await green.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(green).toHaveAttribute("aria-pressed", "true");
  await expect(input).toBeFocused();
  await page.evaluate(() => window.__semloRequireFixture("statusFidelityEditor").setEditable(false));
  await expect(panel).toHaveCount(0);
  await expect(host.getByRole("button", { name: "状态：原始" })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("statusFidelityEditor").setEditable(true));
  await host.getByRole("button", { name: "状态：原始" }).click();
  await page.evaluate(() => window.__semloRequireFixture("statusFidelityEditor").destroy());
  await expect(panel).toHaveCount(0);
});

test("the status editor follows its label during scroll and closes when it leaves the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 320 });
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "滚动", color: 0 } }] }],
  });
  await host.evaluate((element) => {
    element.style.marginTop = "400px";
    element.style.marginBottom = "400px";
  });
  const status = host.getByRole("button", { name: "状态：滚动" });
  await status.scrollIntoViewIfNeeded();
  await status.click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await expect(panel).toBeVisible();
  const original = await status.boundingBox();
  if (!original) throw new Error("Missing status geometry");
  await page.evaluate(() => window.scrollBy(0, 40));
  await expect.poll(async () => (await status.boundingBox())?.y).not.toBe(original.y);
  await expect
    .poll(async () => {
      const [anchor, popup] = await Promise.all([status.boundingBox(), panel.boundingBox()]);
      if (!anchor || !popup) return false;
      const aligned =
        Math.abs(popup.y - anchor.y - anchor.height - 8) < 1 || Math.abs(popup.y + popup.height + 8 - anchor.y) < 1;
      return aligned && popup.x >= 8 && popup.x + popup.width <= 412 && popup.y >= 8 && popup.y + popup.height <= 312;
    })
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(panel).toHaveCount(0);
});

test("exported status HTML retains its color outside the editor", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "完成", color: 2 } }] }],
  });
  const style = await host.getByRole("button", { name: "状态：完成" }).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { background: computed.backgroundColor, color: computed.color };
  });
  await page.evaluate(() => {
    const reader = document.createElement("article");
    reader.id = "status-fidelity-reader";
    reader.innerHTML = window.__semloRequireFixture("statusFidelityEditor").getSnapshot().html;
    document.body.append(reader);
  });
  const exported = page.locator("#status-fidelity-reader span[data-semlo-editor-status]");
  await expect(exported).toHaveText("完成");
  await expect(exported).toHaveCSS("background-color", style.background);
  await expect(exported).toHaveCSS("color", style.color);
});
