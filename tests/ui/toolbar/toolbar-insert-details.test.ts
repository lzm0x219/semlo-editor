import { expect, test } from "@rstest/playwright";

test("details body insertion filters restricted entries in slash and toolbar menus", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate(() => localStorage.setItem("semlo-editor.recent-commands.v1", '["table","details","status"]'));
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  const body = host.locator('[data-type="detailsContent"] p').first();
  await body.click();
  await body.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.keyboard.type("/");
  const slash = page.getByRole("listbox", { name: "插入内容" });
  await expect(slash).toBeVisible();
  await expect(slash.locator('.semlo-editor-recent-item[data-command="table"]')).toHaveCount(0);
  await expect(slash.locator('.semlo-editor-recent-item[data-command="details"]')).toHaveCount(0);
  for (const id of ["table", "database", "album", "kanban", "details", "columns"]) {
    await expect(slash.locator(`[data-command="${id}"]`)).toHaveCount(0);
  }
  for (const id of ["image", "attachment", "status", "callout", "calendar", "date"]) {
    await expect(slash.locator(`.semlo-editor-card-item[data-command="${id}"]`)).toHaveCount(1);
  }
  await page.keyboard.insertText("折叠块");
  await expect(slash.getByText("暂无匹配的搜索结果")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(slash).toHaveCount(0);
  await expect(body).toContainText("/折叠块");

  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(panel).toBeVisible();
  for (const id of ["table", "database", "album", "kanban", "details", "columns"]) {
    await expect(panel.locator(`[data-command="${id}"]`)).toHaveCount(0);
  }
  await panel.getByLabel("搜索插入内容").fill("折叠块");
  await expect(panel.getByText("暂无匹配的搜索结果")).toBeVisible();
});

test("block-below insertion uses the target block rather than an unrelated details selection", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  await host.locator('[data-type="detailsContent"] p').first().click();
  const paragraph = host.locator(".semlo-editor-prose > p").first();
  await paragraph.hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(panel.locator('[data-command="table"]')).toBeVisible();
  await expect(panel.locator('[data-command="database"]')).toBeVisible();
});

test("normal paragraph insertion remains available outside details", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  for (const id of ["table", "database", "album", "kanban", "details", "columns"]) {
    await expect(panel.locator(`.semlo-editor-card-item[data-command="${id}"]`)).toHaveCount(1);
  }
});

test("block-below the details card is treated as a sibling insertion", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  await host.locator(".semlo-editor-prose > p").first().click();
  await host.locator('[data-type="detailsContent"] p').first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(host.locator('[data-type="details"].semlo-editor-block-actions-selected')).toHaveCount(1);
  for (const id of ["table", "database", "details", "columns"]) {
    await expect(panel.locator(`[data-command="${id}"]`)).toHaveCount(1);
  }
});
