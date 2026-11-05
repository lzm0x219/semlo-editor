import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    typographyEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.id = 'typography-test'
      host.style.width = '800px'
      document.body.append(host)
      window.typographyEditor = createEditor({
        element: host,
        outline: false,
        content: '<h1>首段标题</h1><p>普通正文</p><h1>一级标题</h1><h2>二级标题</h2><h3>三级标题</h3><h4>四级标题</h4><h5>五级标题</h5><h6>六级标题</h6><p><span style="font-size:32px">大字号</span></p>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.typographyEditor));
  return page.locator("#typography-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("default typography and heading controls follow the observed document layout", async ({ page }) => {
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");
  const paragraph = prose.locator("p").first();
  await expect(paragraph).toHaveCSS("font-size", "15px");
  await expect(paragraph).toHaveCSS("line-height", "26.1px");
  await expect(paragraph).toHaveCSS("margin-bottom", "7.83px");
  await expect(paragraph).toHaveCSS(
    "font-family",
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif, "Segoe UI"',
  );

  const styles = await prose.locator("h1,h2,h3,h4,h5,h6").evaluateAll((headings) =>
    headings.map((heading) => {
      const computed = getComputedStyle(heading);
      return {
        size: parseFloat(computed.fontSize),
        height: parseFloat(computed.lineHeight),
        weight: computed.fontWeight,
        top: parseFloat(computed.marginTop),
        bottom: parseFloat(computed.marginBottom),
      };
    }),
  );
  const expected = [
    [28, 38, 0, 19],
    [28, 38, 38, 19],
    [24, 34, 34, 17],
    [20, 30, 30, 15],
    [16, 26, 26, 13],
    [15, 24, 24, 12],
    [15, 24, 24, 12],
  ];
  for (const [index, [size, height, top, bottom]] of expected.entries()) {
    expect(styles[index].size).toBe(size);
    expect(styles[index].height).toBeCloseTo(height, 1);
    expect(styles[index].weight).toBe("700");
    expect(styles[index].top).toBe(top);
    expect(styles[index].bottom).toBe(bottom);
  }

  const large = prose.getByText("大字号");
  await expect(large).toHaveCSS("line-height", "55.68px");
  const title = prose.locator("h1").first();
  const toolbarBounds = (await host.locator(".semlo-editor-toolbar").boundingBox())!;
  const insertBounds = (await host.getByRole("button", { name: "插入内容" }).boundingBox())!;
  const paragraphBounds = (await paragraph.boundingBox())!;
  expect(insertBounds.x + insertBounds.width / 2 - toolbarBounds.x).toBeCloseTo(78, 1);
  expect(paragraphBounds.x - toolbarBounds.x).toBeCloseTo(70, 1);
  const textLefts = await page.evaluate(() => {
    const textLeft = (element: Element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode()!;
      const range = document.createRange();
      range.selectNodeContents(text);
      return range.getBoundingClientRect().left;
    };
    const root = document.querySelector("#typography-test .semlo-editor-prose")!;
    return [textLeft(root.querySelector("h1")!), textLeft(root.querySelector("p")!)];
  });
  expect(Math.abs(textLefts[0] - textLefts[1])).toBeLessThan(1);

  await title.hover();
  const toggle = title.getByRole("button", { name: /折叠标题/ });
  const handle = page.getByRole("button", { name: "块操作" });
  await expect(handle).toBeVisible();
  const [text, fold, block] = await Promise.all([title.boundingBox(), toggle.boundingBox(), handle.boundingBox()]);
  expect(text && fold && block).toBeTruthy();
  expect(fold!.x + fold!.width).toBeLessThanOrEqual(text!.x);
  expect(block!.x + block!.width).toBeLessThanOrEqual(fold!.x);
  await toggle.click();
  await expect(paragraph).toBeHidden();
  await title.getByRole("button", { name: /展开标题/ }).click();
  await expect(paragraph).toBeVisible();
});

test("user-set line height overrides the default paragraph and heading rhythm", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("typographyEditor")
      .setContent('<p style="line-height:2">双倍正文</p><h2 style="line-height:1.5">自定义标题</h2>'),
  );
  await expect(host.getByText("双倍正文")).toHaveCSS("line-height", "30px");
  await expect(host.getByText("自定义标题")).toHaveCSS("line-height", "36px");
});

