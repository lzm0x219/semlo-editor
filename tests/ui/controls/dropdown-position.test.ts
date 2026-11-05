import { expect, test, type Page } from "@rstest/playwright";

declare global {
  interface Window {
    dropdownDestroyEditor?: { destroy: () => void };
  }
}

async function openOverflow(page: Page) {
  const more = page.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  await expect(overflow).toBeVisible();
  return overflow;
}

test("toolbar menus stay within a small viewport and flip above the trigger", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 260 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      left: "auto",
      top: "auto",
      width: "220px",
      zIndex: "20",
    });
  });

  const overflow = await openOverflow(page);
  const heading = overflow.getByRole("button", { name: "段落样式" });
  await heading.scrollIntoViewIfNeeded();
  await heading.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const headingBox = await heading.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(7);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(353);
  expect(menuBox!.y).toBeGreaterThanOrEqual(7);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(headingBox!.y - 3);

  const color = overflow.getByRole("button", { name: "文字颜色", exact: true });
  await color.scrollIntoViewIfNeeded();
  // Keep the anchor in the left part of the scroller when the viewport shrinks.
  await overflow.evaluate((element) => {
    const anchor = element.querySelector('[aria-label="文字颜色"]')!;
    element.scrollLeft += anchor.getBoundingClientRect().left - element.getBoundingClientRect().left - 16;
  });
  await color.click();
  const palette = page.getByRole("dialog", { name: "选择颜色" });
  await expect(palette).toBeVisible();
  let colorBox = await color.boundingBox();
  let paletteBox = await palette.boundingBox();
  expect(paletteBox!.x).toBeGreaterThanOrEqual(7);
  expect(paletteBox!.x + paletteBox!.width).toBeLessThanOrEqual(353);
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(colorBox!.y - 3);

  await page.setViewportSize({ width: 270, height: 180 });
  await expect(palette).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await palette.count()) ? await palette.boundingBox() : null;
      return box ? box.x + box.width : Infinity;
    })
    .toBeLessThanOrEqual(263);
  await expect
    .poll(async () => {
      const box = (await palette.count()) ? await palette.boundingBox() : null;
      const anchor = await color.boundingBox();
      return box && anchor ? box.y + box.height - anchor.y : Infinity;
    })
    .toBeLessThanOrEqual(-3);
  colorBox = await color.boundingBox();
  paletteBox = await palette.boundingBox();
  expect(paletteBox!.x).toBeGreaterThanOrEqual(7);
  expect(paletteBox!.x + paletteBox!.width).toBeLessThanOrEqual(263);
  expect(paletteBox!.y).toBeGreaterThanOrEqual(7);
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(colorBox!.y - 3);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(color).toHaveAttribute("aria-expanded", "false");
});

test("the menu follows overflow and page scrolling and is removed on editor destroy", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      position: "absolute",
      left: "220px",
      top: "340px",
      width: "350px",
      zIndex: "20",
    });
    document.body.style.minHeight = "1800px";
  });
  const overflow = await openOverflow(page);
  await overflow.evaluate((element) => {
    const panel = element as HTMLElement;
    panel.style.width = "220px";
  });
  const size = overflow.getByRole("button", { name: "字号" });
  await size.scrollIntoViewIfNeeded();
  await overflow.evaluate((element) => {
    const anchor = element.querySelector('[aria-label="字号"]')!;
    element.scrollLeft += anchor.getBoundingClientRect().left - element.getBoundingClientRect().left - 100;
  });
  await size.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const initialAnchor = await size.boundingBox();
  const initialMenu = await menu.boundingBox();
  await overflow.evaluate((element) => (element.scrollLeft += 30));
  await expect.poll(async () => (await size.boundingBox())!.x).toBeLessThan(initialAnchor!.x - 20);
  await expect
    .poll(async () => Math.abs((await menu.boundingBox())!.x - (await size.boundingBox())!.x))
    .toBeLessThan(2);
  expect((await menu.boundingBox())!.x).toBeLessThan(initialMenu!.x - 20);

  const beforeScrollAnchor = await size.boundingBox();
  const beforeScrollMenu = await menu.boundingBox();
  expect(Math.abs(beforeScrollMenu!.y + beforeScrollMenu!.height - (beforeScrollAnchor!.y - 4))).toBeLessThan(2);
  await page.evaluate(() => window.scrollBy(0, 60));
  await expect.poll(async () => (await size.boundingBox())!.y).toBeLessThan(beforeScrollAnchor!.y - 40);
  await expect
    .poll(async () => {
      const anchorBox = (await size.boundingBox())!;
      const menuBox = (await menu.boundingBox())!;
      return Math.abs(menuBox.y + menuBox.height - (anchorBox.y - 4));
    })
    .toBeLessThan(2);
  const afterScrollMenu = (await menu.boundingBox())!;
  expect(afterScrollMenu.y + afterScrollMenu.height).toBeLessThan(beforeScrollMenu!.y + beforeScrollMenu!.height - 40);

  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'dropdown-destroy-fixture'
      document.body.prepend(host)
      window.dropdownDestroyEditor = createEditor({ element: host, content: '<p>test</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.dropdownDestroyEditor));
  const host = page.locator("#dropdown-destroy-fixture");
  const heading = host.getByRole("button", { name: "段落样式" });
  await heading.click();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.evaluate(() => {
    if (!window.dropdownDestroyEditor) throw new Error("Dropdown editor fixture is not initialized");
    window.dropdownDestroyEditor.destroy();
  });
  await expect(page.locator(".semlo-editor-dropdown, .semlo-editor-palette")).toHaveCount(0);
  await openOverflow(page);
  await size.scrollIntoViewIfNeeded();
  await size.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(size).toHaveAttribute("aria-expanded", "false");
});

test("an open menu follows its control back into the toolbar after widening", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "220px";
  });
  const overflow = await openOverflow(page);
  const size = page.getByRole("button", { name: "字号" });
  await size.scrollIntoViewIfNeeded();
  await expect(overflow.getByRole("button", { name: "字号" })).toBeVisible();
  await size.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "900px";
  });
  await expect(toolbar.getByRole("button", { name: "字号" })).toBeVisible();
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const anchor = await size.boundingBox();
      const popup = await menu.boundingBox();
      return anchor && popup ? Math.abs(anchor.x - popup.x) : Infinity;
    })
    .toBeLessThan(2);
});

test("a menu closes when shrinking moves its control into a closed overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "900px";
  });
  const size = toolbar.getByRole("button", { name: "字号" });
  await size.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "220px";
  });
  await expect(menu).toHaveCount(0);
  const overflow = await openOverflow(page);
  const movedSize = overflow.getByRole("button", { name: "字号" });
  await movedSize.scrollIntoViewIfNeeded();
  await expect(movedSize).toHaveAttribute("aria-expanded", "false");
});
