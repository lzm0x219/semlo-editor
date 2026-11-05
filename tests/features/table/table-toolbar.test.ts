import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    tableToolbarEditor?: EditorController;
  }
}

const table = {
  type: "table",
  content: ["甲", "乙", "丙"].map((prefix) => ({
    type: "tableRow",
    content: [180, 260, 160].map((width, index) => ({
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: [width] },
      content: [{ type: "paragraph", content: [{ type: "text", text: `${prefix}${index + 1}` }] }],
    })),
  })),
};
const content = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "前文" }] },
    table,
    { type: "paragraph", content: [{ type: "text", text: "后文" }] },
  ],
};

async function mount(page: Page, initial: EditorContent = content) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-toolbar-test'
      host.style.width = '520px'
      document.body.prepend(host)
      window.tableToolbarEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(initial)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableToolbarEditor));
  const host = page.locator("#table-toolbar-test");
  await host.getByRole("cell", { name: "甲1", exact: true }).click();
  const toolbar = page.getByRole("toolbar", { name: "表格工具栏" });
  await expect(toolbar).toBeVisible();
  return { host, toolbar, prose: host.locator(".semlo-editor-prose") };
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").getSnapshot());

async function openHeader(toolbar: ReturnType<Page["getByRole"]>) {
  await toolbar.getByRole("button", { name: "标题行列" }).click();
  return toolbar.getByRole("menu", { name: "标题行列" });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("table header switches and colors survive HTML/JSON and preserve cell contents", async ({ page }) => {
  const { host, toolbar, prose } = await mount(page);
  const before = await snapshot(page);
  const menu = await openHeader(toolbar);
  await menu.getByRole("switch", { name: "标题行" }).click();
  await menu.getByRole("switch", { name: "标题列" }).click();
  await expect(menu.getByRole("switch", { name: "标题行" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("switch", { name: "标题列" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitem", { name: "配色方案" }).click();
  const palette = menu.getByRole("dialog", { name: "表头配色" });
  await palette.getByRole("button", { name: "浅绿配色" }).click();
  const tableElement = prose.locator("table");
  await expect(tableElement).toHaveAttribute("data-semlo-editor-table-header-row", "true");
  await expect(tableElement).toHaveAttribute("data-semlo-editor-table-header-column", "true");
  await expect(tableElement).toHaveAttribute("data-semlo-editor-table-header-background", "#E8F7CF");
  await expect(prose.getByRole("cell", { name: "甲2" })).toHaveCSS("background-color", "rgb(232, 247, 207)");
  await expect(prose.getByRole("cell", { name: "乙1" })).toHaveCSS("background-color", "rgb(232, 247, 207)");
  await expect(prose.getByRole("cell", { name: "乙2" })).not.toHaveAttribute("data-semlo-editor-header-cell", "true");
  await expect(prose.getByRole("cell", { name: "乙2" })).toHaveText("乙2");
  const styled = await snapshot(page);
  expect(styled.text).toBe(before.text);
  for (const data of [styled.html, styled.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("tableToolbarEditor").setContent("<p>临时</p>");
      window.__semloRequireFixture("tableToolbarEditor").setContent(value);
    }, data);
    expect((await snapshot(page)).json).toEqual(styled.json);
    await expect(host.locator("table")).toHaveAttribute("data-semlo-editor-table-header-background", "#E8F7CF");
  }
});

test("header and border changes are separate undo events", async ({ page }) => {
  const { toolbar, prose } = await mount(page);
  const before = await snapshot(page);
  const menu = await openHeader(toolbar);
  await menu.getByRole("switch", { name: "标题行" }).click();
  const withHeader = await snapshot(page);
  await toolbar.getByRole("button", { name: "标题行列" }).click();
  await toolbar.getByRole("button", { name: "隐藏边框" }).click();
  await expect(prose.locator("table")).toHaveAttribute("data-semlo-editor-table-border-hidden", "true");
  await expect(prose.getByRole("cell", { name: "甲1" })).toHaveCSS("border-right-style", "dashed");
  expect(await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(withHeader.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(withHeader.json);
});

test("equal width uses the whole table and fit mode restores the original widths", async ({ page }) => {
  const { host, toolbar, prose } = await mount(page);
  const before = await snapshot(page);
  const cells = () => prose.locator("tr").first().locator("td,th");
  const originalWidths = await cells().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  expect(Math.max(...originalWidths) - Math.min(...originalWidths)).toBeGreaterThan(50);
  const fit = toolbar.getByRole("button", { name: "自适应宽度" });
  await fit.click();
  await expect(fit).toHaveAttribute("aria-pressed", "true");
  await expect(prose.locator("table")).toHaveAttribute("data-semlo-editor-table-fit", "true");
  const fitted = await cells().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  const wrapper = await prose.locator(".tableWrapper").evaluate((item) => item.clientWidth);
  expect(fitted.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(wrapper + 4);
  expect(fitted[0] / fitted[1]).toBeCloseTo(originalWidths[0] / originalWidths[1], 1);
  const fitSnapshot = await snapshot(page);
  await page.evaluate((value) => {
    window.__semloRequireFixture("tableToolbarEditor").setContent("<p>临时</p>");
    window.__semloRequireFixture("tableToolbarEditor").setContent(value);
  }, fitSnapshot.html);
  expect((await snapshot(page)).json).toEqual(fitSnapshot.json);
  await host.getByRole("cell", { name: "甲1" }).click();
  await toolbar.getByRole("button", { name: "自适应宽度" }).click();
  const restored = await cells().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  restored.forEach((width, index) => expect(width).toBeCloseTo(originalWidths[index], 0));
  expect((await snapshot(page)).json).toEqual(before.json);
  await toolbar.getByRole("button", { name: "列等宽" }).click();
  const equal = await cells().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  expect(Math.max(...equal) - Math.min(...equal)).toBeLessThan(2);
  await expect(toolbar.getByRole("button", { name: "列等宽", includeHidden: true })).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("maximum view preserves the document and selection and cleans up on readonly and destroy", async ({ page }) => {
  const { host, toolbar, prose } = await mount(page);
  const before = await snapshot(page);
  const selection = await page.evaluate(() =>
    window.__semloRequireFixture("tableToolbarEditor").editor.state.selection.toJSON(),
  );
  await toolbar.getByRole("button", { name: "最大化表格" }).click();
  await expect(host.locator(".semlo-editor")).toHaveClass(/semlo-editor-table-maximized/);
  await expect(prose.getByText("前文")).toBeHidden();
  await expect(prose.getByText("后文")).toBeHidden();
  await expect(prose.getByRole("cell", { name: "甲1" })).toBeVisible();
  await host.getByRole("button", { name: "返回文档" }).click();
  await expect(prose.getByText("前文")).toBeVisible();
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").editor.state.selection.toJSON()),
  ).toEqual(selection);
  await toolbar.getByRole("button", { name: "最大化表格" }).click();
  await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").setEditable(false));
  await expect(host.locator(".semlo-editor")).not.toHaveClass(/semlo-editor-table-maximized/);
  await expect(toolbar).toBeHidden();
  await page.evaluate(() => window.__semloRequireFixture("tableToolbarEditor").destroy());
  await expect(page.getByRole("toolbar", { name: "表格工具栏" })).toHaveCount(0);
});

test("equalizing while fitted keeps the pre-fit total when fit is disabled", async ({ page }) => {
  const { toolbar, prose } = await mount(page);
  const columns = () => prose.locator("tr").first().locator("td,th");
  const before = await columns().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  const originalTotal = before.reduce((sum, width) => sum + width, 0);
  await toolbar.getByRole("button", { name: "自适应宽度" }).click();
  await toolbar.getByRole("button", { name: "列等宽" }).click();
  const fitted = await columns().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  expect(Math.max(...fitted) - Math.min(...fitted)).toBeLessThan(2);
  await toolbar.getByRole("button", { name: "自适应宽度" }).click();
  const restored = await columns().evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  expect(restored.reduce((sum, width) => sum + width, 0)).toBeCloseTo(originalTotal, 0);
  expect(Math.max(...restored) - Math.min(...restored)).toBeLessThan(2);
});

test("maximum view hides siblings inside the table container and restores them without edits", async ({ page }) => {
  const nested = {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "同块前文" }] },
          table,
          { type: "paragraph", content: [{ type: "text", text: "同块后文" }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "块外正文" }] },
    ],
  };
  const { host, toolbar, prose } = await mount(page, nested);
  const before = await snapshot(page);
  await toolbar.getByRole("button", { name: "最大化表格" }).click();
  await expect(prose.getByText("同块前文")).toBeHidden();
  await expect(prose.getByText("同块后文")).toBeHidden();
  await expect(prose.getByText("块外正文")).toBeHidden();
  await expect(prose.getByRole("cell", { name: "甲1" })).toBeVisible();
  await host.getByRole("button", { name: "返回文档" }).click();
  await expect(prose.getByText("同块前文")).toBeVisible();
  await expect(prose.getByText("同块后文")).toBeVisible();
  await expect(prose.getByText("块外正文")).toBeVisible();
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("row selection hides the text bubble while selecting text still shows it", async ({ page }) => {
  const { host, prose } = await mount(page);
  const bubble = host.locator(".semlo-editor-bubble");
  await prose.getByRole("cell", { name: "甲1" }).hover();
  await page.getByRole("button", { name: "选择第 2 行" }).click();
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  await expect(bubble).toBeHidden();
  await prose.getByRole("cell", { name: "甲1" }).click();
  await expect(prose).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(bubble).toBeVisible();
});

test("the table toolbar avoids covering cells when the table is near the viewport top", async ({ page }) => {
  const { toolbar, prose } = await mount(page);
  const toolbarElement = await toolbar.elementHandle();
  await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>("#table-toolbar-test .tableWrapper")!;
    window.scrollBy(0, wrapper.getBoundingClientRect().top - 12);
  });
  await page.waitForFunction((bar) => {
    const wrapper = document.querySelector<HTMLElement>("#table-toolbar-test .tableWrapper");
    if (!bar || !wrapper || bar.hasAttribute("hidden") || getComputedStyle(bar).visibility === "hidden") return false;
    const a = bar.getBoundingClientRect(),
      b = wrapper.getBoundingClientRect();
    return a.bottom <= b.top || a.top >= b.bottom;
  }, toolbarElement);
  await expect(toolbar).toBeVisible();
  const box = await toolbar.boundingBox();
  const tableBox = await prose.locator(".tableWrapper").boundingBox();
  if (!box || !tableBox) throw new Error("Missing table or toolbar geometry");
  expect(box.y).toBeGreaterThanOrEqual(tableBox.y + tableBox.height);
});

test("header decorations also apply to a table nested inside another table cell", async ({ page }) => {
  const nestedTable = {
    ...table,
    attrs: { semloEditorHeaderColumn: true, semloEditorHeaderBackground: "#E8F7CF", semloEditorHeaderColor: "#2A4200" },
  };
  const nested = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "外层" }] }, nestedTable],
              },
            ],
          },
        ],
      },
    ],
  };
  const { prose } = await mount(page, nested);
  const inner = prose.locator("table").nth(1);
  await expect(inner.getByRole("cell", { name: "甲1", exact: true })).toHaveAttribute(
    "data-semlo-editor-header-cell",
    "true",
  );
  await expect(inner.getByRole("cell", { name: "乙1", exact: true })).toHaveCSS(
    "background-color",
    "rgb(232, 247, 207)",
  );
  await expect(inner.getByRole("cell", { name: "乙2", exact: true })).not.toHaveAttribute(
    "data-semlo-editor-header-cell",
    "true",
  );
});

