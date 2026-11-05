import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

const script = stripTypeScriptTypes(readFileSync("packages/core/src/ui/toolbar/overflow.ts", "utf8"));
const ownerScript = stripTypeScriptTypes(readFileSync("packages/core/src/platform/dom/popup-owner.ts", "utf8"));
const styles = [readEditorStyles(), readFileSync("packages/core/src/ui/toolbar/overflow.css", "utf8")].join("\n");

declare global {
  interface Window {
    overflowTest?: {
      controller: { refresh(): void; destroy(): void };
      items: HTMLElement[];
      clicks: string[];
      mount(toolbar: HTMLElement, shell: HTMLElement, more: HTMLButtonElement): { destroy(): void };
    };
    otherOverflowMount?(toolbar: HTMLElement, shell: HTMLElement, more: HTMLButtonElement): { destroy(): void };
    testLinkPopup?(anchor: HTMLElement, popup: HTMLElement): () => void;
    otherLinkPopup?(anchor: HTMLElement, popup: HTMLElement): () => void;
  }
}

async function mount(page: Page) {
  await page.setContent(`
    <div class="semlo-editor" id="overflow-host" style="width: 900px">
      <div class="semlo-editor-toolbar" role="toolbar" aria-label="文本格式">
        <button class="semlo-editor-button" data-item="one" aria-label="一">一</button>
        <button class="semlo-editor-button" data-item="two" aria-label="二">二</button>
        <span class="semlo-editor-separator" data-item="sep1" aria-hidden="true"></span>
        <button class="semlo-editor-dropdown-trigger semlo-editor-heading" data-item="heading" aria-label="段落样式">正文</button>
        <button class="semlo-editor-button" data-item="four" aria-label="四">四</button>
        <button class="semlo-editor-button" data-item="five" aria-label="五">五</button>
        <span class="semlo-editor-separator" data-item="sep2" aria-hidden="true"></span>
        <button class="semlo-editor-button" data-item="six" aria-label="六">六</button>
        <button class="semlo-editor-button" data-item="seven" aria-label="七">七</button>
        <button class="semlo-editor-button" data-item="eight" aria-label="八">八</button>
        <button class="semlo-editor-button" data-item="nine" aria-label="九">九</button>
        <button class="semlo-editor-button" data-item="ten" aria-label="十">十</button>
      </div>
      <div id="editable" contenteditable="true">保留选中内容</div>
    </div>
  `);
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const shell = document.querySelector('#overflow-host')
      const toolbar = shell.querySelector('.semlo-editor-toolbar')
      const items = Array.from(toolbar.children)
      const clicks = []
      for (const item of items) {
        item.addEventListener('mousedown', event => event.preventDefault())
        item.addEventListener('click', () => clicks.push(item.dataset.item))
      }
      const more = document.createElement('button')
      more.className = 'semlo-editor-button'
      more.textContent = 'more'
      toolbar.append(more)
      const controller = mountToolbarOverflow(toolbar, shell, more)
      window.overflowTest = { controller, items, clicks, mount: mountToolbarOverflow }
    `,
  });
  await page.waitForFunction(() => Boolean(window.overflowTest));
}

async function resize(page: Page, width: number) {
  await page.locator("#overflow-host").evaluate((element, value) => {
    element.style.width = `${value}px`;
  }, width);
}

test("resizing moves original controls into more and restores their order", async ({ page }) => {
  await mount(page);
  const more = page.getByRole("button", { name: "更多" });
  await expect(more).toBeHidden();
  await resize(page, 240);
  await expect(more).toBeVisible();
  await more.click();
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "十" })).toBeVisible();
  const identity = await page.evaluate(() => {
    const { items } = window.__semloRequireFixture("overflowTest");
    const current = [
      ...document.querySelector("#overflow-host .semlo-editor-toolbar")!.children,
      ...document.querySelector(".semlo-editor-toolbar-overflow-panel")!.children,
    ].filter((item) => item.hasAttribute("data-item"));
    return current.length === items.length && current.every((item, index) => item === items[index]);
  });
  expect(identity).toBe(true);
  await panel.getByRole("button", { name: "十" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("overflowTest").clicks)).toContain("ten");
  await resize(page, 900);
  await expect(more).toBeHidden();
  await expect(panel).toBeHidden();
  const restored = await page.evaluate(() => {
    const { items } = window.__semloRequireFixture("overflowTest");
    const actual = [...document.querySelector("#overflow-host .semlo-editor-toolbar")!.children].filter((item) =>
      item.hasAttribute("data-item"),
    );
    return actual.length === items.length && actual.every((item, index) => item === items[index]);
  });
  expect(restored).toBe(true);
});

test("opening and using overflow preserves editor selection; Escape and outside clicks close it", async ({ page }) => {
  await mount(page);
  await resize(page, 240);
  const more = page.getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();
  const editable = page.locator("#editable");
  await editable.click();
  await page.evaluate(() => {
    const text = document.querySelector("#editable")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await more.click();
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("保留");
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await panel.getByRole("button", { name: "十" }).click();
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("保留");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await page.mouse.click(600, 300);
  await expect(panel).toBeHidden();
});

test("changing a visible label remeasures and keeps controls reachable", async ({ page }) => {
  await mount(page);
  await resize(page, 430);
  const more = page.getByRole("button", { name: "更多" });
  const before = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("overflowTest")
        .items.filter((item) => item.parentElement?.classList.contains("semlo-editor-toolbar")).length,
  );
  await page.getByRole("button", { name: "段落样式" }).evaluate((element) => {
    element.textContent = "非常长的段落标题样式名称";
  });
  await expect(more).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window
            .__semloRequireFixture("overflowTest")
            .items.filter((item) => item.parentElement?.classList.contains("semlo-editor-toolbar")).length,
      ),
    )
    .toBeLessThan(before);
  await more.click();
  await expect(page.getByRole("toolbar", { name: "更多工具" }).getByRole("button", { name: "十" })).toBeVisible();
});

test("read-only and destroy close the panel, restore controls, and detach observers", async ({ page }) => {
  await mount(page);
  await resize(page, 220);
  const more = page.getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();
  await more.click();
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await expect(panel).toBeVisible();
  await page.locator("#overflow-host").evaluate((element) => element.classList.add("semlo-editor-readonly"));
  await expect(panel).toBeHidden();
  await page.locator("#overflow-host").evaluate((element) => element.classList.remove("semlo-editor-readonly"));
  await expect(more).toBeVisible();
  await more.click();
  await page.evaluate(() => window.__semloRequireFixture("overflowTest").controller.destroy());
  await expect(page.locator(".semlo-editor-toolbar-overflow-panel")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("overflowTest")
        .items.every((item) => item.parentElement?.classList.contains("semlo-editor-toolbar")),
    ),
  ).toBe(true);
  await resize(page, 120);
  await expect(more).toBeHidden();
});

test("an overflow control can open and use a body-mounted submenu", async ({ page }) => {
  await mount(page);
  await resize(page, 240);
  const more = page.getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();
  await page.evaluate(() => {
    const item = window.__semloRequireFixture("overflowTest").items.find((control) => control.dataset.item === "ten")!;
    item.setAttribute("aria-expanded", "false");
    item.addEventListener("click", () => {
      item.setAttribute("aria-expanded", "true");
      const menu = document.createElement("div");
      menu.id = "overflow-test-menu";
      menu.setAttribute("role", "menu");
      item.setAttribute("aria-controls", menu.id);
      menu.style.cssText = "position:fixed;left:600px;top:200px";
      const option = document.createElement("button");
      option.textContent = "选项";
      option.addEventListener("click", () => {
        window.__semloRequireFixture("overflowTest").clicks.push("option");
        item.setAttribute("aria-expanded", "false");
        menu.remove();
      });
      menu.append(option);
      document.body.append(menu);
    });
  });
  await more.click();
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await panel.getByRole("button", { name: "十" }).click();
  await page.getByRole("button", { name: "选项" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("overflowTest").clicks)).toContain("option");
  await expect(panel).toBeVisible();
});

test("clicking another editor’s dialog closes an overflow with an open submenu", async ({ page }) => {
  await mount(page);
  await resize(page, 240);
  await page.evaluate(() => {
    const foreignDialog = document.createElement("div");
    foreignDialog.setAttribute("role", "dialog");
    foreignDialog.setAttribute("aria-label", "另一个编辑器的查找");
    foreignDialog.style.cssText = "position:fixed;left:800px;top:250px";
    foreignDialog.innerHTML = '<input aria-label="另一篇文档的查找内容">';
    document.body.append(foreignDialog);

    const item = window.__semloRequireFixture("overflowTest").items.find((control) => control.dataset.item === "ten")!;
    item.setAttribute("aria-expanded", "false");
    item.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.id = "overflow-test-palette";
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", "当前编辑器的颜色");
      menu.style.cssText = "position:fixed;left:600px;top:200px";
      menu.innerHTML = "<button>当前颜色选项</button>";
      document.body.append(menu);
      item.setAttribute("aria-controls", menu.id);
      item.setAttribute("aria-expanded", "true");
      const outside = (event: Event) => {
        if (menu.contains(event.target as Node) || item.contains(event.target as Node)) return;
        menu.remove();
        item.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", outside, true);
      };
      document.addEventListener("pointerdown", outside, true);
    });
  });
  const more = page.getByRole("button", { name: "更多" });
  await more.click();
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await panel.getByRole("button", { name: "十" }).click();
  await page.getByRole("button", { name: "当前颜色选项" }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("textbox", { name: "另一篇文档的查找内容" }).click();
  await expect(page.getByRole("dialog", { name: "当前编辑器的颜色" })).toHaveCount(0);
  await expect(panel).toBeHidden();
});

test("nested popups and controls in an owned dialog remain usable", async ({ page }) => {
  await mount(page);
  await resize(page, 240);
  await page.evaluate(() => {
    const item = window.__semloRequireFixture("overflowTest").items.find((control) => control.dataset.item === "ten")!;
    item.setAttribute("aria-expanded", "false");
    item.addEventListener("click", () => {
      const dialog = document.createElement("div");
      dialog.id = "owned-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.style.cssText = "position:fixed;left:600px;top:200px";
      dialog.innerHTML = '<input aria-label="查找内容"><button aria-expanded="false">自定义颜色</button>';
      const nestedAnchor = dialog.querySelector("button")!;
      nestedAnchor.addEventListener("click", () => {
        const nested = document.createElement("div");
        nested.id = "owned-color-dialog";
        nested.setAttribute("role", "dialog");
        nested.style.cssText = "position:fixed;left:800px;top:200px";
        nested.innerHTML = '<div role="listbox"><button>颜色选项</button></div>';
        nested
          .querySelector("button")!
          .addEventListener("click", () => window.__semloRequireFixture("overflowTest").clicks.push("color"));
        nestedAnchor.setAttribute("aria-expanded", "true");
        nestedAnchor.setAttribute("aria-controls", nested.id);
        document.body.append(nested);
      });
      item.setAttribute("aria-controls", dialog.id);
      item.setAttribute("aria-expanded", "true");
      document.body.append(dialog);
    });
  });
  await page.getByRole("button", { name: "更多" }).click();
  const panel = page.getByRole("toolbar", { name: "更多工具" });
  await panel.getByRole("button", { name: "十" }).click();
  await page.getByRole("textbox", { name: "查找内容" }).fill("测试");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "自定义颜色" }).click();
  await page.getByRole("button", { name: "颜色选项" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("overflowTest").clicks)).toContain("color");
  await expect(panel).toBeVisible();
});

test("the actual editor keeps its overflow open while using its color and find panels", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: async () => [{ family: "Test Font", fullName: "Test Font", postscriptName: "TestFont", style: "Regular" }],
    });
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "220px";
  });
  const more = toolbar.getByRole("button", { name: "更多" });
  await more.click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const color = overflow.getByRole("button", { name: "文字颜色", exact: true });
  await color.scrollIntoViewIfNeeded();
  await color.click();
  const palette = page.getByRole("dialog", { name: "选择颜色" });
  await palette.getByRole("button", { name: "更多颜色" }).click();
  const custom = page.getByRole("dialog", { name: "自定义颜色" });
  await custom.getByRole("slider", { name: "色相" }).click();
  await custom.getByRole("slider", { name: "色相" }).fill("120");
  await expect(overflow).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const size = overflow.getByRole("button", { name: "字号" });
  await size.scrollIntoViewIfNeeded();
  await size.click();
  await page.getByRole("menuitem", { name: "16px" }).click();
  await expect(overflow).toBeVisible();
  const font = overflow.getByRole("button", { name: "字体", exact: true });
  await font.scrollIntoViewIfNeeded();
  await font.click();
  const fontPanel = page.getByRole("dialog", { name: "选择字体" });
  await fontPanel.getByRole("option", { name: "Test Font" }).click();
  await expect(overflow).toBeVisible();

  const find = overflow.getByRole("button", { name: "查找替换" });
  await find.scrollIntoViewIfNeeded();
  await find.click();
  const findPanel = page.getByRole("dialog", { name: "查找替换" });
  await findPanel.getByRole("textbox", { name: "查找内容" }).click();
  await findPanel.getByRole("textbox", { name: "查找内容" }).fill("编辑");
  await expect(overflow).toBeVisible();

  const link = overflow.getByRole("button", { name: "链接", exact: true });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  const linkForm = page.getByRole("dialog", { name: "插入链接" });
  await linkForm.getByLabel("链接", { exact: true }).click();
  await linkForm.getByLabel("链接", { exact: true }).fill("https://example.com");
  await expect(overflow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(linkForm).toHaveCount(0);
  await expect(page.locator('.semlo-editor-toolbar-overflow-panel [aria-label="链接"]')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("real editors keep their own popups independent across separate bundles", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'other-real-editor'
      host.style.cssText = 'position:fixed;right:8px;bottom:8px;width:520px;height:180px;z-index:20;background:white'
      document.body.append(host)
      window.otherRealEditor = createEditor({ element: host, outline: false, content: '<p>另一篇文档</p>' })
    `,
  });
  const otherEditor = page.locator("#other-real-editor");
  await otherEditor.locator(".semlo-editor-prose").click();
  await page.keyboard.press("Control+f");
  const otherFind = page.getByRole("dialog", { name: "查找替换" }).first();
  await expect(otherFind).toBeVisible();

  const toolbar = page.locator("#editor-host").getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "220px";
  });
  const more = toolbar.getByRole("button", { name: "更多" });
  await more.click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const color = overflow.getByRole("button", { name: "文字颜色", exact: true });
  await color.scrollIntoViewIfNeeded();
  await color.click();
  await expect(page.getByRole("dialog", { name: "选择颜色" })).toBeVisible();
  await otherFind.getByRole("textbox", { name: "查找内容" }).click();
  await expect(overflow).toBeHidden();
  await expect(page.getByRole("dialog", { name: "选择颜色" })).toHaveCount(0);

  await more.click();
  const ownFindButton = overflow.getByRole("button", { name: "查找替换" });
  await ownFindButton.scrollIntoViewIfNeeded();
  await ownFindButton.click();
  const ownFindId = await ownFindButton.getAttribute("aria-controls");
  expect(ownFindId).toBeTruthy();
  const ownFind = page.locator(`[id="${ownFindId}"]`);
  await ownFind.getByRole("textbox", { name: "查找内容" }).click();
  await expect(overflow).toBeVisible();
  await otherFind.getByRole("textbox", { name: "查找内容" }).click();
  await expect(overflow).toBeHidden();
  await expect(ownFind).toBeVisible();
});

