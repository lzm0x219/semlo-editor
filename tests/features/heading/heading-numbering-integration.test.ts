import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    headingNumberingIntegration?: EditorController[];
    numberingPopupProbe?: { heading: Element; marker: Element; menu: Element };
  }
}

async function mount(page: Page, count = 1) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      window.headingNumberingIntegration = []
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'numbering-editor-' + index
        document.body.append(host)
        window.headingNumberingIntegration.push(createEditor({
          element: host,
          outline: false,
          content: '<h3 data-semlo-editor-heading-numbering="mixed">编号一</h3><p>间隔正文</p><h3 data-semlo-editor-heading-numbering="mixed">编号二</h3>',
        }))
      }
    `,
  });
  await page.waitForFunction((n) => window.headingNumberingIntegration?.length === n, count);
  return page.locator("#numbering-editor-0");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("numbering menu keeps the editor usable and applies one undoable style change", async ({ page }) => {
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");
  const headings = prose.locator(":scope > h3");
  const markers = headings.locator(".semlo-editor-heading-number");
  await expect(markers).toHaveText(["1. ", "2. "]);
  await expect(headings.first().getByRole("button", { name: "1." })).toHaveAttribute("aria-description", "设置编号");
  await headings.first().click();
  await page.keyboard.press("End");
  await markers.first().click();
  const menu = page.getByRole("menu", { name: "设置编号" });
  await expect(menu).toBeVisible();
  await expect(prose).toBeFocused();
  await markers.first().click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await page.evaluate(() => {
    window.numberingPopupProbe = {
      heading: document.querySelector("#numbering-editor-0 .semlo-editor-prose > h3")!,
      marker: document.querySelector("#numbering-editor-0 .semlo-editor-heading-number")!,
      menu: document.querySelector(".semlo-editor-heading-numbering-menu")!,
    };
  });
  await page.keyboard.insertText("追加");
  await expect(headings.first()).toContainText("编号一追加");
  await expect(menu).toBeVisible();
  await expect(prose).toBeFocused();
  expect(
    await page.evaluate(() => {
      const currentMarker = document.querySelector("#numbering-editor-0 .semlo-editor-heading-number")!;
      return {
        sameHeading:
          window.__semloRequireFixture("numberingPopupProbe").heading ===
          document.querySelector("#numbering-editor-0 .semlo-editor-prose > h3"),
        markerReplaced: window.__semloRequireFixture("numberingPopupProbe").marker !== currentMarker,
        sameMenu:
          window.__semloRequireFixture("numberingPopupProbe").menu ===
          document.querySelector(".semlo-editor-heading-numbering-menu"),
        expanded: currentMarker.getAttribute("aria-expanded"),
        controls:
          currentMarker.getAttribute("aria-controls") === window.__semloRequireFixture("numberingPopupProbe").menu.id,
      };
    }),
  ).toEqual({ sameHeading: true, markerReplaced: true, sameMenu: true, expanded: "true", controls: true });
  await expect(menu.getByRole("menuitemradio", { name: /混合层级/ })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /中文层级/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(markers).toHaveText(["一、 ", "二、 "]);
  const after = await page.evaluate(() => window.__semloRequireFixture("headingNumberingIntegration")[0].getSnapshot());
  expect(
    after.json.content
      ?.filter((node) => node.type === "heading")
      .map((node) => node.attrs?.semloEditorHeadingNumbering),
  ).toEqual(["chinese", "chinese"]);
  expect(after.text).toContain("编号一追加");
  expect(after.text).not.toContain("一、");
  expect(after.html).toContain("一、");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(markers).toHaveText(["1. ", "2. "]);
  await expect(headings.first()).toContainText("编号一追加");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(markers).toHaveText(["一、 ", "二、 "]);
});

test("replacing a marker while the keyboard menu is focused preserves the menu and its focus", async ({ page }) => {
  const host = await mount(page);
  const marker = host.locator(".semlo-editor-heading-number").first();
  await marker.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "设置编号" });
  const selected = menu.getByRole("menuitemradio", { name: /混合层级/ });
  await expect(selected).toBeFocused();
  await page.evaluate(() => {
    window.numberingPopupProbe = {
      heading: document.querySelector("#numbering-editor-0 .semlo-editor-prose > h3")!,
      marker: document.querySelector("#numbering-editor-0 .semlo-editor-heading-number")!,
      menu: document.querySelector(".semlo-editor-heading-numbering-menu")!,
    };
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingNumberingIntegration")[0].editor;
    editor.view.dispatch(editor.state.tr.insertText("新", 2));
  });
  await expect(menu).toBeVisible();
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-checked", "true");
  expect(
    await page.evaluate(() => ({
      sameHeading:
        window.__semloRequireFixture("numberingPopupProbe").heading ===
        document.querySelector("#numbering-editor-0 .semlo-editor-prose > h3"),
      markerReplaced:
        window.__semloRequireFixture("numberingPopupProbe").marker !==
        document.querySelector("#numbering-editor-0 .semlo-editor-heading-number"),
      sameMenu:
        window.__semloRequireFixture("numberingPopupProbe").menu ===
        document.querySelector(".semlo-editor-heading-numbering-menu"),
    })),
  ).toEqual({ sameHeading: true, markerReplaced: true, sameMenu: true });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(marker).toBeFocused();
});

test("replacing or deleting the numbered heading closes its old menu", async ({ page }) => {
  const host = await mount(page);
  const menu = page.getByRole("menu", { name: "设置编号" });
  await host.locator(".semlo-editor-prose > h3").first().click();
  await host.locator(".semlo-editor-heading-number").first().click();
  await expect(menu).toBeVisible();
  await page.evaluate(() =>
    window
      .__semloRequireFixture("headingNumberingIntegration")[0]
      .setContent('<h3 data-semlo-editor-heading-numbering="mixed">替换标题</h3>'),
  );
  await expect(menu).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose > h3")).toContainText("替换标题");
  await host.locator(".semlo-editor-prose > h3").click();
  await host.locator(".semlo-editor-heading-number").click();
  await expect(menu).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingNumberingIntegration")[0].editor;
    editor.commands.deleteRange({ from: 0, to: editor.state.doc.firstChild!.nodeSize });
  });
  await expect(menu).toHaveCount(0);
});

test("switching an editor to read-only closes its open numbering menu", async ({ page }) => {
  const host = await mount(page);
  await host.locator(".semlo-editor-prose > h3").first().click();
  await host.locator(".semlo-editor-heading-number").first().click();
  const menu = page.getByRole("menu", { name: "设置编号" });
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("headingNumberingIntegration")[0].setEditable(false));
  await expect(menu).toHaveCount(0);
  await expect(host.locator(".semlo-editor-heading-number").first()).toHaveAttribute("aria-disabled", "true");
});

test("destroying the owning editor removes its numbering popup without affecting another editor", async ({ page }) => {
  const first = await mount(page, 2);
  const second = page.locator("#numbering-editor-1");
  await first.locator(".semlo-editor-prose > h3").first().click();
  await first.locator(".semlo-editor-heading-number").first().click();
  await expect(page.getByRole("menu", { name: "设置编号" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("headingNumberingIntegration")[0].destroy());
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
  await expect(second.locator(".semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
  const secondMarker = second.locator(".semlo-editor-heading-number").first();
  await secondMarker.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "设置编号" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
  await expect(secondMarker).toBeFocused();
  await page.evaluate(() => window.__semloRequireFixture("headingNumberingIntegration")[1].setEditable(false));
  await expect(secondMarker).toHaveAttribute("aria-disabled", "true");
  await secondMarker.click({ force: true });
  await expect(page.getByRole("menu", { name: "设置编号" })).toHaveCount(0);
});