test("exported header columns follow logical cells through rowspans and round-trip", async ({ page }) => {
  const paragraph = (text: string, bold = false) => ({
    type: "paragraph",
    content: [{ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) }],
  });
  const cell = (text: string, attrs = {}, type = "tableCell", bold = false) => ({
    type,
    attrs,
    content: [paragraph(text, bold)],
  });
  const merged = {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: {
          semloEditorHeaderColumn: true,
          semloEditorHeaderBackground: "#E8F7CF",
          semloEditorHeaderColor: "#2A4200",
        },
        content: [
          { type: "tableRow", content: [cell("甲1", { rowspan: 2 }), cell("甲2", { colspan: 2 })] },
          { type: "tableRow", content: [cell("乙2", {}, "tableHeader", true), cell("乙3")] },
          { type: "tableRow", content: [cell("丙1", { rowspan: 2 }), cell("丙2"), cell("丙3")] },
          { type: "tableRow", content: [cell("丁2"), cell("丁3")] },
        ],
      },
    ],
  };
  const { prose, toolbar } = await mount(page, merged);
  const exported = await snapshot(page);
  await page.evaluate((html) => {
    const reader = document.createElement("div");
    reader.id = "table-toolbar-reader";
    reader.innerHTML = html;
    document.body.append(reader);
  }, exported.html);
  const reader = page.locator("#table-toolbar-reader");
  const readerCell = (name: string) => reader.locator("td,th").filter({ hasText: name });
  for (const name of ["甲1", "丙1"]) {
    await expect(readerCell(name)).toHaveCSS("background-color", "rgb(232, 247, 207)");
  }
  for (const name of ["甲2", "乙2", "乙3", "丙2", "丁2"]) {
    const nonHeader = readerCell(name);
    await expect(nonHeader).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(nonHeader).not.toHaveAttribute("data-semlo-editor-header-cell", "true");
  }
  await expect(readerCell("乙2").locator("strong")).toHaveText("乙2");
  await expect(prose.locator("th").filter({ hasText: "乙2" })).not.toHaveCSS("background-color", "rgb(232, 247, 207)");
  await page.evaluate((html) => window.__semloRequireFixture("tableToolbarEditor").setContent(html), exported.html);
  expect((await snapshot(page)).json).toEqual(exported.json);
  await prose.getByRole("cell", { name: "甲1" }).click();
  const menu = await openHeader(toolbar);
  await menu.getByRole("switch", { name: "标题行" }).click();
  await expect(prose.getByRole("cell", { name: "甲2" })).toHaveCSS("background-color", "rgb(232, 247, 207)");
  await expect(prose.locator("th").filter({ hasText: "乙2" })).not.toHaveCSS("background-color", "rgb(232, 247, 207)");
});