test("nested insert menus stay usable from a very narrow toolbar", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "50px";
  });
  await toolbar.getByRole("button", { name: "更多" }).click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const insert = overflow.getByRole("button", { name: "插入内容" });
  await insert.scrollIntoViewIfNeeded();
  await insert.click();
  const insertMenu = page.getByRole("dialog", { name: "插入内容" });
  await insertMenu.locator('[data-command="table"]').hover();
  const grid = page.locator(".semlo-editor-table-grid-popover");
  await expect(grid).toBeVisible();
  await grid.getByRole("button", { name: "2行2列" }).click();
  await expect(page.locator("#editor-host .semlo-editor-prose table")).toHaveCount(1);
  await expect(overflow).toBeVisible();

  // Columns are unavailable inside a table cell. Move the insertion point back
  // to a top-level paragraph before opening the menu again.
  await page.locator("#editor-host .semlo-editor-prose > p").last().click();
  if (!(await overflow.isVisible())) await toolbar.getByRole("button", { name: "更多" }).click();
  await insert.click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="columns"]').hover();
  const columns = page.getByRole("menu", { name: "选择分栏数" });
  await expect(columns).toBeVisible();
  await columns.getByRole("menuitem", { name: "两栏" }).click();
  await expect(overflow).toBeVisible();
});

