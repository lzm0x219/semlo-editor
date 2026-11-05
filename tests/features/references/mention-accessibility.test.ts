import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

let origin: string;
let stop: () => Promise<void>;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/references/mention-accessibility-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
});

test("提及候选通过活动项和选中状态反馈键盘导航，关闭后恢复宿主属性", async ({ page }) => {
  const prose = page.locator("#mention-accessibility-first .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.type("@");
  const list = page.getByRole("listbox", { name: "提及" });
  await expect(list.getByRole("option", { name: "明夷" })).toBeVisible();
  await expect(prose).toBeFocused();
  const listId = await list.getAttribute("id");
  expect(listId).toBeTruthy();
  await expect(prose).toHaveAttribute("aria-controls", `host-control ${listId}`);
  const options = list.getByRole("option");
  const firstId = await options.first().getAttribute("id");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(prose).toHaveAttribute("aria-activedescendant", firstId!);

  await page.keyboard.press("ArrowDown");
  const secondId = await options.nth(1).getAttribute("id");
  expect(secondId).not.toBe(firstId);
  await expect(options.first()).toHaveAttribute("aria-selected", "false");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(prose).toHaveAttribute("aria-activedescendant", secondId!);
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(prose).toHaveAttribute("aria-controls", "host-control");
  await expect(prose).toHaveAttribute("aria-activedescendant", "host-option");
});

test("候选为空、宿主更新属性和多实例切换时不留下失效关联", async ({ page }) => {
  const first = page.locator("#mention-accessibility-first .semlo-editor-prose");
  const second = page.locator("#mention-accessibility-second .semlo-editor-prose");
  await first.locator("p").click();
  await page.keyboard.type("@empty");
  const list = page.getByRole("listbox", { name: "提及" });
  await expect(list.getByText("无匹配内容，请重新输入")).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(0);
  await expect(first).toHaveAttribute("aria-activedescendant", "host-option");
  await first.evaluate((element) => {
    element.setAttribute("aria-controls", `${element.getAttribute("aria-controls")} other-control`);
    element.setAttribute("aria-activedescendant", "other-option");
  });
  await page.keyboard.press("Escape");
  await expect(first).toHaveAttribute("aria-controls", "host-control other-control");
  await expect(first).toHaveAttribute("aria-activedescendant", "other-option");

  await second.locator("p").click();
  await page.keyboard.type("@");
  await expect(list.getByRole("option", { name: "明夷" })).toBeVisible();
  const active = await second.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(first).toHaveAttribute("aria-activedescendant", "other-option");
  await page.keyboard.press("Escape");
  await expect(second).not.toHaveAttribute("aria-controls");
  await expect(second).not.toHaveAttribute("aria-activedescendant");
});

test("菜单打开后宿主修改活动项时，关闭或销毁不会覆盖宿主值", async ({ page }) => {
  const prose = page.locator("#mention-accessibility-first .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.type("@");
  const list = page.getByRole("listbox", { name: "提及" });
  await expect(list.getByRole("option", { name: "明夷" })).toBeVisible();
  await prose.evaluate((element) => element.setAttribute("aria-activedescendant", "host-updated"));
  await page.keyboard.press("Escape");
  await expect(prose).toHaveAttribute("aria-activedescendant", "host-updated");

  await prose.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" @");
  await expect(list.getByRole("option", { name: "明夷" })).toBeVisible();
  const afterDestroy = await page.evaluate(() => {
    const editor = Reflect.get(window, "mentionAccessibilityFirst");
    const element = editor.editor.view.dom as HTMLElement;
    editor.destroy();
    return {
      controls: element.getAttribute("aria-controls"),
      active: element.getAttribute("aria-activedescendant"),
    };
  });
  expect(afterDestroy).toEqual({ controls: "host-control", active: "host-updated" });
  await expect(list).toHaveCount(0);
});

test("窄屏中提及列表保持可见并可通过键盘选择", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const prose = page.locator("#mention-accessibility-first .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.type("@");
  const list = page.getByRole("listbox", { name: "提及" });
  await expect(list.getByRole("option", { name: "明夷" })).toBeVisible();
  const bounds = await list.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.keyboard.press("ArrowDown");
  const selected = list.getByRole("option", { selected: true });
  await expect(selected).toHaveCount(1);
  await expect(prose).toHaveAttribute("aria-activedescendant", (await selected.getAttribute("id"))!);
});
