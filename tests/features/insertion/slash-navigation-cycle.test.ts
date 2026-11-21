import { expect, test } from "@rstest/playwright";

test("斜杠菜单用方向键和 Tab 循环选择，确认后回到正文", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      localStorage.setItem('semlo-editor.recent-commands.v1', '["quote","canvas","database"]')
      const host = document.createElement('div')
      host.id = 'slash-navigation-cycle-test'
      document.body.prepend(host)
      createEditor({ element: host, content: '<p></p>' })
    `,
  });

  const prose = page.locator("#slash-navigation-cycle-test .semlo-editor-prose");
  await prose.click();
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "插入内容" });
  const active = menu.locator(".semlo-editor-recent-item.selected, .semlo-editor-card-item.selected");
  await expect(active).toHaveAttribute("data-command", "quote");

  await page.keyboard.press("Shift+Tab");
  await expect(active).toHaveAttribute("data-command", "jinshuju");
  await page.keyboard.press("Tab");
  await expect(active).toHaveAttribute("data-command", "quote");
  await page.keyboard.press("Tab");
  await expect(active).toHaveAttribute("data-command", "canvas");
  await page.keyboard.press("Shift+Tab");
  await expect(active).toHaveAttribute("data-command", "quote");
  await expect(prose).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(active).toHaveAttribute("data-command", "canvas");
  await page.keyboard.press("ArrowUp");
  await expect(active).toHaveAttribute("data-command", "jinshuju");
  await page.keyboard.press("ArrowDown");
  await expect(active).toHaveAttribute("data-command", "quote");
  await expect(prose).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(prose.locator(":scope > blockquote")).toHaveCount(1);
  await expect(prose).toBeFocused();
  await page.keyboard.type("继续输入");
  await expect(prose.locator(":scope > blockquote")).toHaveText("继续输入");
});

test("斜杠 yy 搜索展示已观察的候选，Tab 跳过缺少宿主服务的选项", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'slash-search-cycle-test'
      document.body.prepend(host)
      createEditor({ element: host, content: '<p></p>' })
    `,
  });
  const prose = page.locator("#slash-search-cycle-test .semlo-editor-prose");
  await prose.click();
  await page.keyboard.type("/yy");
  const menu = page.getByRole("listbox", { name: "插入内容" });
  const options = menu.getByRole("option");
  await expect(options).toHaveCount(7);
  expect(await options.evaluateAll((items) => items.map((item) => item.getAttribute("data-command")))).toEqual([
    "quote",
    "yuque",
    "youku",
    "yida",
    "audio",
    "netease",
    "orderedList",
  ]);
  await expect(options.nth(1)).toBeDisabled();
  const active = menu.getByRole("option", { selected: true });
  await expect(active).toHaveAttribute("data-command", "quote");

  await page.keyboard.press("Tab");
  await expect(active).toHaveAttribute("data-command", "youku");
  await expect(prose).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /优酷链接/ })).toBeFocused();
  await expect(prose).not.toContainText("/yy");
});