test("blockquote styling keeps multi-paragraph editing, selection and nested content usable", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("typographyEditor")
      .setContent("<p>引用之前</p><blockquote><p>引用第一段</p><p>引用第二段</p></blockquote><p>引用之后</p>"),
  );
  const quote = host.locator("blockquote").first();
  await expect(quote).toHaveCSS("margin-top", "10px");
  await expect(quote).toHaveCSS("margin-bottom", "10px");
  await expect(quote).toHaveCSS("padding-left", "10px");
  await expect(quote).toHaveCSS("padding-top", "0px");
  const quoteGeometry = await quote.evaluate((element) => {
    const line = getComputedStyle(element, "::before");
    const range = document.createRange();
    range.selectNodeContents(element.querySelector("p")!.firstChild!);
    return {
      lineWidth: line.width,
      lineColor: line.backgroundColor,
      contentOffset: range.getBoundingClientRect().left - element.getBoundingClientRect().left,
    };
  });
  expect(quoteGeometry.lineWidth).toBe("2px");
  expect(quoteGeometry.lineColor).toBe("rgb(216, 218, 217)");
  expect(quoteGeometry.contentOffset).toBeCloseTo(10, 1);
  await expect(quote).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(quote.locator("p").first()).toHaveCSS("font-size", "15px");
  await expect(quote.locator("p").first()).toHaveCSS("line-height", "26.1px");
  await expect(quote.locator("p").first()).toHaveCSS("margin-bottom", "7.83px");
  expect((await quote.boundingBox())!.height).toBeCloseTo(60.02, 1);

  await quote.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("追加");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("新段");
  await expect(quote.locator("p")).toHaveCount(3);
  await expect(quote.locator("p").nth(0)).toHaveText("引用第一段追加");
  await expect(quote.locator("p").nth(1)).toHaveText("新段");
  await expect(quote.locator("p").nth(2)).toHaveText("引用第二段");
  await expect(host.getByText("引用之前")).toBeVisible();
  await expect(host.getByText("引用之后")).toBeVisible();

  await quote.locator("p").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  expect(selectedText).toBe("新段");
  await page.waitForFunction(() => {
    const editor = window.__semloRequireFixture("typographyEditor").editor;
    const selection = editor.state.selection;
    return (
      window.getSelection()?.toString() === "新段" &&
      editor.state.doc.textBetween(selection.from, selection.to) === "新段"
    );
  });
  await page.keyboard.press("ControlOrMeta+b");
  await expect(quote.locator("p").nth(1).locator("strong")).toHaveText("新段");

  await page.evaluate(() =>
    window
      .__semloRequireFixture("typographyEditor")
      .setContent("<blockquote><p>外层</p><blockquote><p>嵌套引用</p></blockquote></blockquote>"),
  );
  const nested = host.locator("blockquote blockquote");
  expect(await nested.evaluate((element) => getComputedStyle(element, "::before").width)).toBe("2px");
  await nested.getByText("嵌套引用").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("可编辑");
  await expect(nested.getByText("嵌套引用可编辑")).toBeVisible();
  await expect(host.getByText("外层")).toBeVisible();
});

test("inline code matches the observed appearance without changing code blocks or selected fonts", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("typographyEditor")
      .setContent(
        '<p>前文<code>inline</code><code><span style="font-family:Arial;font-size:22px">较大</span></code></p><pre><code class="language-javascript">const value = 1;</code></pre>',
      ),
  );
  const inline = host.locator(".semlo-editor-prose p code").first();
  await expect(inline).toHaveCSS("font-size", "15px");
  await expect(inline).toHaveCSS("line-height", "16.5px");
  await expect(inline).toHaveCSS("padding-left", "4px");
  await expect(inline).toHaveCSS("padding-top", "0px");
  await expect(inline).toHaveCSS("border-top-width", "1px");
  await expect(inline).toHaveCSS("border-top-color", "rgb(231, 233, 232)");
  await expect(inline).toHaveCSS("border-radius", "4px");
  await expect(inline).toHaveCSS("background-color", "rgba(0, 0, 0, 0.06)");
  await expect(inline).toHaveCSS("font-family", /SFMono-Regular.*Consolas.*Liberation Mono.*Menlo.*Courier/);
  const selected = host.getByText("较大");
  await expect(selected).toHaveCSS("font-size", "22px");
  await expect(selected).toHaveCSS("font-family", /Arial/);

  const codeBlock = host.locator(".semlo-editor-code-card pre code");
  await expect(codeBlock).toHaveCSS("font-size", "14px");
  await expect(codeBlock).toHaveCSS("line-height", "20.3px");
  await expect(codeBlock).toHaveCSS("padding", "0px");
  await expect(codeBlock).toHaveCSS("border-top-width", "0px");
  await expect(codeBlock).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