test("link, image and emoji dialogs opened through the insert menu retain their overflow owner", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("semlo-editor.recent-commands.v1", '["link"]');
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => {
    (element as HTMLElement).style.width = "50px";
  });
  const more = toolbar.getByRole("button", { name: "更多" });
  await more.click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const insert = overflow.getByRole("button", { name: "插入内容" });
  await insert.scrollIntoViewIfNeeded();
  await insert.click();
  const insertMenu = page.getByRole("dialog", { name: "插入内容" });
  await insertMenu.getByLabel("最近使用").getByRole("button", { name: "链接" }).click();
  const linkForm = page.getByRole("dialog", { name: "插入链接" });
  await linkForm.getByLabel("链接", { exact: true }).click();
  await linkForm.getByLabel("链接", { exact: true }).fill("https://example.com");
  await expect(overflow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(linkForm).toHaveCount(0);

  await more.click();
  await insert.scrollIntoViewIfNeeded();
  await insert.click();
  await insertMenu.locator('[data-command="image"]').click();
  const imageForm = page.getByRole("dialog", { name: "插入图片" });
  await imageForm.getByLabel("图片地址").click();
  await imageForm.getByLabel("图片地址").fill("https://example.com/image.png");
  await expect(overflow).toBeVisible();
  await imageForm.getByRole("button", { name: "取消" }).click();
  await expect(imageForm).toHaveCount(0);
  await expect(overflow).toBeVisible();

  await insert.click();
  await insertMenu.locator('[data-command="emoji"]').click();
  const emoji = page.getByRole("dialog", { name: "选择表情" });
  await emoji.getByRole("searchbox", { name: "搜索表情" }).click();
  await emoji.getByRole("searchbox", { name: "搜索表情" }).fill("笑");
  await expect(emoji.locator(".semlo-editor-emoji-item").first()).toBeVisible();
  await emoji.locator(".semlo-editor-emoji-item").first().click();
  await expect(overflow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(emoji).toHaveCount(0);
});

