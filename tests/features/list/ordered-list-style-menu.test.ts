import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

test("the style previews open, select a style, and support keyboard dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.setContent('<button id="anchor" style="position:fixed; right:8px; top:40px">列表样式</button>');
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/list/ordered-style-menu.css", "utf8") });
  const script = ["platform/dom/popup-owner.ts", "platform/dom/dropdown.ts", "features/list/ordered-style-menu.ts"]
    .map((name) =>
      stripTypeScriptTypes(readFileSync(`packages/core/src/${name}`, "utf8")).replace(/^import .*\n/gm, ""),
    )
    .join("\n");
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const anchor = document.querySelector('#anchor')
      anchor.setAttribute('aria-expanded', 'false')
      anchor.onclick = event => {
        openOrderedListStyleMenu(anchor, 'mixed', style => { anchor.dataset.selected = style }, event.detail === 0)
      }
    `,
  });
  const anchor = page.getByRole("button", { name: "列表样式" });
  await anchor.click();
  const menu = page.getByRole("menu", { name: "有序列表样式" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await expect(menu.getByRole("menuitemradio", { name: "数字、字母和罗马数字" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await menu.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(312);
  await menu.getByRole("menuitemradio", { name: "中文数字" }).click();
  await expect(anchor).toHaveAttribute("data-selected", "chinese");
  await expect(menu).toHaveCount(0);
  await anchor.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "数字、字母和罗马数字" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitemradio", { name: "中文数字" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(anchor).toBeFocused();
  await expect(menu).toHaveCount(0);
  await expect(anchor).toHaveAttribute("aria-expanded", "false");
});
