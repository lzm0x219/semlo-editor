async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (page.url() !== "about:blank") await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    window.blockBaselineHandles = document.querySelectorAll(".semlo-editor-block-handle").length;
    window.blockClipboard = { mode: "ok", writes: [], resolve: null };
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: class {
        data: Record<string, Blob>;
        constructor(data: Record<string, Blob>) {
          this.data = data;
        }
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: Array<{ data: Record<string, Blob> }>) => {
          if (["deny", "plain-only"].includes(window.__semloRequireFixture("blockClipboard").mode))
            throw new Error("denied");
          if (window.__semloRequireFixture("blockClipboard").mode === "pending")
            await new Promise<void>((resolve) => (window.__semloRequireFixture("blockClipboard").resolve = resolve));
          window.__semloRequireFixture("blockClipboard").writes.push({
            html: await items[0].data["text/html"].text(),
            text: await items[0].data["text/plain"].text(),
          });
        },
        writeText: async (text: string) => {
          if (window.__semloRequireFixture("blockClipboard").mode === "deny") throw new Error("denied");
          window.__semloRequireFixture("blockClipboard").writes.push({ text });
        },
      },
    });
    const host = document.createElement("div");
    host.id = "block-actions-test";
    document.body.prepend(host);
    window.blockChanges = 0;
    window.blockCreateEditor = createEditor;
    window.blockApi = createEditor({
      element: host,
      onChange: () => window.__semloIncrementFixture("blockChanges"),
      content: "<p><strong>甲</strong>内容</p><p>乙内容</p><p>丙内容</p>",
    });
  });
  const host = page.locator("#block-actions-test"),
    prose = host.locator(".semlo-editor-prose"),
    handle = page.locator(".semlo-editor-block-handle:visible"),
    menu = page.getByRole("menu", { name: "块操作" });
  const open = async (locator: import("playwright").Locator) => {
    await locator.hover();
    await handle.waitFor({ state: "visible" });
    await handle.click();
    await menu.waitFor({ state: "visible" });
  };
  const dragPoint = async (x: number, y: number) => {
    const source = await handle.boundingBox();
    await page.mouse.move(source!.x + 12, source!.y + 12);
    await page.mouse.down();
    await page.mouse.move(source!.x + 20, source!.y + 12, { steps: 4 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  };
  const dragTo = async (locator: import("playwright").Locator) => {
    const destination = await locator.boundingBox();
    await dragPoint(destination!.x + 5, destination!.y + destination!.height - 2);
  };
  const items = () => menu.locator(':scope > button[role="menuitem"]');
  const set = async (content: import("../../../packages/core/src/types").EditorContent) =>
    page.evaluate((value) => window.__semloRequireFixture("blockApi").setContent(value), content);
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("blockApi").getSnapshot());
  const names = async () => prose.locator(":scope > p, :scope > h1, :scope > h2").allTextContents();

  const original = await snapshot();
  await open(prose.locator("p").first());
  if ((await items().allTextContents()).join("|") !== "转化为›|删除|复制|剪切|缩进›|在下方添加›")
    throw new Error("Block menu order or entries differ");
  if (!(await prose.locator("p.semlo-editor-block-actions-selected").count()))
    throw new Error("Opening the menu did not highlight the block");
  await page.keyboard.press("Escape");
  if ((await menu.count()) || (await prose.locator(".semlo-editor-block-actions-selected").count()))
    throw new Error("Escape did not clear menu/highlight");
  if (JSON.stringify((await snapshot()).json) !== JSON.stringify(original.json))
    throw new Error("Opening the menu changed document content");

  await open(prose.locator("p").first());
  await menu.getByRole("menuitem", { name: "转化为" }).click();
  const convert = page.getByRole("menu", { name: "转化为" });
  if (!(await convert.getByRole("menuitem", { name: "代码块" }).isDisabled()))
    throw new Error("Conversion that would lose bold marks was not disabled");
  await convert.getByRole("menuitem", { name: "标题 2", exact: true }).click();
  let state = await snapshot();
  if (
    state.json.content![0].type !== "heading" ||
    state.json.content![0].attrs!.level !== 2 ||
    !state.json.content![0].content![0].marks?.some((mark) => mark.type === "bold")
  )
    throw new Error("Heading conversion lost content or bold");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    JSON.stringify((await snapshot()).json) !== JSON.stringify(original.json)
  )
    throw new Error("Heading conversion was not undoable");

  await open(prose.locator("p").nth(1));
  await menu.getByRole("menuitem", { name: "转化为" }).click();
  await convert.getByRole("menuitem", { name: "代码块" }).click();
  state = await snapshot();
  if (state.json.content![1].type !== "codeBlock" || state.json.content![1].content?.[0]?.text !== "乙内容")
    throw new Error("Plain text did not convert to code");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("Code conversion was not undoable");

  for (const [label, type] of [
    ["无序列表", "bulletList"],
    ["有序列表", "orderedList"],
    ["待办事项", "taskList"],
    ["引用", "blockquote"],
    ["高亮块", "callout"],
    ["分栏", "semloEditorColumns"],
    ["折叠块", "details"],
  ]) {
    await set("<p><strong>保留</strong>内容</p>");
    const before = await snapshot();
    await open(prose.locator("p").first());
    await menu.getByRole("menuitem", { name: "转化为" }).click();
    const choice = convert.getByRole("menuitem", { name: label, exact: true });
    if (await choice.isDisabled()) throw new Error(`${label}: safe conversion was disabled`);
    await choice.click();
    const result = await snapshot(),
      encoded = JSON.stringify(result.json);
    if (result.json.content![0].type !== type || !encoded.includes("保留") || !encoded.includes('"type":"bold"'))
      throw new Error(`${label}: conversion lost content or marks`);
    if (
      !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
      JSON.stringify((await snapshot()).json) !== JSON.stringify(before.json)
    )
      throw new Error(`${label}: conversion was not undoable`);
  }
  await set({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "center", semloEditorIndent: 1, semloEditorLineHeight: "2" },
        content: [{ type: "text", text: "样式段落" }],
      },
    ],
  });
  await open(prose.locator("p"));
  await menu.getByRole("menuitem", { name: "转化为" }).click();
  if (!(await convert.getByRole("menuitem", { name: "代码块" }).isDisabled()))
    throw new Error("Conversion that loses paragraph attributes was not disabled");
  await convert.getByRole("menuitem", { name: "标题 2" }).click();
  state = await snapshot();
  if (
    state.json.content![0].attrs!.textAlign !== "center" ||
    state.json.content![0].attrs!.semloEditorIndent !== 1 ||
    state.json.content![0].attrs!.semloEditorLineHeight !== "2"
  )
    throw new Error("Heading conversion lost paragraph attributes");
  await set(original.json);

  await open(prose.locator("p").first());
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("blockClipboard").writes.length === 1);
  const copied = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes[0]);
  if (
    !copied.html!.includes("<strong>甲</strong>") ||
    !copied.text.includes("甲内容") ||
    JSON.stringify((await snapshot()).json) !== JSON.stringify(original.json)
  )
    throw new Error("Copy lost HTML/text or changed the document");
  await open(prose.locator("p").nth(1));
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(() => window.__semloRequireFixture("blockClipboard").writes.length === 2);
  if ((await names()).join(",") !== "甲内容,丙内容") throw new Error("Cut did not remove only the selected block");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    (await names()).join(",") !== "甲内容,乙内容,丙内容"
  )
    throw new Error("Cut was not undoable");
  await page.evaluate(() => {
    window.__semloRequireFixture("blockClipboard").mode = "deny";
  });
  await open(prose.locator("p").first());
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await menu.getByText("复制失败，请检查剪贴板权限").waitFor();
  if ((await names()).join(",") !== "甲内容,乙内容,丙内容")
    throw new Error("Failed clipboard access deleted the block");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__semloRequireFixture("blockClipboard").mode = "plain-only";
  });
  const plainWrites = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.length);
  await open(prose.locator("p").first());
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count,
    plainWrites,
  );
  if ((await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.at(-1)!.text)) !== "甲内容")
    throw new Error("Plain-text clipboard fallback failed");
  await menu.getByText("已复制纯文本，未包含格式").waitFor();
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await menu.getByText("浏览器仅允许复制纯文本，未剪切以保留格式").waitFor();
  if ((await names()).join(",") !== "甲内容,乙内容,丙内容")
    throw new Error("Plain-text-only cut removed formatted content");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__semloRequireFixture("blockClipboard").mode = "pending";
    window.__semloRequireFixture("blockClipboard").resolve = null;
  });
  await open(prose.locator("p").first());
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(() => typeof window.__semloRequireFixture("blockClipboard").resolve === "function");
  await page.keyboard.press("Escape");
  await open(prose.locator("p").nth(1));
  const beforeReopen = JSON.stringify((await snapshot()).json);
  await page.evaluate(() => window.__semloRequireFixture("blockClipboard").resolve!());
  await page.waitForTimeout(30);
  if (JSON.stringify((await snapshot()).json) !== beforeReopen || !(await menu.count()))
    throw new Error("A late cut affected a newly opened block menu");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__semloRequireFixture("blockClipboard").resolve = null;
  });
  await open(prose.locator("p").first());
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(() => typeof window.__semloRequireFixture("blockClipboard").resolve === "function");
  await set("<p>替换文档</p>");
  await page.evaluate(() => window.__semloRequireFixture("blockClipboard").resolve!());
  await page.waitForTimeout(30);
  if ((await names()).join(",") !== "替换文档") throw new Error("A delayed cut changed the replacement document");

  await set("<p>甲</p><p>乙</p><p>丙</p>");
  await prose.locator("p").first().hover();
  await handle.waitFor({ state: "visible" });
  const last = prose.locator("p").last();
  await dragTo(last);
  if ((await names()).join(",") !== "乙,丙,甲")
    throw new Error("Dragging a block did not move it after the target: " + (await names()).join(","));
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    (await names()).join(",") !== "甲,乙,丙"
  )
    throw new Error("Block dragging was not undoable");
  await prose.locator("p").first().hover();
  await handle.waitFor({ state: "visible" });
  const lastBounds = await prose.locator("p").last().boundingBox();
  await dragPoint(lastBounds!.x + 5, lastBounds!.y + lastBounds!.height + 12);
  if ((await names()).join(",") !== "乙,丙,甲")
    throw new Error("Dropping in whitespace below the last block did not append it");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("Whitespace drop was not undoable");

  await set("<p>缩进段</p>");
  await open(prose.locator("p"));
  await menu.getByRole("menuitem", { name: "缩进" }).click();
  await page.getByRole("menu", { name: "缩进" }).getByRole("menuitem", { name: "增加缩进" }).click();
  state = await snapshot();
  if (
    state.json.content![0].attrs!.semloEditorIndent !== 1 ||
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo()))
  )
    throw new Error("Paragraph indentation or undo failed");
  await set("<p><strong>唯一</strong></p>");
  const only = await snapshot();
  await open(prose.locator("p"));
  await menu.getByRole("menuitem", { name: "删除" }).click();
  const afterDeletingOnlyBlock = await snapshot();
  if (
    afterDeletingOnlyBlock.json.content!.length !== 1 ||
    afterDeletingOnlyBlock.json.content![0].type !== "paragraph" ||
    afterDeletingOnlyBlock.json.content![0].content?.length
  )
    throw new Error("Deleting the only block left an invalid document");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    JSON.stringify((await snapshot()).json) !== JSON.stringify(only.json)
  )
    throw new Error("Deleting the only block was not undoable");

  await set("<ul><li><p>列表甲</p></li><li><p>列表乙</p></li><li><p>列表丙</p></li></ul><p>尾部</p>");
  await page.evaluate(() => {
    window.__semloRequireFixture("blockClipboard").mode = "ok";
  });
  const list = prose.locator("ul").first(),
    li = list.locator(":scope > li");
  await li.first().hover();
  await handle.waitFor({ state: "visible" });
  const lastItem = li.last();
  await dragTo(lastItem);
  if ((await li.allTextContents()).join(",") !== "列表乙,列表丙,列表甲")
    throw new Error("List item drag did not reorder within its list");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    (await li.allTextContents()).join(",") !== "列表甲,列表乙,列表丙"
  )
    throw new Error("List item drag was not undoable");
  await open(li.nth(1));
  if (!(await li.nth(1).evaluate((el) => el.classList.contains("semlo-editor-block-actions-selected"))))
    throw new Error("List item was not highlighted");
  await menu.getByRole("menuitem", { name: "删除" }).click();
  if ((await li.allTextContents()).join(",") !== "列表甲,列表丙")
    throw new Error("List item deletion changed the wrong item");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("List item deletion was not undoable");
  await open(li.nth(1));
  await menu.getByRole("menuitem", { name: "缩进" }).click();
  await page.getByRole("menu", { name: "缩进" }).getByRole("menuitem", { name: "增加缩进" }).click();
  state = await snapshot();
  if (
    state.json.content![0].content![1].attrs!.semloEditorListIndent !== 1 ||
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo()))
  )
    throw new Error("List item indentation or undo failed");

  const writesBefore = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.length);
  await open(li.nth(1));
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count,
    writesBefore,
  );
  const itemCopy = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.at(-1));
  if (!itemCopy!.html!.includes("<ul") || !itemCopy!.html!.includes("列表乙") || itemCopy!.html!.includes("列表甲"))
    throw new Error("List item copy did not preserve a standalone list");
  await open(li.nth(1));
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count + 1,
    writesBefore,
  );
  if ((await li.allTextContents()).join(",") !== "列表甲,列表丙")
    throw new Error("List item cut removed the wrong content");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("List item cut was not undoable");

  const beforeListInsert = JSON.stringify((await snapshot()).json),
    changesBeforeList = await page.evaluate(() => window.__semloRequireFixture("blockChanges"));
  await open(li.first());
  await menu.getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).waitFor();
  await page.keyboard.press("Escape");
  if (
    (await li.count()) !== 3 ||
    JSON.stringify((await snapshot()).json) !== beforeListInsert ||
    (await page.evaluate(() => window.__semloRequireFixture("blockChanges"))) !== changesBeforeList
  )
    throw new Error("Cancelling insert below changed the list");

  await set(
    "<ul><li><p>外层</p><ul><li><p>内甲</p></li><li><p>内乙</p></li></ul></li><li><p>外同级</p></li></ul><p>中间</p><ul><li><p>另一列表</p></li><li><p>另一项</p></li></ul>",
  );
  const inner = prose.locator("ul ul > li");
  await open(inner.first());
  await menu.getByRole("menuitem", { name: "删除" }).click();
  if ((await inner.allTextContents()).join(",") !== "内乙" || !(await prose.getByText("外同级").count()))
    throw new Error("Nested list deletion affected an ancestor or sibling");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("Nested list deletion was not undoable");
  const beforeCross = JSON.stringify((await snapshot()).json);
  await inner.first().hover();
  await handle.waitFor({ state: "visible" });
  await dragTo(prose.getByText("另一列表"));
  if (
    (await inner.allTextContents()).join(",") !== "内乙" ||
    (await prose.locator(":scope > ul").last().locator(":scope > li").allTextContents()).join(",") !==
      "另一列表,内甲,另一项"
  )
    throw new Error("Dragging a nested list item into another list failed");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    JSON.stringify((await snapshot()).json) !== beforeCross
  )
    throw new Error("Cross-list dragging was not undoable");

  await set("<p>段落</p><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table><p>尾部</p>");
  await open(prose.locator("td").first());
  if (!(await prose.locator(".semlo-editor-block-actions-selected").count()))
    throw new Error("Table block was not highlighted");
  await menu.getByRole("menuitem", { name: "转化为" }).click();
  if (!(await convert.getByRole("menuitem", { name: "标题 2", exact: true }).isDisabled()))
    throw new Error("Table conversion should be disabled");
  await page.keyboard.press("Escape");
  await menu.getByRole("menuitem", { name: "删除" }).click();
  if (await prose.locator("table").count()) throw new Error("Table delete did not remove the whole block");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())) ||
    !(await prose.locator("table").count())
  )
    throw new Error("Table delete was not undoable");
  const beforeTableInsert = JSON.stringify((await snapshot()).json),
    changesBeforeTable = await page.evaluate(() => window.__semloRequireFixture("blockChanges"));
  await open(prose.locator("td").first());
  await menu.getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).waitFor();
  await prose
    .locator("p")
    .first()
    .click({ position: { x: 3, y: 8 } });
  if (
    (await page.getByRole("dialog", { name: "插入内容" }).count()) ||
    JSON.stringify((await snapshot()).json) !== beforeTableInsert ||
    (await page.evaluate(() => window.__semloRequireFixture("blockChanges"))) !== changesBeforeTable
  )
    throw new Error("Dismissing insert below changed the table document");

  const tableWrites = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.length);
  await open(prose.locator("td").first());
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count,
    tableWrites,
  );
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.at(-1)!.html!)).includes("<table")
  )
    throw new Error("Table copy did not retain table HTML");
  await open(prose.locator("td").first());
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count + 1,
    tableWrites,
  );
  if (
    (await prose.locator("table").count()) ||
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo()))
  )
    throw new Error("Table cut or undo failed");
  await prose.locator("td").first().hover();
  await handle.waitFor({ state: "visible" });
  await dragTo(prose.locator("p").last());
  state = await snapshot();
  if (state.json.content!.map((node) => node.type).join(",") !== "paragraph,paragraph,table")
    throw new Error("Table drag did not move the whole table");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("Table drag was not undoable");

  await set({
    type: "doc",
    content: [
      {
        type: "callout",
        content: [{ type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "卡片文字" }] }],
      },
      { type: "paragraph", content: [{ type: "text", text: "末尾" }] },
    ],
  });
  const card = prose.locator("aside[data-semlo-editor-callout]"),
    cardWrites = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.length);
  await open(card);
  if (!(await card.evaluate((el) => el.classList.contains("semlo-editor-block-actions-selected"))))
    throw new Error("Card was not highlighted");
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count,
    cardWrites,
  );
  const cardCopy = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.at(-1));
  if (!cardCopy!.html!.includes("data-semlo-editor-callout") || !cardCopy!.html!.includes("<strong>卡片文字</strong>"))
    throw new Error("Card copy lost its structure or marks");
  await open(card);
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count + 1,
    cardWrites,
  );
  if (
    (await card.count()) ||
    !(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo()))
  )
    throw new Error("Card cut or undo failed");
  await card.hover();
  await handle.waitFor({ state: "visible" });
  await dragTo(prose.locator("p").last());
  state = await snapshot();
  if (state.json.content!.map((node) => node.type).join(",") !== "paragraph,callout")
    throw new Error("Card drag did not move the whole card");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("Card drag was not undoable");

  await set({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { language: "javascript", title: "代码示例", theme: "dark", collapsed: false },
        content: [{ type: "text", text: "const value = 1" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "代码后" }] },
    ],
  });
  const code = prose.locator(".semlo-editor-code-card"),
    codeWrites = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.length);
  await open(code.locator(".semlo-editor-code-header"));
  await menu.getByRole("menuitem", { name: "复制" }).click();
  await page.waitForFunction(
    (count) => window.__semloRequireFixture("blockClipboard").writes.length > count,
    codeWrites,
  );
  const codeCopy = await page.evaluate(() => window.__semloRequireFixture("blockClipboard").writes.at(-1));
  if (
    !codeCopy!.html!.includes("<pre") ||
    !codeCopy!.html!.includes("代码示例") ||
    !codeCopy!.text.includes("const value = 1")
  )
    throw new Error("Code card copy lost code or metadata");
  await code.hover();
  await handle.waitFor({ state: "visible" });
  await dragTo(prose.getByText("代码后"));
  state = await snapshot();
  if (
    state.json.content!.map((node) => node.type).join(",") !== "paragraph,codeBlock" ||
    state.json.content![1].attrs!.title !== "代码示例"
  )
    throw new Error("Code card drag lost structure or attributes");
  if (!(await page.evaluate(() => window.__semloRequireFixture("blockApi").editor.commands.undo())))
    throw new Error("Code card drag was not undoable");

  await set({
    type: "doc",
    content: [
      {
        type: "callout",
        content: [{ type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "卡片文字" }] }],
      },
      { type: "paragraph", content: [{ type: "text", text: "末尾" }] },
    ],
  });

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "second-block-actions-test";
    document.body.append(host);
    window.secondBlockApi = window.__semloRequireFixture("blockCreateEditor")({
      element: host,
      content: "<p>另一个编辑器</p>",
    });
  });
  await page.locator("#second-block-actions-test .semlo-editor-prose p").hover();
  await page.waitForTimeout(250);
  if ((await page.locator(".semlo-editor-block-handle:visible").count()) !== 1)
    throw new Error("Multiple editors displayed stale handles together");
  await handle.click();
  if (await menu.getByRole("menuitem", { name: "在下方添加" }).isDisabled())
    throw new Error("The integrated insertion panel was not available");
  await menu.getByRole("menuitem", { name: "删除" }).click();
  if ((await snapshot()).json.content![0].type !== "callout")
    throw new Error("An action in the second editor changed the first editor");
  await page.evaluate(() => {
    window.__semloRequireFixture("secondBlockApi").setContent("<p>等待剪切</p>");
    window.__semloRequireFixture("blockClipboard").mode = "pending";
    window.__semloRequireFixture("blockClipboard").resolve = null;
  });
  await page.locator("#second-block-actions-test .semlo-editor-prose p").hover();
  await page.waitForTimeout(250);
  await handle.click();
  await menu.getByRole("menuitem", { name: "剪切" }).click();
  await page.waitForFunction(() => typeof window.__semloRequireFixture("blockClipboard").resolve === "function");
  await page.evaluate(() => {
    window.__semloRequireFixture("secondBlockApi").destroy();
    window.__semloRequireFixture("blockClipboard").resolve!();
  });
  await page.waitForTimeout(30);
  if (
    (await snapshot()).json.content![0].type !== "callout" ||
    (await page.locator(".semlo-editor-block-menu").count())
  )
    throw new Error("A late cut affected another editor after destroy");

  await page.evaluate(() => window.__semloRequireFixture("blockApi").setEditable(false));
  await prose.locator("p").first().hover();
  await page.waitForTimeout(30);
  if (await page.locator(".semlo-editor-block-handle:visible").count())
    throw new Error("Read-only editor exposed editing controls");
  await page.evaluate(() => window.__semloRequireFixture("blockApi").setEditable(true));
  await open(prose.locator("p").first());
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__semloRequireFixture("blockApi").destroy());
  if (
    (await page.locator(".semlo-editor-block-handle").count()) !==
      (await page.evaluate(() => window.__semloRequireFixture("blockBaselineHandles"))) ||
    (await page.locator(".semlo-editor-block-menu").count())
  )
    throw new Error("Destroy left block controls in the document");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    menu: true,
    selectionHighlight: true,
    transform: true,
    unsupportedSafe: true,
    clipboard: true,
    failedCut: true,
    lateCut: true,
    blockDrag: true,
    listDrag: true,
    listDeleteAndClipboard: true,
    deferredInsertCancel: true,
    tableAndCard: true,
    multipleEditors: true,
    undo: true,
    readonly: true,
    destroy: true,
  };
}