test("popup links stay unique across bundles and safely restore existing attributes", async ({ page }) => {
  await page.setContent('<div id="semlo-editor-popup-1"></div>');
  await page.addScriptTag({ type: "module", content: `${ownerScript}\nwindow.testLinkPopup = linkPopup` });
  await page.addScriptTag({ type: "module", content: `${ownerScript}\nwindow.otherLinkPopup = linkPopup` });
  await page.waitForFunction(() => Boolean(window.otherLinkPopup));
  const result = await page.evaluate(() => {
    const anchor = document.createElement("button");
    anchor.setAttribute("aria-controls", "existing semlo-editor-popup-2");
    const first = document.createElement("div");
    first.id = "original";
    const second = document.createElement("div");
    const unlinkFirst = window.__semloRequireFixture("testLinkPopup").bind(window)(anchor, first);
    const unlinkSecond = window.__semloRequireFixture("otherLinkPopup").bind(window)(anchor, second);
    const ids = [first.id, second.id];
    unlinkFirst();
    const afterFirst = anchor.getAttribute("aria-controls");
    unlinkSecond();
    const afterSecond = anchor.getAttribute("aria-controls");
    const restoredId = first.id;
    const third = document.createElement("div");
    const unlinkThird = window.__semloRequireFixture("testLinkPopup").bind(window)(anchor, third);
    anchor.setAttribute("aria-controls", `${third.id} changed-externally semlo-editor-popup-2`);
    unlinkThird();
    unlinkThird();
    return { ids, afterFirst, afterSecond, restoredId, afterExternalChange: anchor.getAttribute("aria-controls") };
  });
  expect(new Set(result.ids).size).toBe(2);
  expect(result.ids).not.toContain("semlo-editor-popup-1");
  expect(result.ids).not.toContain("semlo-editor-popup-2");
  expect(result.afterFirst).toBe(`existing semlo-editor-popup-2 ${result.ids[1]}`);
  expect(result.afterSecond).toBe("existing semlo-editor-popup-2");
  expect(result.restoredId).toBe("original");
  expect(result.afterExternalChange).toBe("changed-externally semlo-editor-popup-2");
});

