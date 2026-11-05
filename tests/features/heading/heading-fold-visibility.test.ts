import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    headingFoldVisualEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.id = 'heading-fold-visibility'
      host.style.width = '800px'
      document.body.append(host)
      window.headingFoldVisualEditor = createEditor({
        element: host,
        outline: false,
        content: '<h1>First</h1><p>Body A</p><h3>Third</h3><p>Body B</p><h6>Sixth</h6><p>Body C</p>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingFoldVisualEditor));
  return page.locator("#heading-fold-visibility");
}

test("heading fold controls follow pointer, collapse and keyboard focus", async ({ page }) => {
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");
  const heading = prose.locator("h3");
  const toggle = heading.locator(".semlo-editor-heading-fold-toggle");
  const body = prose.getByText("Body B", { exact: true });

  await page.mouse.move(1100, 10);
  await expect(toggle).toHaveCSS("opacity", "0");
  await heading.click();
  await page.mouse.move(1100, 10);
  await expect(prose).toBeFocused();
  await expect(toggle).toHaveCSS("opacity", "0");

  await heading.hover();
  await expect(toggle).toHaveCSS("opacity", "1");
  const geometry = await prose.locator("h1,h3,h6").evaluateAll((headings) =>
    headings.map((element) => {
      const rect = element.getBoundingClientRect();
      const button = element.querySelector(".semlo-editor-heading-fold-toggle")!;
      const buttonRect = button.getBoundingClientRect();
      const iconRect = button.querySelector("svg")!.getBoundingClientRect();
      return {
        left: buttonRect.left - rect.left,
        top: buttonRect.top - rect.top,
        width: buttonRect.width,
        height: buttonRect.height,
        iconWidth: iconRect.width,
        iconHeight: iconRect.height,
      };
    }),
  );
  for (const [index, top] of [9, 4, 2].entries()) {
    expect(geometry[index].left).toBeCloseTo(-20, 1);
    expect(geometry[index].top).toBeCloseTo(top, 1);
    expect(geometry[index].width).toBe(20);
    expect(geometry[index].height).toBe(20);
    expect(geometry[index].iconWidth).toBe(16);
    expect(geometry[index].iconHeight).toBe(16);
  }

  await toggle.hover();
  await expect(toggle).toHaveCSS("background-color", "rgb(244, 245, 245)");
  await toggle.click();
  await expect(body).toBeHidden();
  await page.mouse.move(1100, 10);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveCSS("opacity", "1");
  await expect(toggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.keyboard.press("Tab");
  await toggle.focus();
  await expect(toggle).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(body).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
});

test("fold controls remain discoverable and usable without hover", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 800, height: 720 },
  });
  try {
    const page = await context.newPage();
    const host = await mount(page);
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    const heading = host.locator(".semlo-editor-prose h3");
    const toggle = heading.locator(".semlo-editor-heading-fold-toggle");
    const body = host.locator(".semlo-editor-prose").getByText("Body B", { exact: true });
    await expect(toggle).toHaveCSS("opacity", "1");
    await toggle.tap();
    await expect(body).toBeHidden();
    await toggle.tap();
    await expect(body).toBeVisible();
  } finally {
    await context.close();
  }
});
