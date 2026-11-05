import { expect, test, type Page } from "@rstest/playwright";

async function openPreview(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https:\/\/(?:[^/]+\.)?(?:bilibili\.com|codepen\.io)\//, async (route) => {
    externalRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const selector = page.getByRole("combobox", { name: "选择示例" });
  const host = page.locator("#editor-host");
  await expect(selector).toBeVisible();
  await expect(host.getByRole("textbox", { name: "文档内容" })).toBeVisible();
  return { selector, host, errors, externalRequests };
}

async function appendMarker(page: Page, host: ReturnType<Page["locator"]>, marker: string) {
  const paragraph = host.locator(".semlo-editor-prose p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(marker);
  await expect(host.locator(".semlo-editor-prose")).toContainText(marker);
}

test("the preview exposes every category with working examples and a combined document", async ({ page }) => {
  const { selector, host, errors, externalRequests } = await openPreview(page);
  const expected = [
    ["start", "快速开始"],
    ["custom-toolbar", "自定义工具栏"],
    ["all", "综合示例"],
    ["text", "文字与标题"],
    ["editing", "编辑操作"],
    ["lists", "列表与表格"],
    ["database", "数据表"],
    ["database-gallery", "数据表：画册视图"],
    ["database-board", "数据表：看板视图"],
    ["database-calendar", "数据表：日历视图"],
    ["database-chart", "数据表：图表视图"],
    ["blocks", "内容块与分栏"],
    ["formula", "公式与绘图"],
    ["media", "图片图册与文件"],
    ["tools", "日期日历与提及"],
    ["embed", "第三方嵌入"],
  ];
  for (const [value, title] of expected) {
    await expect(selector.locator(`option[value="${value}"]`)).toHaveText(title);
  }
  await expect(selector).toHaveValue("start");
  await expect(host.locator(".semlo-editor-prose h1").first()).toContainText("在这里，开始写作");

  await selector.selectOption("text");
  await expect(host.locator(".semlo-editor-prose h1")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose h6")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1.", "a.", "2."]);
  await expect(host.locator(".semlo-editor-prose strong")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose a[href]")).not.toHaveCount(0);
  await expect(host.locator('.semlo-editor-prose [data-semlo-editor-indent="1"]')).toContainText("缩进一级");
  await expect(host.locator('.semlo-editor-prose [data-semlo-editor-line-height="2"]')).toContainText("两倍行高");
  await expect(host.locator('.semlo-editor-prose p[style*="text-align: justify"]')).toContainText("两端对齐");
  await expect(host.locator(".semlo-editor-prose p").filter({ hasText: "同一段内的第一行" }).locator("br")).toHaveCount(
    1,
  );

  await selector.selectOption("lists");
  await expect(host.locator(".semlo-editor-prose ul")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose ol")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose table")).not.toHaveCount(0);
  const originalNestedList = host.locator(".semlo-editor-prose > ul").filter({
    has: page.getByText("整理资料", { exact: true }),
  });
  await expect(originalNestedList.locator(':scope > li > ul:not([data-type="taskList"])')).toHaveCount(1);
  await expect(host.locator(".semlo-editor-prose li > ol")).toHaveCount(1);
  const flatNumberedList = host.locator(".semlo-editor-prose ol").filter({
    has: page.locator('li[data-semlo-editor-list-indent="1"]').filter({ hasText: "收集资料" }),
  });
  const flatItems = flatNumberedList.locator(":scope > li");
  await expect(flatItems).toHaveCount(4);
  expect(await flatItems.evaluateAll((items) => items.map((item) => item.getAttribute("value")))).toEqual([
    "1",
    "1",
    "2",
    "2",
  ]);
  await expect(flatNumberedList.locator(':scope > li[data-semlo-editor-list-indent="1"]')).toHaveCount(2);
  const nestedTask = host.locator('ul[data-type="taskList"] ul[data-type="taskList"] > li').first();
  await expect(nestedTask.locator('input[type="checkbox"]')).not.toBeChecked();
  await nestedTask.locator('input[type="checkbox"]').check();
  await expect(nestedTask.locator('input[type="checkbox"]')).toBeChecked();
  await expect(host.locator('.semlo-editor-prose th[colspan="2"]')).toHaveCount(1);
  const fitTable = host.locator('table[data-semlo-editor-table-fit="true"]');
  await expect(fitTable.locator('td[rowspan="2"]')).toHaveText("准备");
  const titledTable = host.locator(
    'table[data-semlo-editor-table-header-row="true"][data-semlo-editor-table-header-column="true"]',
  );
  await expect(titledTable.locator('[data-semlo-editor-sequence="2"]')).toHaveCount(3);
  await expect(titledTable.locator('[data-semlo-editor-header-cell="true"]').first()).toHaveCSS(
    "background-color",
    "rgb(232, 247, 207)",
  );
  await expect(host.locator('table[data-semlo-editor-table-border-hidden="true"]')).toHaveCount(1);
  await expect(host.locator('.semlo-editor-code-card[data-theme="light"]')).toHaveCount(3);
  await expect(host.locator('.semlo-editor-code-card[data-theme="dark"]')).toHaveCount(1);
  const indentationExample = host.locator(".semlo-editor-code-card").filter({ hasText: "function formatExample" });
  await indentationExample.hover();
  await indentationExample.getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
  await expect(indentationExample.locator("code")).toHaveText(
    "function formatExample(name) {\n  if (name) {\n    return name\n  }\n}",
  );
  const foldedCode = host.locator(".semlo-editor-code-card.is-collapsed");
  await expect(foldedCode.getByLabel("代码块名称")).toHaveValue("folded.ts");
  await foldedCode.getByRole("button", { name: "展开代码块" }).click();
  await expect(host.locator(".semlo-editor-code-card.is-collapsed")).toHaveCount(0);

  await selector.selectOption("database");
  await expect(host.locator(".semlo-editor-database").getByLabel("第 1 行 事项")).toHaveValue("收集灵感");
  await expect(host.locator(".semlo-editor-database").getByLabel("第 2 行 状态")).toContainText("进行中");

  for (const [example, kind, content] of [
    ["database-gallery", "gallery", ".semlo-editor-database-gallery"],
    ["database-board", "kanban", ".semlo-editor-database-board"],
    ["database-calendar", "calendar", ".semlo-editor-database-calendar"],
    ["database-chart", "chart", ".semlo-editor-database-chart-card"],
  ]) {
    await selector.selectOption(example);
    const database = host.locator(`.semlo-editor-database[data-semlo-editor-database-view-kind="${kind}"]`);
    await expect(database.locator(content).first()).toBeVisible();
  }

  await selector.selectOption("blocks");
  await expect(host.locator(".semlo-editor-columns-node")).not.toHaveCount(0);
  const twoColumns = host.locator(".semlo-editor-columns-node").first().locator("[data-semlo-editor-column]");
  await expect(twoColumns).toHaveCount(2);
  const columnWidths = await twoColumns.evaluateAll((columns) =>
    columns.map((column) => column.getBoundingClientRect().width),
  );
  expect(columnWidths[0] / columnWidths[1]).toBeCloseTo(2, 1);
  await expect(host.locator('[data-type="details"]')).not.toHaveCount(0);
  await expect(host.locator("[data-semlo-editor-callout]")).toHaveCount(10);
  await expect(host.locator(".semlo-editor-status-node")).toHaveCount(8);
  const foldedDetails = host.locator('[data-type="details"]').filter({ hasText: "点击展开折叠的内容" });
  await expect(foldedDetails.getByText("这是最初收起的内容。")).toBeHidden();
  await foldedDetails.getByRole("button", { name: "展开内容" }).click();
  await expect(foldedDetails.getByText("这是最初收起的内容。")).toBeVisible();

  await selector.selectOption("formula");
  await expect(host.locator(".katex")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-diagram")).toHaveCount(4);
  await expect(host.locator(".semlo-editor-diagram-preview-content svg")).toHaveCount(4, { timeout: 30_000 });

  await selector.selectOption("media");
  const images = host.locator(".semlo-editor-image-node");
  await expect(images).toHaveCount(6);
  await expect(images.nth(1)).toHaveAttribute("data-semlo-editor-image-align", "center");
  await expect(images.nth(1).locator("xpath=..")).toHaveCSS("text-align", "center");
  await expect(images.nth(1).locator(".semlo-editor-image-frame > img")).toHaveAttribute(
    "data-semlo-editor-image-style",
    "shadow",
  );
  await expect(images.nth(1).getByLabel("图片描述内容")).toHaveValue("海岸微风 · 示例描述");
  await expect(images.nth(2)).toHaveAttribute("data-semlo-editor-image-align", "right");
  await expect(images.nth(2).locator("xpath=..")).toHaveCSS("text-align", "right");
  await expect(images.nth(2).locator(".semlo-editor-image-frame > img")).toHaveAttribute(
    "data-semlo-editor-image-style",
    "border",
  );
  await expect(images.nth(2).getByLabel("图片描述内容")).toBeHidden();
  await expect(images.nth(2).getByLabel("图片描述内容")).toHaveValue("花园午后 · 隐藏的示例描述");
  await expect(images.nth(2).locator('a[href="https://example.com/"]')).toHaveAttribute("target", "_self");
  const rotated = images.nth(3).locator(".semlo-editor-image-frame");
  await expect(rotated.locator("img")).toHaveCSS("transform", /^matrix\(0, -1, 1, 0,/);
  const rotatedBounds = (await rotated.boundingBox())!;
  expect(rotatedBounds.width / rotatedBounds.height).toBeCloseTo(180 / 320, 2);
  const cropped = images.nth(4).locator(".semlo-editor-image-frame");
  await expect(cropped.locator("img")).toHaveCSS("clip-path", /inset\(/);
  const croppedBounds = (await cropped.boundingBox())!;
  expect(croppedBounds.width / croppedBounds.height).toBeCloseTo(240 / 189, 2);
  const mixedParagraph = images.nth(5).locator("xpath=..");
  await expect(mixedParagraph).toContainText("图片前的文字");
  await expect(mixedParagraph).toContainText("图片后的文字");
  await images.first().hover();
  await images.first().getByRole("button", { name: "预览图片" }).click();
  const preview = page.getByRole("dialog", { name: "图片预览" });
  await expect(preview.getByRole("toolbar", { name: "图片预览工具" })).toContainText("1 / 6");
  await preview.getByRole("button", { name: "下一张" }).click();
  await expect(preview.getByRole("toolbar", { name: "图片预览工具" })).toContainText("2 / 6");
  await preview.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(host.locator(".semlo-editor-gallery img")).not.toHaveCount(0);
  await expect(
    host.locator('.semlo-editor-gallery a.semlo-editor-gallery-image[href="https://example.com/"]'),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      host
        .locator(".semlo-editor-image-node img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  // Gallery images load lazily, so bring each gallery into view before checking
  // the images it actually displays. Hidden carousel slides need not be loaded.
  const galleries = host.locator(".semlo-editor-gallery");
  for (const gallery of await galleries.all()) {
    await gallery.scrollIntoViewIfNeeded();
    const visibleImages = gallery.locator("img:visible");
    await expect(visibleImages).not.toHaveCount(0);
    await expect
      .poll(() =>
        visibleImages.evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
        ),
      )
      .toBe(true);
  }
  await expect(host.locator(".semlo-editor-attachment")).not.toHaveCount(0);
  for (const kind of ["video", "audio"]) {
    const player = host.locator(kind);
    await expect(player).toHaveCount(1);
    await player.evaluate((element) => {
      const media = element as HTMLMediaElement;
      media.muted = true;
      return media.play();
    });
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLMediaElement).currentTime))
      .toBeGreaterThan(0.1);
    const state = await player.evaluate((element) => {
      const media = element as HTMLMediaElement;
      media.pause();
      return { duration: media.duration, error: media.error?.code ?? null };
    });
    expect(state.duration).toBeGreaterThan(0);
    expect(state.error).toBeNull();
  }

  await selector.selectOption("tools");
  await expect(host.locator(".semlo-editor-date-node")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-calendar-node")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-mention")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-calendar-node").getByRole("button", { name: "日程：周末阅读" })).toHaveCount(
    2,
  );

  await selector.selectOption("embed");
  await expect(host.getByLabel("哔哩哔哩链接")).toBeVisible();
  await expect(host.getByLabel("CodePen链接")).toBeVisible();
  await expect(host.locator(".semlo-editor-embed iframe")).toHaveCount(0);

  await page.getByRole("button", { name: "查看全部示例" }).click();
  await expect(selector).toHaveValue("all");
  await expect(host.locator(".semlo-editor-prose h1").filter({ hasText: "编辑操作" })).toHaveCount(1);
  await expect(host.locator(".semlo-editor-prose table")).not.toHaveCount(0);
  const databases = host.locator(".semlo-editor-database");
  await expect(databases).toHaveCount(5);
  await expect(databases.first().getByLabel("第 1 行 事项")).toHaveValue("收集灵感");
  for (const kind of ["gallery", "kanban", "calendar", "chart"])
    await expect(host.locator(`.semlo-editor-database[data-semlo-editor-database-view-kind="${kind}"]`)).toHaveCount(1);
  await expect(host.locator(".semlo-editor-gallery img")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-calendar-node")).not.toHaveCount(0);
  await expect(host.locator(".semlo-editor-diagram")).toHaveCount(4);
  await expect(host.locator(".semlo-editor-diagram-preview-content svg")).toHaveCount(4, { timeout: 30_000 });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

for (const method of ["shortcut", "menu"] as const) {
  test(`the nested list exercise converts the middle item by ${method}`, async ({ page }) => {
    const { selector, host, errors } = await openPreview(page);
    await selector.selectOption("lists");

    const prose = host.locator(".semlo-editor-prose");
    const paragraph = (text: string) => prose.locator("p").filter({ hasText: new RegExp(`^${text}$`) });
    const exercise = prose.locator(":scope > ul").filter({ has: page.getByText("筹备写作", { exact: true }) });
    const checkOriginal = async () => {
      await expect(exercise).toHaveCount(1);
      await expect(exercise.locator(":scope > li > p")).toHaveText("筹备写作");
      const middle = exercise.locator(":scope > li > ul > li");
      await expect(middle).toHaveCount(2);
      await expect(middle.nth(0).locator(":scope > p")).toHaveText("编辑提纲");
      await expect(middle.nth(0).locator(":scope > ul > li > p")).toHaveText("梳理段落内容");
      await expect(middle.nth(1).locator(":scope > p")).toHaveText("安排发布时间");
    };
    await checkOriginal();

    const remaining = ["筹备写作", "梳理段落内容", "安排发布时间"];
    const listAppearance = async (text: string) =>
      paragraph(text).evaluate((element) => ({
        left: element.getBoundingClientRect().left,
        marker: getComputedStyle(element.parentElement!).listStyleType,
      }));
    const before = await Promise.all(remaining.map(listAppearance));
    await paragraph("编辑提纲").click();
    await expect(prose).toBeFocused();
    if (method === "shortcut") {
      await page.keyboard.press("ControlOrMeta+Alt+3");
    } else {
      await host.getByRole("button", { name: "段落样式" }).click();
      await page.getByRole("menu", { name: "段落样式" }).getByRole("menuitemradio", { name: "标题3" }).click();
    }

    const converted = prose.locator(":scope > h3").filter({ hasText: "编辑提纲" });
    await expect(converted).toHaveAttribute("data-semlo-editor-heading-numbering", "mixed");
    await expect(converted.locator(".semlo-editor-heading-number")).toHaveText("1.");
    const after = await Promise.all(remaining.map(listAppearance));
    for (let index = 0; index < remaining.length; index += 1) {
      expect(after[index].marker).toBe(before[index].marker);
      expect(after[index].left).toBeCloseTo(before[index].left, 0);
    }
    const order = await prose.evaluate((root) => {
      const labels = ["筹备写作", "编辑提纲", "梳理段落内容", "安排发布时间"];
      const blocks = Array.from(root.querySelectorAll("p, h3"));
      return labels.map((label) =>
        blocks.findIndex((block) => {
          const text = block.textContent?.trim() ?? "";
          return block.tagName === "H3" ? text.endsWith(label) : text === label;
        }),
      );
    });
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    if (method === "shortcut") {
      await host.getByRole("button", { name: "撤销", exact: true }).click();
      await checkOriginal();
    } else {
      for (const framework of ["React", "SolidJS", "原生 JS", "Vue"]) {
        await page
          .getByRole("group", { name: "框架切换" })
          .getByRole("button", { name: framework, exact: true })
          .click();
        await expect(converted.locator(".semlo-editor-heading-number")).toHaveText("1.");
      }
      await selector.selectOption("text");
      await expect(prose.locator(".semlo-editor-heading-number")).toHaveText(["1.", "a.", "2."]);
      await selector.selectOption("lists");
      await expect(converted).toHaveAttribute("data-semlo-editor-heading-numbering", "mixed");
      await page.getByRole("button", { name: "恢复示例" }).click();
      await checkOriginal();
      await selector.selectOption("all");
      await checkOriginal();
    }
    expect(errors).toEqual([]);
  });
}

test("editing example supports its suggested format painter, find and heading operations", async ({ page }) => {
  const { selector, host, errors } = await openPreview(page);
  await selector.selectOption("editing");
  const source = host.locator(".semlo-editor-prose p").filter({ hasText: /^格式来源$/ });
  const target = host.locator(".semlo-editor-prose p").filter({ hasText: /^格式目标$/ });
  await source.evaluate((element) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "格式刷", exact: true }).click();
  const points = await target.evaluate((element) => {
    const text = element.firstChild!;
    const first = document.createRange();
    const last = document.createRange();
    first.setStart(text, 0);
    first.setEnd(text, 1);
    last.setStart(text, text.textContent!.length - 1);
    last.setEnd(text, text.textContent!.length);
    const start = first.getBoundingClientRect();
    const end = last.getBoundingClientRect();
    return {
      x1: start.left + 0.2,
      y1: start.top + start.height / 2,
      x2: end.right - 0.2,
      y2: end.top + end.height / 2,
    };
  });
  await page.mouse.move(points.x1, points.y1);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y2, { steps: 12 });
  await page.mouse.up();
  await expect(target.locator("strong")).toHaveText("格式目标");

  const travel = host.locator(".semlo-editor-prose h3").filter({ hasText: "一次短途旅行" });
  const travelText = host.locator(".semlo-editor-prose p").filter({ hasText: "把想去的地方" });
  await travel.locator(".semlo-editor-heading-fold-toggle").click();
  await expect(travelText).toBeHidden();
  const outline = host.getByRole("navigation", { name: "文档大纲" });
  await outline.getByRole("button", { name: "展开大纲" }).focus();
  await page.keyboard.press("Enter");
  await outline.getByRole("button", { name: "出发之前", exact: true }).click();
  await expect(travelText).toBeVisible();

  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("青山");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/3");
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("远山");
  await panel.getByRole("button", { name: "全部替换" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("0");
  await expect(host.locator(".semlo-editor-prose p").filter({ hasText: "在远处" })).toContainText("远山");
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose p").filter({ hasText: "在远处" })).toContainText("青山");
  expect(errors).toEqual([]);
});

test("editing is retained separately for each example and reset affects only the current one", async ({ page }) => {
  const { selector, host, errors } = await openPreview(page);
  await appendMarker(page, host, "快速开始修改");
  await selector.selectOption("text");
  await appendMarker(page, host, "文字示例修改");
  await selector.selectOption("start");
  await expect(host.locator(".semlo-editor-prose")).toContainText("快速开始修改");
  await expect(host.locator(".semlo-editor-prose")).not.toContainText("文字示例修改");
  await page.getByRole("button", { name: "恢复示例" }).click();
  await expect(host.locator(".semlo-editor-prose")).not.toContainText("快速开始修改");
  await selector.selectOption("text");
  await expect(host.locator(".semlo-editor-prose")).toContainText("文字示例修改");
  await selector.selectOption("start");
  await expect(host.locator(".semlo-editor-prose")).not.toContainText("快速开始修改");
  expect(errors).toEqual([]);
});

test("framework and read-only switches retain the selected example and its edits", async ({ page }) => {
  const { selector, host, errors } = await openPreview(page);
  await selector.selectOption("lists");
  await appendMarker(page, host, "框架切换保留");
  for (const framework of ["React", "SolidJS", "原生 JS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await expect(page.getByRole("button", { name: framework, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(selector).toHaveValue("lists");
    await expect(host.locator(".semlo-editor-prose")).toContainText("框架切换保留");
    await expect(host.locator(".semlo-editor-prose table")).not.toHaveCount(0);
  }
  const readOnly = page.locator("#readonly");
  await readOnly.click();
  await expect(readOnly).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  await selector.selectOption("text");
  await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: "SolidJS", exact: true }).click();
  await expect(readOnly).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  await selector.selectOption("lists");
  await expect(host.locator(".semlo-editor-prose")).toContainText("框架切换保留");
  await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: "原生 JS", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  await expect(host.locator(".semlo-editor-prose")).toContainText("框架切换保留");
  await readOnly.click();
  await expect(host.locator(".semlo-editor-prose")).toHaveAttribute("contenteditable", "true");
  expect(errors).toEqual([]);
});

test("example navigation and editor remain usable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  const { selector, host, errors } = await openPreview(page);
  await expect(selector).toBeVisible();
  await expect(page.getByRole("button", { name: "查看全部示例" })).toBeVisible();
  await selector.selectOption("lists");
  await expect(host.locator(".semlo-editor-prose table")).not.toHaveCount(0);
  await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: "React", exact: true }).click();
  await expect(selector).toHaveValue("lists");
  await expect(host.locator(".semlo-editor-prose table")).not.toHaveCount(0);
  await selector.selectOption("start");
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
  expect(errors).toEqual([]);
});
