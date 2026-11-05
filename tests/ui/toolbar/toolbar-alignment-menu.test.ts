import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

test("alignment choices are inline, expose selection and work with keyboard", async ({ page }) => {
  await page.setContent('<button id="trigger">对齐方式</button>');
  await page.addStyleTag({ content: readFileSync("packages/core/src/ui/toolbar/alignment-menu.css", "utf8") });
  const script = [
    "platform/dom/popup-owner.ts",
    "platform/dom/dropdown.ts",
    "ui/toolbar/icons.ts",
    "ui/toolbar/alignment-menu.ts",
  ]
    .map((name) =>
      stripTypeScriptTypes(readFileSync(`packages/core/src/${name}`, "utf8")).replace(/^import .*\n/gm, ""),
    )
    .join("\n");
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const trigger = document.querySelector('#trigger')
      trigger.onclick = event => openToolbarAlignmentMenu(trigger, 'center', value => { trigger.dataset.value = value }, event.detail === 0)
    `,
  });
  const trigger = page.getByRole("button", { name: "对齐方式" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "对齐方式" });
  const selected = menu.getByRole("menuitemradio", { name: "居中" });
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-checked", "true");
  const bounds = await menu
    .getByRole("menuitemradio")
    .evaluateAll((items) =>
      items.map((item) => ({ top: item.getBoundingClientRect().top, left: item.getBoundingClientRect().left })),
    );
  expect(new Set(bounds.map((item) => item.top)).size).toBe(1);
  expect(bounds.every((item, index) => index === 0 || item.left > bounds[index - 1].left)).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(menu.getByRole("menuitemradio", { name: "右对齐" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("data-value", "right");
  await expect(menu).toHaveCount(0);
});
