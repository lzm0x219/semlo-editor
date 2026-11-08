import { expect, test, type Locator, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    outlineNumberingEditors?: EditorController[];
    outlineNumberingScrollTarget?: string;
  }
}

const mixedHeadings =
  '<h1 data-semlo-editor-heading-numbering="mixed">准备事项</h1>' +
  '<h2 data-semlo-editor-heading-numbering="mixed">整理清单</h2>' +
  '<h1 data-semlo-editor-heading-numbering="mixed">后续安排</h1>';

async function mount(page: Page, content = mixedHeadings, count = 1) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      window.outlineNumberingEditors = []
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'outline-numbering-' + index
        document.body.append(host)
        window.outlineNumberingEditors.push(createEditor({ element: host, content: ${JSON.stringify(content)} }))
      }
    `,
  });
  await page.waitForFunction((n) => window.outlineNumberingEditors?.length === n, count);
  return page.locator("#outline-numbering-0");
}

async function openOutline(page: Page, host: Locator) {
  const nav = host.locator(".semlo-editor-outline");
  const compact = nav.getByRole("button", { name: "展开大纲" });
  if (await compact.isVisible()) {
    await compact.focus();
    await page.keyboard.press("Enter");
  }
  await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeVisible();
  return nav;
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("outline labels match the generated heading numbers and retain folding and jumping", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[0].getSnapshot());
  const nav = await openOutline(page, host);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "a. ", "2. "]);
  await expect(nav.locator(".semlo-editor-outline-link")).toHaveText(["1. 准备事项", "a. 整理清单", "2. 后续安排"]);
  await expect(nav.getByRole("button", { name: "1. 准备事项", exact: true })).toHaveAttribute("title", "1. 准备事项");

  await nav.getByRole("button", { name: "折叠 1. 准备事项" }).click();
  await expect(nav.getByRole("button", { name: "a. 整理清单" })).toHaveCount(0);
  await nav.getByRole("button", { name: "展开 1. 准备事项" }).click();
  await expect(nav.getByRole("button", { name: "a. 整理清单" })).toBeVisible();

  await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>("#outline-numbering-0 .semlo-editor-prose > h1:last-child")!;
    heading.scrollIntoView = () => {
      window.outlineNumberingScrollTarget = heading.textContent ?? "";
    };
  });
  const last = nav.getByRole("button", { name: "2. 后续安排", exact: true });
  await last.click();
  expect(await page.evaluate(() => window.outlineNumberingScrollTarget)).toBe("2. 后续安排");
  await expect(last).toHaveAttribute("aria-current", "location");
  expect(await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[0].getSnapshot())).toEqual(
    before,
  );
});

test("style, level and order changes update outline labels from the same numbering state", async ({ page }) => {
  const host = await mount(page);
  let nav = await openOutline(page, host);
  await nav.getByRole("button", { name: "折叠 1. 准备事项" }).click();
  await host.locator(".semlo-editor-prose .semlo-editor-heading-number").first().click();
  const menu = page.getByRole("menu", { name: "设置编号" });
  await menu.getByRole("menuitemradio", { name: /数字层级/ }).click();
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "1.1. ", "2. "]);
  nav = await openOutline(page, host);
  await expect(nav.getByRole("button", { name: "展开 1. 准备事项" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "1.1. 整理清单" })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[0].editor.commands.undo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "a. ", "2. "]);
  await expect(nav.getByRole("button", { name: "展开 1. 准备事项" })).toBeVisible();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[0].editor.commands.redo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "1.1. ", "2. "]);
  await expect(nav.getByRole("button", { name: "展开 1. 准备事项" })).toBeVisible();
  await nav.getByRole("button", { name: "展开 1. 准备事项" }).click();
  await expect(nav.locator(".semlo-editor-outline-link")).toHaveText(["1. 准备事项", "1.1. 整理清单", "2. 后续安排"]);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.textContent === "整理清单") position = pos;
    });
    const heading = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...heading.attrs, level: 1 }));
  });
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "2. ", "3. "]);
  await expect(nav.locator(".semlo-editor-outline-link")).toHaveText(["1. 准备事项", "2. 整理清单", "3. 后续安排"]);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    const first = editor.state.doc.firstChild!;
    const transaction = editor.state.tr.delete(0, first.nodeSize);
    transaction.insert(transaction.doc.content.size, first);
    editor.view.dispatch(transaction);
  });
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "2. ", "3. "]);
  await expect(nav.locator(".semlo-editor-outline-link")).toHaveText(["1. 整理清单", "2. 后续安排", "3. 准备事项"]);
});

test("plain and empty headings do not add duplicate or missing derived numbers", async ({ page }) => {
  const host = await mount(
    page,
    '<h1 data-semlo-editor-heading-numbering="mixed">甲</h1><h2 data-semlo-editor-heading-numbering="mixed"></h2>' +
      '<h2 data-semlo-editor-heading-numbering="mixed">乙</h2><h1>普通标题</h1>',
  );
  const nav = await openOutline(page, host);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "a. ", "b. "]);
  await expect(nav.locator(".semlo-editor-outline-link")).toHaveText(["1. 甲", "b. 乙", "普通标题"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[0].getSnapshot().text),
  ).not.toContain("b. ");
});

test("folding follows a numbered heading through edits but not through its deletion", async ({ page }) => {
  const host = await mount(
    page,
    '<h1 data-semlo-editor-heading-numbering="mixed">相同</h1><h2>第一子项</h2>' +
      '<h1 data-semlo-editor-heading-numbering="mixed">相同</h1><h2>第二子项</h2>',
  );
  const nav = await openOutline(page, host);
  await nav.getByRole("button", { name: "折叠 1. 相同" }).click();
  await expect(nav.getByRole("button", { name: "第一子项", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "第二子项", exact: true })).toBeVisible();

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text("前插正文"));
    editor.view.dispatch(editor.state.tr.insert(0, paragraph));
  });
  await expect(nav.getByRole("button", { name: "展开 1. 相同" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "第一子项", exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (position < 0 && node.type.name === "heading" && node.textContent === "相同") position = pos;
    });
    editor.view.dispatch(editor.state.tr.insertText("新", position + 1));
  });
  await expect(nav.getByRole("button", { name: "展开 1. 新相同" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "第一子项", exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.textContent === "新相同") position = pos;
    });
    const heading = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(editor.state.tr.delete(position, position + heading.nodeSize));
  });
  await expect(nav.getByRole("button", { name: "第一子项", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "折叠 1. 相同" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "第二子项", exact: true })).toBeVisible();
});

test("outline updates and preserves folding across appended transactions", async ({ page }) => {
  const host = await mount(page, "<h1>主题</h1><h2>子项</h2><h1>其他</h1>");
  const nav = await openOutline(page, host);
  await nav.getByRole("button", { name: "折叠 主题" }).click();
  await page.addScriptTag({
    type: "module",
    content: `
      import { Plugin } from '/dist/index.js'
      const editor = window.outlineNumberingEditors[0].editor
      editor.registerPlugin(new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (transactions.some(tr => tr.getMeta('outline-title'))) return state.tr.insertText('新', 1)
          if (transactions.some(tr => tr.getMeta('outline-before'))) {
            return state.tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text('宿主')))
          }
          return null
        },
      }))
      document.body.dataset.outlineAppendReady = 'true'
    `,
  });
  await page.waitForFunction(() => document.body.dataset.outlineAppendReady === "true");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    editor.view.dispatch(editor.state.tr.setMeta("outline-title", true));
  });
  await expect(nav.getByRole("button", { name: "展开 新主题" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "子项", exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("outlineNumberingEditors")[0].editor;
    const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text("用户"));
    editor.view.dispatch(editor.state.tr.insert(0, paragraph).setMeta("outline-before", true));
  });
  await expect(nav.getByRole("button", { name: "展开 新主题" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "子项", exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: "展开 新主题" }).click();
  await expect(nav.getByRole("button", { name: "子项", exact: true })).toBeVisible();
});

test("read-only and multiple editors keep independent outlines and exported content", async ({ page }) => {
  const first = await mount(page, mixedHeadings, 2);
  const second = page.locator("#outline-numbering-1");
  await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[1].setEditable(false));
  const secondBefore = await page.evaluate(() =>
    window.__semloRequireFixture("outlineNumberingEditors")[1].getSnapshot(),
  );
  const secondNav = await openOutline(page, second);
  await expect(secondNav.locator(".semlo-editor-outline-link")).toHaveText([
    "1. 准备事项",
    "a. 整理清单",
    "2. 后续安排",
  ]);
  await secondNav.getByRole("button", { name: "折叠 1. 准备事项" }).click();
  await expect(secondNav.getByRole("button", { name: "a. 整理清单" })).toHaveCount(0);
  await secondNav.getByRole("button", { name: "展开 1. 准备事项" }).click();
  await secondNav.getByRole("button", { name: "a. 整理清单", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[1].getSnapshot())).toEqual(
    secondBefore,
  );

  await first.locator(".semlo-editor-prose .semlo-editor-heading-number").first().click();
  await page
    .getByRole("menu", { name: "设置编号" })
    .getByRole("menuitemradio", { name: /中文层级/ })
    .click();
  await expect(first.locator(".semlo-editor-outline-link")).toHaveText([
    "一、 准备事项",
    "(一) 整理清单",
    "二、 后续安排",
  ]);
  await expect(second.locator(".semlo-editor-outline-link")).toHaveText(["1. 准备事项", "a. 整理清单", "2. 后续安排"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[1].getSnapshot())).toEqual(
    secondBefore,
  );
  await page.evaluate(() => window.__semloRequireFixture("outlineNumberingEditors")[0].destroy());
  await expect(first.locator(".semlo-editor-outline")).toHaveCount(0);
  await expect(second.locator(".semlo-editor-outline-link")).toHaveText(["1. 准备事项", "a. 整理清单", "2. 后续安排"]);
});
