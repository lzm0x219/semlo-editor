import { expect, test, type Locator, type Page } from "@rstest/playwright";

async function openExample(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const database = page.locator("#editor-host .semlo-editor-database");
  await expect(database.getByLabel("第 1 行 事项")).toHaveValue("收集灵感");
  return database;
}

async function expectPopoverFits(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= window.innerWidth + 1 &&
          rect.bottom <= window.innerHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1
        );
      }),
    )
    .toBe(true);
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error("The database popover has no visible bounds");
  const viewport = page.viewportSize();
  if (!viewport || bounds.x < -1 || bounds.y < -1 || bounds.x + bounds.width > viewport.width + 1) {
    throw new Error(`Database popover is outside the viewport: ${JSON.stringify({ bounds, viewport })}`);
  }
}

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`database controls remain reachable in a ${width}px viewport`, async ({ page }) => {
    const database = await openExample(page, width, height);
    await database.getByRole("button", { name: "筛选", exact: true }).click();
    const filter = database.getByRole("dialog", { name: "筛选" });
    await expectPopoverFits(page, filter);
    await filter.getByLabel("筛选列").selectOption({ label: "事项" });
    await filter.getByLabel("筛选条件").selectOption("contains");
    await filter.getByLabel("筛选值").fill("收集");
    await filter.getByRole("button", { name: "添加筛选规则" }).click();
    await expect(filter.getByLabel("筛选列")).toHaveCount(2);
    await filter.getByLabel("筛选关系").selectOption("or");
    await filter.getByRole("button", { name: "删除筛选规则" }).last().click();
    await filter.getByRole("button", { name: "删除筛选规则" }).click();
    await filter.getByRole("button", { name: "关闭" }).click();

    await database.getByRole("button", { name: "排序", exact: true }).click();
    const sort = database.getByRole("dialog", { name: "排序" });
    await expectPopoverFits(page, sort);
    await sort.getByRole("button", { name: "添加排序" }).click();
    await sort.getByLabel("保持排序").check();
    await expectPopoverFits(page, sort);
    await sort.getByLabel("排序列").selectOption({ label: "日期" });
    await sort.getByLabel("排序顺序").selectOption("desc");
    await sort.getByRole("button", { name: "删除排序" }).click();
    await sort.getByRole("button", { name: "关闭" }).click();

    await database.getByRole("button", { name: "分组", exact: true }).click();
    const group = database.getByRole("dialog", { name: "分组" });
    await expectPopoverFits(page, group);
    await group.getByLabel("分组列").selectOption({ label: "状态" });
    await group.getByLabel("分组顺序").selectOption("desc");
    await group.getByRole("button", { name: "移除分组" }).click();
    await expect(group).toHaveCount(0);

    await database.getByRole("button", { name: "字段配置", exact: true }).click();
    const fields = database.getByRole("dialog", { name: "字段配置" });
    await expectPopoverFits(page, fields);
    await fields.getByLabel("显示状态").uncheck();
    await expect(database.getByLabel("第 1 行 状态")).toHaveCount(0);
    await fields.getByLabel("显示状态").check();
    await fields.getByRole("button", { name: "关闭" }).click();

    const addColumn = database.getByRole("button", { name: "添加列" });
    await addColumn.scrollIntoViewIfNeeded();
    await addColumn.click();
    const column = database.getByRole("dialog", { name: "新增列" });
    await expectPopoverFits(page, column);
    await column.getByLabel("数据表列名").fill("备注");
    await column.getByLabel("默认值").fill("示例");
    await column.getByRole("button", { name: "确定" }).click();
    await expect(database.getByLabel("第 1 行 备注")).toHaveValue("示例");
  });

  test(`database popovers stay visible near the bottom edge at ${width}px`, async ({ page }) => {
    const database = await openExample(page, width, height);
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "700px";
      document.querySelector("#editor-host")?.before(spacer);
    });
    const sortButton = database.getByRole("button", { name: "排序", exact: true });
    await sortButton.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('#editor-host .semlo-editor-database [aria-label="排序"]');
      if (!button) throw new Error("Missing database sort button");
      window.scrollBy(0, button.getBoundingClientRect().top - (window.innerHeight - 60));
    });
    const anchor = await sortButton.boundingBox();
    if (!anchor || anchor.y < height - 90 || anchor.y + anchor.height > height) {
      throw new Error(`Could not place the anchor near the viewport bottom: ${JSON.stringify(anchor)}`);
    }
    await sortButton.click();
    const sort = database.getByRole("dialog", { name: "排序" });
    await expectPopoverFits(page, sort);
    await sort.getByRole("button", { name: "添加排序" }).click();
    await sort.getByLabel("保持排序").check();
    await expectPopoverFits(page, sort);
    await sort.getByLabel("排序顺序").selectOption("desc");
    await sort.getByRole("button", { name: "关闭" }).click();
  });
}
