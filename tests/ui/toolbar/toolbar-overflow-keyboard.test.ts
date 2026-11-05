import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test("keyboard activation enters the overflow and Escape returns to its trigger", async ({ page }) => {
  await page.setContent(`
    <div id="shell" style="width: 100px">
      <div id="toolbar" style="display: flex; width: 100%; overflow: hidden">
        <button style="flex: none; width: 60px">一</button>
        <button disabled style="flex: none; width: 60px">二</button>
        <button style="flex: none; width: 60px">三</button>
      </div>
    </div>
  `);
  const script = stripTypeScriptTypes(readFileSync("packages/core/src/ui/toolbar/overflow.ts", "utf8"));
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const toolbar = document.querySelector('#toolbar')
      const more = document.createElement('button')
      more.textContent = '更多'
      more.style.cssText = 'flex: none; width: 40px'
      mountToolbarOverflow(toolbar, document.querySelector('#shell'), more)
    `,
  });
  const more = page.getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "三" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(page.getByRole("toolbar", { name: "更多工具" })).toBeHidden();
});

test("the overflow remains anchored to a sticky toolbar in a narrow scrolling container", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await page.setContent(`
    <div class="semlo-editor" id="shell" style="width: 220px; height: 180px; overflow: auto; --semlo-editor-toolbar-sticky-top: 10px">
      <div class="semlo-editor-toolbar" id="toolbar">
        ${Array.from({ length: 10 }, (_, index) => `<button class="semlo-editor-button">${index}</button>`).join("")}
      </div>
      <div style="height: 800px"></div>
    </div>
  `);
  await page.addStyleTag({
    content: [readEditorStyles(), readFileSync("packages/core/src/ui/toolbar/overflow.css", "utf8")].join("\n"),
  });
  const script = stripTypeScriptTypes(readFileSync("packages/core/src/ui/toolbar/overflow.ts", "utf8"));
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const toolbar = document.querySelector('#toolbar')
      const more = document.createElement('button')
      more.className = 'semlo-editor-button'
      more.textContent = '…'
      mountToolbarOverflow(toolbar, document.querySelector('#shell'), more)
    `,
  });
  const more = page.getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();
  await more.click();
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await expect(panel).toBeVisible();
  await page.locator("#shell").evaluate((shell) => (shell.scrollTop = 300));
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const shell = document.querySelector("#shell")!.getBoundingClientRect();
        const toolbar = document.querySelector("#toolbar")!.getBoundingClientRect();
        const anchor = document.querySelector(".semlo-editor-toolbar-overflow-more")!.getBoundingClientRect();
        const panel = document.querySelector(".semlo-editor-toolbar-overflow-panel")!.getBoundingClientRect();
        return { sticky: Math.round(toolbar.top - shell.top), popup: Math.round(panel.top - anchor.bottom) };
      }),
    )
    .toEqual({ sticky: 10, popup: 4 });
  await expect(panel).toBeVisible();
});

test("a focused button inside a split control returns to more when the group overflows", async ({ page }) => {
  await page.setContent(`
    <div id="shell" style="width: 200px">
      <div id="toolbar" style="display: flex; width: 100%; overflow: hidden">
        <button style="flex: none; width: 60px">一</button>
        <span style="display: flex; flex: none"><button>有序列表</button><button>列表样式</button></span>
      </div>
    </div>
  `);
  const script = stripTypeScriptTypes(readFileSync("packages/core/src/ui/toolbar/overflow.ts", "utf8"));
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const toolbar = document.querySelector('#toolbar')
      const more = document.createElement('button')
      more.style.cssText = 'flex: none; width: 40px'
      mountToolbarOverflow(toolbar, document.querySelector('#shell'), more)
    `,
  });
  const style = page.getByRole("button", { name: "列表样式" });
  await style.focus();
  await page.locator("#shell").evaluate((element) => ((element as HTMLElement).style.width = "80px"));
  await expect(page.getByRole("button", { name: "更多" })).toBeFocused();
});
