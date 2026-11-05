import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@rstest/playwright";

import { safeImageLinkURL } from "../../../packages/core/src/features/media/shared/image-link";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

const script = inlineMediaModules([
  "packages/core/src/features/media/shared/image-link.ts",
  "packages/core/src/features/media/image/link-control.ts",
]);
const styles = readFileSync("packages/core/src/features/media/image/link-control.css", "utf8");

declare global {
  interface Window {
    imageLinkHarness?: {
      state: { href: string; openInCurrent: boolean };
      changes: Array<{ href: string; openInCurrent: boolean; kind: string }>;
      setEditable: (editable: boolean) => void;
      replace: (href: string) => void;
      destroy: () => void;
    };
  }
}

async function mount(page: Page) {
  await page.setContent('<div id="toolbar"></div><button id="outside">外部</button>');
  await page.addStyleTag({ content: styles });
  await page.addStyleTag({ content: "#toolbar{position:relative;display:inline-flex;margin:40px;padding:4px}" });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      let editable = true
      const harness = { state: { href: '', openInCurrent: false }, changes: [],
        setEditable(value) { editable = value; control.refresh() },
        replace(href) { control.close(); harness.state = { href, openInCurrent: false }; control.refresh() },
        destroy() { control.destroy() },
      }
      const control = createImageLinkControl({ doc: document, canEdit: () => editable,
        getState: () => harness.state,
        commit: (state, kind) => { harness.state = state; harness.changes.push({...state, kind}); control.refresh() },
      })
      document.querySelector('#toolbar').append(control.button, control.panel)
      window.imageLinkHarness = harness
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageLinkHarness));
  const button = page.getByRole("button", { name: "图片链接" });
  await button.click();
  return { button, panel: page.getByRole("dialog", { name: "图片链接" }) };
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("image URLs allow safe destinations and reject unsafe or malformed ones", () => {
  for (const [value, expected] of [
    ["https://example.com/path", "https://example.com/path"],
    ["http://example.com", "http://example.com"],
    ["example.com/path", "https://example.com/path"],
    ["mailto:hello@example.com", "mailto:hello@example.com"],
    ["/notes", "/notes"],
    ["./notes", "./notes"],
    ["../notes", "../notes"],
    ["#section", "#section"],
  ])
    expect(safeImageLinkURL(value)).toBe(expected);
  for (const value of [
    "",
    "javascript:alert(1)",
    "data:text/html,hi",
    "//example.com",
    "/\\example.com",
    "https:\\example.com",
    "https://example.com/\nother",
    "https://example.com/\u007f",
    "x".repeat(4097),
  ])
    expect(safeImageLinkURL(value)).toBeNull();
  expect(safeImageLinkURL(null)).toBeNull();
});

test("link panel preserves entered spelling, opens in the chosen page and removes only the address", async ({
  page,
}) => {
  const { button, panel } = await mount(page);
  const input = panel.getByRole("textbox", { name: "图片链接地址" });
  const current = panel.getByRole("checkbox", { name: "在当前页面打开" });
  const remove = panel.getByRole("button", { name: "取消链接" });
  await expect(input).toBeFocused();
  await expect(current).not.toBeChecked();
  await expect(remove).toBeHidden();
  await input.fill("example.com/path");
  await expect(remove).toBeVisible();
  await input.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state)).toEqual({
    href: "example.com/path",
    openInCurrent: false,
  });
  await current.check();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state)).toEqual({
    href: "example.com/path",
    openInCurrent: true,
  });
  await page.locator("#outside").click();
  await expect(panel).toBeHidden();
  await button.click();
  await expect(input).toHaveValue("example.com/path");
  await expect(current).toBeChecked();
  await remove.click();
  await expect(input).toHaveValue("");
  await expect(remove).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state)).toEqual({
    href: "",
    openInCurrent: true,
  });
});

test("invalid and stale drafts cannot be committed when closing, replacing or disabling the control", async ({
  page,
}) => {
  const { button, panel } = await mount(page);
  const input = panel.getByRole("textbox", { name: "图片链接地址" });
  await input.fill("javascript:alert(1)");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").changes)).toEqual([]);
  await page.locator("#outside").click();
  await button.click();
  await expect(input).toHaveValue("");
  await input.fill("https://example.com/after-escape");
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(input).toHaveValue("https://example.com/after-escape");
  await page.locator("#outside").click();
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state.href)).toBe(
    "https://example.com/after-escape",
  );

  await button.click();
  await input.fill("https://example.com/old");
  await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").replace("/replacement"));
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state.href)).toBe("/replacement");
  await button.click();
  await input.fill("https://example.com/readonly");
  await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").setEditable(false));
  await expect(panel).toBeHidden();
  await expect(button).toBeDisabled();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state.href)).toBe("/replacement");
});

test("composition does not submit an incomplete link and an outside click saves it", async ({ page }) => {
  const { panel } = await mount(page);
  const input = panel.getByRole("textbox", { name: "图片链接地址" });
  await input.dispatchEvent("compositionstart");
  await input.fill("https://example.com/path");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state.href)).toBe("");
  await input.dispatchEvent("compositionend");
  await page.locator("#outside").click();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageLinkHarness").state.href)).toBe(
    "https://example.com/path",
  );
  await expect(panel).toBeHidden();
});