test("multiple toolbars are independent when one is opened or destroyed", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>("#overflow-host")!;
    const second = first.cloneNode(true) as HTMLElement;
    second.id = "second-host";
    second.style.width = "200px";
    second.querySelector("#editable")?.removeAttribute("id");
    const toolbar = second.querySelector<HTMLElement>(".semlo-editor-toolbar")!;
    toolbar.querySelector('[aria-label="更多"]')?.remove();
    const more = document.createElement("button");
    more.className = "semlo-editor-button";
    toolbar.append(more);
    document.body.append(second);
    window.__semloRequireFixture("overflowTest").mount(toolbar, second, more);
    first.style.width = "220px";
  });
  const first = page.locator("#overflow-host").getByRole("button", { name: "更多" });
  const second = page.locator("#second-host").getByRole("button", { name: "更多" });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await first.click();
  const panels = page.locator(".semlo-editor-toolbar-overflow-panel");
  await expect(panels.nth(0)).toBeVisible();
  await second.click();
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("overflowTest").controller.destroy());
  await expect(panels).toHaveCount(1);
  await expect(second).toBeVisible();
  await expect(panels.first()).toBeVisible();
});

test("separately loaded bundles assign unique panel ids in the same document", async ({ page }) => {
  await mount(page);
  // A second module evaluation has its own counter, as when the demo source
  // and a separately built package are loaded together.
  await page.addScriptTag({
    type: "module",
    content: `${script}\nwindow.otherOverflowMount = mountToolbarOverflow`,
  });
  await page.waitForFunction(() => Boolean(window.otherOverflowMount));
  await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>("#overflow-host")!;
    const second = first.cloneNode(true) as HTMLElement;
    second.id = "other-bundle-host";
    second.querySelector("#editable")?.removeAttribute("id");
    const toolbar = second.querySelector<HTMLElement>(".semlo-editor-toolbar")!;
    toolbar.querySelector('[aria-label="更多"]')?.remove();
    const more = document.createElement("button");
    more.className = "semlo-editor-button";
    toolbar.append(more);
    document.body.append(second);
    window.__semloRequireFixture("otherOverflowMount").bind(window)(toolbar, second, more);
  });
  const ids = await page
    .locator(".semlo-editor-toolbar-overflow-panel")
    .evaluateAll((panels) => panels.map((panel) => panel.id));
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  const controls = await page
    .locator(".semlo-editor-toolbar-overflow-more")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-controls")));
  expect(controls).toEqual(ids);
});
