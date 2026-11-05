import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    headingStyleEditors?: EditorController[];
  }
}

async function mount(page: Page, count = 1, customContent?: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      window.headingStyleEditors = []
      const content = ${JSON.stringify(customContent ?? null)} ?? ('<p>正文文字</p>' +
        [1, 2, 3, 4, 5, 6].map(level => '<h' + level + '>标题' + level + '文字</h' + level + '>').join('') +
        '<p>结尾文字</p>')
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'heading-style-' + index
        document.body.append(host)
        const controller = createEditor({ element: host, outline: false, content })
        host.querySelector('.semlo-editor-content').style.padding = '8px 40px'
        host.querySelector('.semlo-editor-prose').style.minHeight = '80px'
        window.headingStyleEditors.push(controller)
      }
    `,
  });
  await page.waitForFunction((n) => window.headingStyleEditors?.length === n, count);
  return page.locator("#heading-style-0");
}

async function selectBlocks(page: Page, first: number, last = first, editorIndex = 0, backward = false) {
  await page.evaluate(
    ({ first, last, editorIndex, backward }) => {
      const editor = window.__semloRequireFixture("headingStyleEditors")[editorIndex].editor;
      const blocks: Array<{ start: number; end: number }> = [];
      editor.state.doc.forEach((node, pos) => blocks.push({ start: pos + 1, end: pos + node.nodeSize - 1 }));
      const from = blocks[first].start;
      const to = blocks[last].end;
      editor.view.focus();
      editor.commands.setTextSelection({ from: backward ? to : from, to: backward ? from : to });
    },
    { first, last, editorIndex, backward },
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("each paragraph style has a leading checked item and keeps its shortcut", async ({ page }) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "段落样式" });
  for (let level = 0; level <= 6; level += 1) {
    await selectBlocks(page, level);
    await expect(trigger).toHaveText(level ? `标题${level}` : "正文");
    await trigger.click();
    const menu = page.getByRole("menu", { name: "段落样式" });
    const rows = menu.getByRole("menuitemradio");
    await expect(rows).toHaveCount(7);
    await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveCount(1);
    const checked = menu.getByRole("menuitemradio", { name: level ? `标题${level}` : "正文", checked: true });
    await expect(checked.locator(".semlo-editor-dropdown-check")).toHaveText("✓");
    await expect(checked.locator(".semlo-editor-dropdown-shortcut")).toHaveText(`⌥ ⌘ ${level}`);
    await expect(checked).toHaveAttribute("aria-description", `快捷键 ⌥ ⌘ ${level}`);
    await expect(menu).toHaveCSS("border-radius", "8px");
    await expect(menu).toHaveCSS("border-color", "rgb(231, 233, 232)");
    await expect(menu).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.04) 0px 8px 16px 4px");
    expect((await menu.boundingBox())!.width).toBeCloseTo(228.5, 1);
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test("mixed paragraph and heading selection has no checked item, converts both blocks, and undoes once", async ({
  page,
}) => {
  const host = await mount(page, 1, "<p>正文</p><h2>标题</h2><p>末段</p>");
  await selectBlocks(page, 0, 1);
  const trigger = host.getByRole("button", { name: "段落样式" });
  await expect(trigger).toHaveText("");
  await trigger.click();
  const menu = page.getByRole("menu", { name: "段落样式" });
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
  await menu.getByRole("menuitemradio", { name: "标题3" }).click();
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveCount(2);
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-prose > p")).toHaveText(["正文", "末段"]);
  await expect(host.locator(".semlo-editor-prose > h2")).toHaveText("标题");
});

test("only all-heading selections disable main bold and font size; italic and font remain enabled", async ({
  page,
}) => {
  const host = await mount(page);
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  const size = toolbar.getByRole("button", { name: "字号" });
  const bold = toolbar.getByRole("button", { name: "加粗" });
  const italic = toolbar.getByRole("button", { name: "斜体" });
  const font = toolbar.getByRole("button", { name: "字体", exact: true });
  const heading = toolbar.getByRole("button", { name: "段落样式" });
  for (const [first, last, text, disabled] of [
    [0, 0, "正文", false],
    [3, 3, "标题3", true],
    [3, 4, "", true],
    [0, 3, "", false],
  ] as const) {
    await selectBlocks(page, first, last);
    await expect(heading).toHaveText(text);
    if (disabled) {
      await expect(size).toBeDisabled();
      await expect(bold).toBeDisabled();
    } else {
      await expect(size).toBeEnabled();
      await expect(bold).toBeEnabled();
    }
    await expect(italic).toBeEnabled();
    await expect(font).toBeEnabled();
  }
  // The ordinary font size menu retains its existing trailing check mark.
  await size.click();
  const menu = page.getByRole("menu");
  await expect(menu.locator('[data-value="15px"] .semlo-editor-dropdown-shortcut')).toHaveText("✓");
  await expect(menu.locator(".semlo-editor-dropdown-check")).toHaveCount(0);
  await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
});

test("heading size display matches its supported preset, including mixed H5 and H6", async ({ page }) => {
  const host = await mount(page);
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  const size = toolbar.getByRole("button", { name: "字号" });
  const expected = ["", "24px", "", "16px", "14px", "14px"];
  for (let level = 1; level <= 6; level += 1) {
    await selectBlocks(page, level);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("headingStyleEditors")[0].editor;
      editor.commands.setTextSelection(editor.state.selection.from);
    });
    await expect(size).toBeDisabled();
    await expect(size).toHaveText(expected[level - 1]);
    await expect(size).toHaveCSS("opacity", "0.25");
    await expect(toolbar.getByRole("button", { name: "加粗" })).toBeDisabled();
    await expect(toolbar.getByRole("button", { name: "加粗" })).toHaveCSS("opacity", "0.25");
    await expect(toolbar.getByRole("button", { name: "斜体" })).toBeEnabled();
  }
  await selectBlocks(page, 5, 6);
  await expect(toolbar.getByRole("button", { name: "段落样式" })).toHaveText("");
  await expect(size).toBeDisabled();
  await expect(size).toHaveText("14px");
  await selectBlocks(page, 3, 4);
  await expect(size).toHaveText("");
  await selectBlocks(page, 0, 2, 0, true);
  await expect(toolbar.getByRole("button", { name: "段落样式" })).toHaveText("");
  await expect(size).toBeEnabled();
  await expect(size).toHaveCSS("opacity", "1");
  await expect(size).toHaveText("15px");
  await expect(toolbar.getByRole("button", { name: "加粗" })).toBeEnabled();
});

test("a mouse-opened menu leaves arrows with the document; keyboard opening stays operable", async ({ page }) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "段落样式" });
  await selectBlocks(page, 2);
  await trigger.click();
  const menu = page.getByRole("menu", { name: "段落样式" });
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.state.selection.empty),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await selectBlocks(page, 2);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "正文" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "标题3" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveCount(2);
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
});

test("two editors keep their own current heading and popup selection", async ({ page }) => {
  const first = await mount(page, 2);
  const second = page.locator("#heading-style-1");
  await selectBlocks(page, 2, 2, 0);
  await selectBlocks(page, 0, 0, 1);
  await expect(first.getByRole("button", { name: "段落样式" })).toHaveText("标题2");
  await expect(second.getByRole("button", { name: "段落样式" })).toHaveText("正文");
  await first.getByRole("button", { name: "段落样式" }).click();
  await expect(page.getByRole("menuitemradio", { name: "标题2" })).toHaveAttribute("aria-checked", "true");
  await second.getByRole("button", { name: "段落样式" }).click();
  await expect(page.getByRole("menu", { name: "段落样式" })).toHaveCount(1);
  await expect(page.getByRole("menuitemradio", { name: "正文" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "标题1" }).click();
  await expect(second.locator(".semlo-editor-prose > h1")).toHaveCount(2);
  await expect(first.locator(".semlo-editor-prose > h1")).toHaveCount(1);
  await expect(first.getByRole("button", { name: "段落样式" })).toHaveText("标题2");
});

test("the font-size shortcut skips headings while updating selected paragraph text", async ({ page }) => {
  await mount(page, 1, "<p>正文</p><h2>标题</h2>");
  await selectBlocks(page, 1);
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  await page.keyboard.press("ControlOrMeta+Alt+=");
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
  await selectBlocks(page, 0, 1, 0, true);
  await page.keyboard.press("ControlOrMeta+Alt+=");
  const after = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  expect(after.content?.[0].content?.[0].marks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "textStyle", attrs: expect.objectContaining({ fontSize: "16px" }) }),
    ]),
  );
  expect(after.content?.[1]).toEqual(before.content?.[1]);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("the font-size menu changes only paragraph runs in a mixed selection and keeps their other attributes", async ({
  page,
}) => {
  const host = await mount(
    page,
    1,
    '<p><span style="color: rgb(223, 42, 63)">正文</span></p><h2><span style="font-size: 22px">标题</span></h2>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  await selectBlocks(page, 0, 1);
  await host.getByRole("button", { name: "字号" }).click();
  await page.getByRole("menu").locator('[data-value="19px"]').click();
  const after = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  expect(after.content?.[0].content?.[0].marks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "textStyle",
        attrs: expect.objectContaining({ fontSize: "19px", color: "rgb(223, 42, 63)" }),
      }),
    ]),
  );
  expect(after.content?.[1]).toEqual(before.content?.[1]);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("the main bold button toggles paragraph text only in a mixed heading selection", async ({ page }) => {
  const host = await mount(page, 1, "<p><strong>正文</strong></p><h2>标题</h2>");
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  await selectBlocks(page, 0, 1);
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "加粗" }).click();
  await expect(host.locator(".semlo-editor-prose > p strong")).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).content?.[1],
  ).toEqual(before.content?.[1]);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("a partial selection converts the complete block, clears observed marks and restores them in one undo", async ({
  page,
}) => {
  const host = await mount(
    page,
    1,
    '<p><strong><em><u><s><sup><span style="font-size: 16px; color: rgb(223, 42, 63); font-family: Georgia">样式文本</span></sup></s></u></em></strong></p><p><em>未选段落</em></p>',
  );
  const before = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingStyleEditors")[0].editor;
    const snapshot = window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json;
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    return snapshot;
  });
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "标题3" }).click();
  const heading = host.locator(".semlo-editor-prose > h3");
  await expect(heading).toHaveText("样式文本");
  await expect(heading.locator("strong, em, u, s, sup")).toHaveCount(0);
  await expect(heading.locator("span[style]")).toHaveCSS("color", "rgb(223, 42, 63)");
  await expect(heading.locator("span[style]")).toHaveCSS("font-family", "Georgia");
  expect(await heading.locator("span[style]").evaluate((element) => (element as HTMLElement).style.fontSize)).toBe("");
  await expect(host.locator(".semlo-editor-prose > p em")).toHaveText("未选段落");
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("conversion removes subscript and size while preserving link, code, colors and background", async ({ page }) => {
  const host = await mount(
    page,
    1,
    '<p><a href="https://example.com"><code><mark data-color="#ffff00" style="background-color: #ffff00"><sub><span style="font-size: 19px; color: rgb(223, 42, 63)">测试文字</span></sub></mark></code></a></p>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  await selectBlocks(page, 0);
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "标题3" }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  const marks = after.content?.[0].content?.[0].marks ?? [];
  expect(marks.map((mark) => mark.type)).toEqual(expect.arrayContaining(["link", "code", "highlight", "textStyle"]));
  expect(marks.map((mark) => mark.type)).not.toContain("subscript");
  expect(marks.find((mark) => mark.type === "textStyle")?.attrs).toMatchObject({
    fontSize: null,
    color: "rgb(223, 42, 63)",
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("changing heading level and switching back to paragraph both clean the entire block", async ({ page }) => {
  const host = await mount(page, 1, '<h4><em><span style="color: rgb(223, 42, 63)">标题文字</span></em></h4>');
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  for (const [target, element] of [
    ["标题3", "h3"],
    ["正文", "p"],
  ] as const) {
    await selectBlocks(page, 0);
    await host.getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menuitemradio", { name: target }).click();
    const block = host.locator(`.semlo-editor-prose > ${element}`);
    await expect(block).toHaveText("标题文字");
    await expect(block.locator("em")).toHaveCount(0);
    await expect(block.locator("span[style]")).toHaveCSS("color", "rgb(223, 42, 63)");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json),
    ).toEqual(before);
  }
});

test("choosing the current heading level still cleans the block and is undoable", async ({ page }) => {
  const host = await mount(page, 1, "<h3><em>标题文字</em></h3>");
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  await selectBlocks(page, 0);
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "标题3", checked: true }).click();
  await expect(host.locator(".semlo-editor-prose > h3")).toHaveText("标题文字");
  await expect(host.locator(".semlo-editor-prose > h3 em")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("choosing the current paragraph style clears its italic and font size in one undo", async ({ page }) => {
  const host = await mount(page, 1, '<p><em><span style="font-size: 19px">正文文字</span></em></p>');
  const before = await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json);
  await selectBlocks(page, 0);
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "正文", checked: true }).click();
  await expect(host.locator(".semlo-editor-prose > p")).toHaveText("正文文字");
  await expect(host.locator(".semlo-editor-prose > p em, .semlo-editor-prose > p span[style]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingStyleEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});