for (const tag of ["ul", "ol"] as const) {
  test(`${tag} keeps the observed list indentation and spacing around paragraphs`, async ({ page }) => {
    const host = await mount(page);
    await page.evaluate(
      (listTag) =>
        window
          .__semloRequireFixture("typographyEditor")
          .setContent(`<p>前文</p><${listTag}><li><p>第一项</p></li><li><p>第二项</p></li></${listTag}><p>后文</p>`),
      tag,
    );
    const measurements = await host.locator(".semlo-editor-prose").evaluate((root) => {
      const before = root.querySelector(":scope > p")!.getBoundingClientRect();
      const list = root.querySelector(":scope > ul, :scope > ol")!;
      const items = Array.from(list.querySelectorAll(":scope > li > p"), (item) => item.getBoundingClientRect());
      const after = root.querySelector(":scope > p:last-child")!.getBoundingClientRect();
      return {
        indent: items[0].left - before.left,
        first: items[0].top - before.top,
        spacing: items[1].top - items[0].top,
        after: after.top - items[1].top,
      };
    });
    const diagnostic = JSON.stringify(measurements);
    expect(measurements.indent, diagnostic).toBeCloseTo(30, 1);
    expect(measurements.first, diagnostic).toBeCloseTo(33.92, 1);
    expect(measurements.spacing, diagnostic).toBeCloseTo(30.01, 1);
    expect(measurements.after, diagnostic).toBeCloseTo(33.92, 1);
  });
}

test("ordinary nested lists retain markers inside a task item and nested tasks still work", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("typographyEditor").setContent({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "父任务" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "无序子项" }] }],
                    },
                  ],
                },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "有序子项" }] }],
                    },
                  ],
                },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "嵌套任务" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const outerTask = host.locator('ul[data-type="taskList"] > li').first();
  const nestedTask = host.locator('ul[data-type="taskList"] > li').last();
  const bullet = outerTask.locator('ul:not([data-type="taskList"]) > li').first();
  const numbered = outerTask.locator("ol > li").first();
  const styles = await Promise.all(
    [outerTask, nestedTask, bullet, numbered].map((element) =>
      element.evaluate((node) => ({
        display: getComputedStyle(node).display,
        marker: getComputedStyle(node).listStyleType,
      })),
    ),
  );
  expect(styles).toEqual([
    { display: "flex", marker: "none" },
    { display: "flex", marker: "none" },
    { display: "list-item", marker: "circle" },
    { display: "list-item", marker: "decimal" },
  ]);
  const bulletOffset = await bullet.evaluate((element) => {
    const prose = element.closest(".semlo-editor-prose")!;
    const text = element.querySelector("p")!;
    return text.getBoundingClientRect().left - prose.getBoundingClientRect().left;
  });
  expect(bulletOffset).toBeCloseTo(60, 1);
  const taskOffset = await outerTask.evaluate((element) => {
    const prose = element.closest(".semlo-editor-prose")!;
    const text = element.querySelector(":scope > div > p")!;
    return text.getBoundingClientRect().left - prose.getBoundingClientRect().left;
  });
  expect(taskOffset).toBeCloseTo(30, 1);
  await bullet.getByText("无序子项").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("扩充");
  await expect(bullet.getByText("无序子项扩充")).toBeVisible();
  await nestedTask.locator(":scope > label > input").check();
  await expect(nestedTask.locator(":scope > label > input")).toBeChecked();
  await expect(outerTask.locator(":scope > label > input")).not.toBeChecked();
});