test("the table toolbar avoids a sticky text formatting toolbar", async ({ page }) => {
  const { host, toolbar, prose } = await mount(page);
  await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("#table-toolbar-test .semlo-editor-toolbar")!;
    main.style.position = "sticky";
    main.style.top = "0";
    main.style.zIndex = "10";
    const table = document.querySelector<HTMLElement>("#table-toolbar-test .tableWrapper")!;
    window.scrollBy(0, table.getBoundingClientRect().top - main.getBoundingClientRect().height - 12);
  });
  const bar = await toolbar.elementHandle();
  await page.waitForFunction((element) => {
    const table = document.querySelector<HTMLElement>("#table-toolbar-test .tableWrapper")!;
    const main = document.querySelector<HTMLElement>("#table-toolbar-test .semlo-editor-toolbar")!;
    if (!element || element.hasAttribute("hidden") || getComputedStyle(element).visibility === "hidden") return false;
    const floating = element.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return floating.top >= tableRect.bottom && (floating.top >= mainRect.bottom || floating.bottom <= mainRect.top);
  }, bar);
  const [floating, tableRect, mainRect] = await Promise.all([
    toolbar.boundingBox(),
    prose.locator(".tableWrapper").boundingBox(),
    host.locator(".semlo-editor-toolbar").boundingBox(),
  ]);
  if (!floating || !tableRect || !mainRect) throw new Error("Missing toolbar geometry");
  expect(floating.y).toBeGreaterThanOrEqual(tableRect.y + tableRect.height);
  expect(floating.y).toBeGreaterThanOrEqual(mainRect.y + mainRect.height);
});
