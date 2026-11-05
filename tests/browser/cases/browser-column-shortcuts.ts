async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const count of [2, 3, 4]) {
    await page.goto(new URL("/", page.url()).href);
    await page.locator(".semlo-editor-prose > p").last().click();
    await page.keyboard.type(`/fl${count}`);
    await page.keyboard.press("Enter");
    const layout = page.locator(".semlo-editor-prose .semlo-editor-columns").last();
    if ((await layout.locator(".semlo-editor-column").count()) !== count)
      throw new Error(`/fl${count} did not insert ${count} columns`);
    await layout.locator(".semlo-editor-column").last().locator("p").click();
    await page.keyboard.type(`栏${count}`);
    if (!(await layout.innerText()).includes(`栏${count}`)) throw new Error("Column is not editable");
  }
  await page.goto(new URL("/", page.url()).href);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await menu.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
  if (!(await page.locator(".semlo-editor-table-grid-popover").count())) throw new Error("Table picker missing");
  await menu.getByRole("option", { name: /分栏卡片/ }).hover();
  if (
    (await page.locator(".semlo-editor-table-grid-popover").count()) ||
    !(await page.locator(".semlo-editor-column-picker").count())
  )
    throw new Error("The previous submenu did not close");
  await page.getByRole("menuitem", { name: "四栏" }).focus();
  await page.keyboard.press("Escape");
  if (
    await page.locator(".semlo-editor-card-menu,.semlo-editor-table-grid-popover,.semlo-editor-column-picker").count()
  )
    throw new Error("Escape did not close menus");
  if (errors.length) throw new Error(errors.join("; "));
  return { shortcuts: [2, 3, 4], submenuSwitch: true, escape: true };
}