test("toolbar sticks below a host header and keeps its insert and overflow panels anchored while scrolling", async ({
  page,
}) => {
  const host = await mount(page);
  await page.evaluate(() => {
    window
      .__semloRequireFixture("typographyEditor")
      .setContent(Array.from({ length: 100 }, (_, i) => `<p>段落 ${i + 1}</p>`).join(""));
    document
      .querySelector<HTMLElement>("#typography-test")!
      .style.setProperty("--semlo-editor-toolbar-sticky-top", "52px");
    window.scrollTo(0, 500);
  });
  const toolbar = host.locator(".semlo-editor-toolbar");
  await expect(toolbar).toHaveCSS("position", "sticky");
  await expect(toolbar).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeCloseTo(52, 0);

  const insert = toolbar.getByRole("button", { name: "插入内容" });
  await insert.click();
  const insertPanel = page.getByRole("dialog", { name: "插入内容" });
  await expect(insertPanel).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 200));
  await expect(insertPanel).toBeVisible();
  const [insertBounds, panelBounds] = await Promise.all([insert.boundingBox(), insertPanel.boundingBox()]);
  expect(Math.abs(panelBounds!.y - (insertBounds!.y + insertBounds!.height))).toBeLessThan(10);
  await page.keyboard.press("Escape");

  const more = toolbar.getByRole("button", { name: "更多", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  await expect(overflow).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 150));
  await expect(overflow).toBeVisible();
  const [moreBounds, overflowBounds] = await Promise.all([more.boundingBox(), overflow.boundingBox()]);
  expect(Math.abs(overflowBounds!.y - (moreBounds!.y + moreBounds!.height))).toBeLessThan(10);
});

test("toolbar sticks inside a scrolling container without escaping its editor", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    window
      .__semloRequireFixture("typographyEditor")
      .setContent(Array.from({ length: 80 }, (_, i) => `<p>内容 ${i + 1}</p>`).join(""));
    const host = document.querySelector<HTMLElement>("#typography-test")!;
    host.style.height = "260px";
    host.style.overflow = "auto";
    host.scrollTop = 400;
  });
  const toolbar = host.locator(".semlo-editor-toolbar");
  await expect
    .poll(async () => {
      const [container, bar] = await Promise.all([host.boundingBox(), toolbar.boundingBox()]);
      return bar!.y - container!.y;
    })
    .toBeCloseTo(0, 0);
  const insert = toolbar.getByRole("button", { name: "插入内容" });
  await insert.click();
  const insertPanel = page.getByRole("dialog", { name: "插入内容" });
  await expect(insertPanel).toBeVisible();
  await host.evaluate((element) => (element.scrollTop += 150));
  await expect(insertPanel).toBeVisible();
  const [insertBounds, panelBounds] = await Promise.all([insert.boundingBox(), insertPanel.boundingBox()]);
  expect(Math.abs(panelBounds!.y - (insertBounds!.y + insertBounds!.height))).toBeLessThan(10);
});

test("an open insert panel follows its toolbar while it becomes sticky", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    window
      .__semloRequireFixture("typographyEditor")
      .setContent(Array.from({ length: 100 }, (_, i) => `<p>内容 ${i + 1}</p>`).join(""));
    const host = document.querySelector<HTMLElement>("#typography-test")!;
    host.style.marginTop = "400px";
    host.style.setProperty("--semlo-editor-toolbar-sticky-top", "52px");
  });
  const toolbar = host.locator(".semlo-editor-toolbar");
  const insert = toolbar.getByRole("button", { name: "插入内容" });
  await insert.click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(panel).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 360));
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeCloseTo(52, 0);
  await expect
    .poll(async () => {
      const [trigger, popup] = await Promise.all([insert.boundingBox(), panel.boundingBox()]);
      return popup!.y - (trigger!.y + trigger!.height);
    })
    .toBeCloseTo(6, 0);
});

