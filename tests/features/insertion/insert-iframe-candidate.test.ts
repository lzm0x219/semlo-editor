import { test, expect } from "@rstest/playwright";

import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
const setup = async () => {
  const r = await createFixtureRsbuild("./tests/fixtures/insertion/insert-iframe-candidate-fixture.ts", {
    publicDir: false,
  });
  return r.startDevServer();
};
test("iframe toolbar insert menu permits table grid click", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator("iframe");
    await f.locator(".semlo-editor-prose p").click();
    await f.getByRole("button", { name: "插入内容", exact: true }).click();
    const menu = f.getByRole("dialog", { name: "插入内容" });
    await expect(menu).toBeVisible();
    await menu.locator('[data-command="table"]').hover();
    const grid = f.locator(".semlo-editor-table-grid-popover");
    await expect(grid).toBeVisible();
    await grid.getByRole("button", { name: "2行2列" }).click();
    await expect(f.locator(".semlo-editor-prose table")).toHaveCount(1);
    await expect(f.locator(".semlo-editor-prose tr")).toHaveCount(2);
  } finally {
    await server.close();
  }
});
test("iframe toolbar insert menu permits column picker click", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator("iframe");
    await f.locator(".semlo-editor-prose p").click();
    await f.getByRole("button", { name: "插入内容", exact: true }).click();
    const menu = f.getByRole("dialog", { name: "插入内容" });
    await menu.locator('[data-command="columns"]').hover();
    const picker = f.getByRole("menu", { name: "选择分栏数" });
    await expect(picker).toBeVisible();
    await picker.getByRole("menuitem", { name: "两栏" }).click();
    await expect(f.locator(".semlo-editor-prose [data-semlo-editor-columns]")).toHaveCount(1);
    await expect(f.locator(".semlo-editor-prose [data-semlo-editor-column]")).toHaveCount(2);
  } finally {
    await server.close();
  }
});
test("iframe outside click still closes insert menu", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`http://127.0.0.1:${port}`);
    const f = page.frameLocator("iframe");
    await f.getByRole("button", { name: "插入内容", exact: true }).click();
    const menu = f.getByRole("dialog", { name: "插入内容" });
    await expect(menu).toBeVisible();
    await f.locator("body").click({ position: { x: 1050, y: 750 } });
    await expect(menu).toHaveCount(0);
  } finally {
    await server.close();
  }
});
