import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    otherHeadingMenuClose?: () => void;
    headingMenuFixture?: {
      open: (options?: { value?: "mixed" | "chinese" | "decimal" | null; focusOnOpen?: boolean }) => void;
      close: () => void;
      selections: string[];
      closed: number;
    };
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/heading/numbering-menu.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `
      import { openHeadingNumberingMenu } from '/dist/index.js'
      document.body.replaceChildren()
      const editor = document.createElement('div')
      editor.id = 'heading-editable'
      editor.contentEditable = 'true'
      editor.textContent = '编号示例'
      const anchor = document.createElement('button')
      anchor.id = 'heading-anchor'
      anchor.textContent = '1.'
      anchor.setAttribute('aria-label', '设置标题编号')
      anchor.setAttribute('aria-controls', 'existing-control')
      Object.assign(anchor.style, { position: 'fixed', left: '80px', top: '100px', width: '25px', height: '24px' })
      const outside = document.createElement('button')
      outside.id = 'outside'
      outside.textContent = '外部'
      Object.assign(outside.style, { position: 'fixed', left: '20px', top: '30px' })
      document.body.append(editor, anchor, outside)
      let close = () => {}
      window.headingMenuFixture = {
        selections: [],
        closed: 0,
        open(options = {}) {
          close()
          close = openHeadingNumberingMenu({
            anchor,
            value: options.value,
            focusOnOpen: options.focusOnOpen,
            onSelect: value => window.headingMenuFixture.selections.push(value),
            onClose: () => window.headingMenuFixture.closed++,
          })
        },
        close() { close() },
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingMenuFixture));
  return page.locator("#heading-anchor");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("preview cards reflect the three numbering styles and dispatch the chosen value", async ({ page }) => {
  const anchor = await mount(page);
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open());
  const menu = page.getByRole("menu", { name: "设置编号" });
  const cards = menu.getByRole("menuitemradio");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute("aria-label", "数字层级：1.、1.1.、1.1.1.");
  await expect(cards.nth(1)).toHaveAttribute("aria-label", "中文层级：一、（一）、1.");
  await expect(cards.nth(2)).toHaveAttribute("aria-label", "混合层级：1.、a.、ⅰ.");
  await expect(cards.nth(0)).toHaveAttribute("aria-checked", "false");
  await expect(cards.nth(1)).toHaveAttribute("aria-checked", "false");
  await expect(cards.nth(2)).toHaveAttribute("aria-checked", "true");
  const box = (await menu.boundingBox())!;
  expect(box.width).toBeCloseTo(292, 0);
  expect(box.height).toBeCloseTo(111, 0);
  expect(box.x).toBeCloseTo((await anchor.boundingBox())!.x, 0);
  expect(box.y).toBeCloseTo((await anchor.boundingBox())!.y + 28, 0);
  const card = (await cards.first().boundingBox())!;
  expect(card.width).toBe(84);
  expect(card.height).toBe(85);

  await cards.nth(0).click();
  await expect(menu).toHaveCount(0);
  await expect(anchor).toHaveAttribute("aria-expanded", "false");
  await expect(anchor).toHaveAttribute("aria-controls", "existing-control");
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").selections)).toEqual(["decimal"]);
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").closed)).toBe(1);
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open({ value: "chinese" }));
  await expect(page.getByRole("menuitemradio", { name: "中文层级：一、（一）、1." })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemradio", { name: "混合层级：1.、a.、ⅰ." }).click();
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").selections)).toEqual([
    "decimal",
    "mixed",
  ]);
});

test("keyboard navigation, Escape and pointer selection preserve focus and editor selection", async ({ page }) => {
  const anchor = await mount(page);
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open({ focusOnOpen: true }));
  const mixed = page.getByRole("menuitemradio", { name: "混合层级：1.、a.、ⅰ." });
  await expect(mixed).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("menuitemradio", { name: "中文层级：一、（一）、1." })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
  await expect(anchor).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").selections)).toEqual(["chinese"]);

  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open({ focusOnOpen: true }));
  await page.keyboard.press("Escape");
  await expect(anchor).toBeFocused();
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("#heading-editable")!;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    window.__semloRequireDefined("headingMenuFixture").open();
  });
  await page.getByRole("menuitemradio", { name: "数字层级：1.、1.1.、1.1.1." }).click();
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("编号示例");
  await expect(page.locator("#heading-editable")).toBeFocused();
});

test("an open menu does not intercept arrows or Escape while the editor keeps focus", async ({ page }) => {
  const anchor = await mount(page);
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("#heading-editable")!;
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 3);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    window.__semloRequireDefined("headingMenuFixture").open();
  });
  const menu = page.getByRole("menu", { name: "设置编号" });
  const mixed = menu.getByRole("menuitemradio", { name: "混合层级：1.、a.、ⅰ." });
  await expect(page.locator("#heading-editable")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => document.getSelection()?.anchorOffset)).toBe(2);
  await expect(menu).toBeVisible();
  await expect(mixed).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await expect(page.locator("#heading-editable")).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").selections)).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").closed)).toBe(0);

  await anchor.focus();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(anchor).toBeFocused();
});

test("outside click, explicit disposal and anchor removal clean up", async ({ page }) => {
  const anchor = await mount(page);
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open());
  await page.locator("#outside").click();
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
  await expect(anchor).toHaveAttribute("aria-controls", "existing-control");
  await page.evaluate(() => {
    window.__semloRequireDefined("headingMenuFixture").open();
    window.__semloRequireDefined("headingMenuFixture").close();
    window.__semloRequireDefined("headingMenuFixture").close();
  });
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").closed)).toBe(2);
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open());
  await anchor.evaluate((element) => element.remove());
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").closed)).toBe(3);
});

test("disposing one editor's popup leaves another popup and its anchor intact", async ({ page }) => {
  const anchor = await mount(page);
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open());
  await page.addScriptTag({
    type: "module",
    content: `
      import { openHeadingNumberingMenu } from '/dist/index.js'
      const other = document.createElement('button')
      other.id = 'other-heading-anchor'
      other.textContent = '2.'
      Object.assign(other.style, { position: 'fixed', left: '400px', top: '100px' })
      document.body.append(other)
      window.otherHeadingMenuClose = openHeadingNumberingMenu({ anchor: other, value: 'decimal', onSelect() {} })
    `,
  });
  await page.waitForFunction(() => typeof window.otherHeadingMenuClose === "function");
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(2);
  const other = page.locator("#other-heading-anchor");
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").close());
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(1);
  await expect(anchor).toHaveAttribute("aria-expanded", "false");
  await expect(other).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => window.__semloRequireFixture("otherHeadingMenuClose")());
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
});

test("the menu remains usable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 180 });
  const anchor = await mount(page);
  await anchor.evaluate((element) => Object.assign((element as HTMLElement).style, { left: "200px", top: "140px" }));
  await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").open({ focusOnOpen: true }));
  const menu = page.getByRole("menu", { name: "设置编号" });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(233);
  expect(bounds.y).toBeGreaterThanOrEqual(7);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(173);
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitemradio", { name: "数字层级：1.、1.1.、1.1.1." })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireDefined("headingMenuFixture").selections)).toEqual(["decimal"]);
});
