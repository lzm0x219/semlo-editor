import { expect, test } from "@rstest/playwright";

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`preview keeps its editor toolbar below the header while scrolling at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.getByRole("combobox", { name: "选择示例" }).selectOption("all");
    const header = page.locator(".topbar");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await expect(toolbar).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect
      .poll(async () => {
        const top = await header.boundingBox();
        const tools = await toolbar.boundingBox();
        return top && tools ? Math.abs(tools.y - (top.y + top.height)) : Infinity;
      })
      .toBeLessThan(1);
    await toolbar.getByRole("button", { name: "插入内容" }).click();
    const panel = page.getByRole("dialog", { name: "插入内容" });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  });
}