test("adjacent long editors release their own sticky toolbars at their boundaries", async ({ page }) => {
  const first = await mount(page);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("typographyEditor")
      .setContent(Array.from({ length: 80 }, (_, i) => `<p>第一篇 ${i + 1}</p>`).join("")),
  );
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'typography-test-second'
      host.style.width = '800px'
      document.body.append(host)
      createEditor({
        element: host,
        outline: false,
        content: Array.from({ length: 80 }, (_, i) => '<p>第二篇 ' + (i + 1) + '</p>').join(''),
      })
    `,
  });
  const second = page.locator("#typography-test-second");
  await expect(second.locator(".semlo-editor-toolbar")).toBeVisible();
  await second.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 100));
  await expect.poll(async () => (await second.locator(".semlo-editor-toolbar").boundingBox())!.y).toBeCloseTo(0, 0);
  const firstBounds = (await first.locator(".semlo-editor-toolbar").boundingBox())!;
  expect(firstBounds.y + firstBounds.height).toBeLessThanOrEqual(0);
});

test("narrow editor containers retain accessible toolbar controls and compact content padding", async ({ page }) => {
  const host = await mount(page);
  await host.evaluate((element) => (element.style.width = "320px"));
  const toolbar = host.locator(".semlo-editor-toolbar");
  await expect(toolbar).toHaveCSS("padding-left", "8px");
  await expect(host.locator(".semlo-editor-content")).toHaveCSS("padding-left", "24px");
  await expect(toolbar.getByRole("button", { name: "插入内容" })).toBeVisible();
  const more = toolbar.getByRole("button", { name: "更多", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole("toolbar", { name: "更多工具" })).toBeVisible();
});

for (const width of [800, 320]) {
  test(`read-only mode keeps editing typography and indentation at ${width}px`, async ({ page }) => {
    const host = await mount(page);
    await host.evaluate((element, value) => (element.style.width = `${value}px`), width);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("typographyEditor")
        .setContent("<h2>标题</h2><p>正文</p><blockquote><p>引用</p></blockquote><ul><li><p>列表项</p></li></ul>"),
    );
    const heading = host.locator("h2");
    if (width === 320) await expect(heading).toHaveClass(/semlo-editor-block-handle-inset/);
    const measure = () =>
      host.locator(".semlo-editor-prose").evaluate((root) => {
        const left = root.getBoundingClientRect().left;
        return ["h2", ":scope > p", "blockquote p", "ul li p"].map((selector) => {
          const element = root.querySelector(selector)!;
          const style = getComputedStyle(element);
          const range = document.createRange();
          range.selectNodeContents(element.lastChild!);
          return {
            size: style.fontSize,
            height: style.lineHeight,
            weight: style.fontWeight,
            left: Math.round((range.getBoundingClientRect().left - left) * 100) / 100,
          };
        });
      });
    const editing = await measure();
    await page.evaluate(() => window.__semloRequireFixture("typographyEditor").setEditable(false));
    await expect(host.locator(".semlo-editor-toolbar")).toBeHidden();
    if (width === 320) {
      await expect(heading).toHaveClass(/semlo-editor-block-handle-inset/);
      await expect(page.locator(".semlo-editor-block-handle:visible")).toHaveCount(0);
    }
    await expect.poll(measure).toEqual(editing);
  });
}

test("framework hosts without a global reset preserve editor chrome sizing without styling host extensions", async ({
  page,
}) => {
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  for (const framework of ["react", "vue", "solid"]) {
    const host = page.locator(`#${framework}`);
    const toolbar = host.locator(".semlo-editor-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS("box-sizing", "border-box");
    await expect(toolbar).toHaveCSS("height", "44px");
    const [bar, add] = await Promise.all([
      toolbar.boundingBox(),
      toolbar.getByRole("button", { name: "插入内容" }).boundingBox(),
    ]);
    expect(add!.x + add!.width / 2 - bar!.x).toBeCloseTo(78, 1);
  }
  await page.locator("#react").getByRole("button", { name: "插入内容" }).click();
  const insertPanel = page.getByRole("dialog", { name: "插入内容" });
  await insertPanel.locator('[data-command="table"]').hover();
  const tableGrid = page.locator(".semlo-editor-table-grid-popover");
  await expect(tableGrid).toBeVisible();
  await expect(tableGrid).toHaveCSS("box-sizing", "border-box");
  await expect(tableGrid).toHaveCSS("width", "150px");
  await tableGrid.getByRole("button", { name: "2行2列" }).click();
  await expect(page.locator("#react .semlo-editor-prose table")).toHaveCount(1);
  const boxSizing = await page.evaluate(() => {
    const makeBox = () => {
      const element = document.createElement("div");
      element.style.cssText = "width:100px;padding:10px;border:2px solid black";
      return element;
    };
    const outside = makeBox();
    const extension = makeBox();
    document.body.append(outside);
    document.querySelector("#react .semlo-editor-prose")!.append(extension);
    const result = [outside, extension].map((element) => ({
      sizing: getComputedStyle(element).boxSizing,
      width: element.getBoundingClientRect().width,
    }));
    outside.remove();
    extension.remove();
    return result;
  });
  expect(boxSizing).toEqual([
    { sizing: "content-box", width: 124 },
    { sizing: "content-box", width: 124 },
  ]);
});
