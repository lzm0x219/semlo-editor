import { expect, test } from "@rstest/playwright";

test("the table picker follows the insert menu as its toolbar becomes sticky", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.id = 'insert-scroll-test'
      host.style.width = '800px'
      host.style.marginTop = '400px'
      host.style.setProperty('--semlo-editor-toolbar-sticky-top', '52px')
      document.body.append(host)
      createEditor({
        element: host,
        outline: false,
        content: Array.from({ length: 80 }, (_, index) => '<p>正文 ' + index + '</p>').join(''),
      })
    `,
  });
  const toolbar = page.locator("#insert-scroll-test .semlo-editor-toolbar");
  const trigger = toolbar.getByRole("button", { name: "插入内容" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  const table = menu.locator('[data-command="table"]');
  // Focus the row so the submenu stays open while the pointer remains still.
  await table.focus();
  const picker = page.getByLabel("选择表格大小");
  await expect(picker).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 360));
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeCloseTo(52, 0);
  await expect
    .poll(async () => {
      const [button, panel] = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);
      return panel!.y - (button!.y + button!.height);
    })
    .toBeCloseTo(6, 0);
  await expect
    .poll(async () => {
      const [button, panel] = await Promise.all([table.boundingBox(), picker.boundingBox()]);
      return panel!.y - button!.y;
    })
    .toBeCloseTo(0, 0);
  await picker.getByRole("button", { name: "2行2列" }).click();
  await expect(page.locator("#insert-scroll-test .semlo-editor-prose table")).toHaveCount(1);
});

test("the column picker follows the insert menu while its scroll container moves", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const scroller = document.createElement('div')
      scroller.style.cssText = 'height:300px;overflow:auto'
      const spacer = document.createElement('div')
      spacer.style.height = '180px'
      const host = document.createElement('div')
      host.id = 'column-scroll-test'
      host.style.width = '800px'
      scroller.append(spacer, host)
      document.body.append(scroller)
      createEditor({
        element: host,
        outline: false,
        content: Array.from({ length: 40 }, (_, index) => '<p>正文 ' + index + '</p>').join(''),
      })
    `,
  });
  const toolbar = page.locator("#column-scroll-test .semlo-editor-toolbar");
  const trigger = toolbar.getByRole("button", { name: "插入内容" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await menu.getByLabel("搜索插入内容").fill("分栏");
  const columns = menu.locator('[data-command="columns"]');
  await columns.focus();
  const picker = page.getByRole("menu", { name: "选择分栏数" });
  await expect(picker).toBeVisible();
  await page.locator("#column-scroll-test").evaluate((element) => {
    element.parentElement!.scrollTop = 160;
  });
  await expect
    .poll(async () => {
      const [button, panel] = await Promise.all([columns.boundingBox(), picker.boundingBox()]);
      return panel!.y - button!.y;
    })
    .toBeCloseTo(0, 0);
  await picker.getByRole("menuitem", { name: "两栏" }).click();
  await expect(page.locator("#column-scroll-test .semlo-editor-columns")).toHaveCount(1);
});

test("切换工具栏子菜单时保留键盘焦点", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'insert-focus-test'
      document.body.prepend(host)
      createEditor({ element: host, content: '<p></p>' })
    `,
  });
  await page.locator("#insert-focus-test").getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  const list = menu.locator(".semlo-editor-card-list");
  await list.locator('[data-command="table"]').focus();
  await page.getByLabel("1行1列", { exact: true }).focus();
  await list.locator('[data-command="columns"]').hover({ force: true });
  await expect(page.getByRole("menu", { name: "选择分栏数" })).toBeVisible();
  await expect(list).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator("#insert-focus-test .semlo-editor-prose")).toBeFocused();
});
