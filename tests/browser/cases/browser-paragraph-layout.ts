async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    window.layoutFunctions = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "layout-test";
    document.body.prepend(host);
    window.layoutApi = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", marks: [{ type: "bold" }], text: "正文" }],
          },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表内容" }] }] },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "末尾" }] },
        ],
      },
    });
  });
  const host = page.locator("#layout-test");
  const result = await page.evaluate(() => {
    const api = window.__semloRequireFixture("layoutApi"),
      editor = api.editor,
      commands = window.__semloRequireFixture("layoutFunctions");
    const selected = () => {
      const out: Array<{ node: import("@tiptap/pm/model").Node; pos: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (["paragraph", "heading"].includes(node.type.name)) out.push({ node, pos });
      });
      return out;
    };
    const listItems = () => {
      const out: Array<{ node: import("@tiptap/pm/model").Node; pos: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (["listItem", "taskItem"].includes(node.type.name)) out.push({ node, pos });
      });
      return out;
    };
    const before = selected();
    editor.commands.setTextSelection({ from: before[0].pos + 1, to: before[2].pos + before[2].node.nodeSize - 1 });
    if (!commands.adjustParagraphIndent(editor, 1) || !commands.setParagraphLineHeight(editor, "2"))
      throw new Error("Multi-block layout did not apply");
    let blocks = selected();
    if (
      !blocks
        .slice(0, 2)
        .every(({ node }) => node.attrs.semloEditorIndent === 1 && node.attrs.semloEditorLineHeight === "2") ||
      blocks[2].node.attrs.semloEditorIndent !== 0 ||
      blocks[2].node.attrs.semloEditorLineHeight !== "2" ||
      listItems()[0].node.attrs.semloEditorListIndent !== 1 ||
      blocks[3].node.attrs.semloEditorIndent !== 0 ||
      blocks[3].node.attrs.semloEditorLineHeight !== null
    )
      throw new Error("Multi-block selection changed the wrong paragraphs or list items");
    if (commands.getParagraphLineHeight(editor) !== "2") throw new Error("Selected line height was not reported");
    if (!editor.commands.undo()) throw new Error("Line-height undo did not run");
    blocks = selected();
    if (
      !blocks
        .slice(0, 2)
        .every(({ node }) => node.attrs.semloEditorIndent === 1 && node.attrs.semloEditorLineHeight === null) ||
      blocks[2].node.attrs.semloEditorIndent !== 0 ||
      blocks[2].node.attrs.semloEditorLineHeight !== null ||
      listItems()[0].node.attrs.semloEditorListIndent !== 1
    )
      throw new Error("Undo did not isolate the line-height action");
    if (
      !editor.commands.redo() ||
      !selected()
        .slice(0, 3)
        .every(({ node }) => node.attrs.semloEditorLineHeight === "2")
    )
      throw new Error("Line-height redo failed");
    const snapshot = api.getSnapshot();
    if (
      !snapshot.html.includes('data-semlo-editor-indent="1"') ||
      !snapshot.html.includes('data-semlo-editor-list-indent="1"') ||
      !snapshot.html.includes('data-semlo-editor-line-height="2"') ||
      !snapshot.html.includes("text-align: center") ||
      !snapshot.html.includes("<strong>")
    )
      throw new Error("Layout lost HTML or existing formatting");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.html);
    blocks = selected();
    if (
      !blocks
        .slice(0, 2)
        .every(({ node }) => node.attrs.semloEditorIndent === 1 && node.attrs.semloEditorLineHeight === "2") ||
      blocks[2].node.attrs.semloEditorIndent !== 0 ||
      blocks[2].node.attrs.semloEditorLineHeight !== "2" ||
      listItems()[0].node.attrs.semloEditorListIndent !== 1 ||
      blocks[1].node.attrs.textAlign !== "center"
    )
      throw new Error("HTML layout roundtrip failed");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.json);
    if (
      !selected()
        .slice(0, 2)
        .every(({ node }) => node.attrs.semloEditorIndent === 1 && node.attrs.semloEditorLineHeight === "2") ||
      selected()[2].node.attrs.semloEditorIndent !== 0 ||
      listItems()[0].node.attrs.semloEditorListIndent !== 1
    )
      throw new Error("JSON layout roundtrip failed");
    const all = selected();
    editor.commands.setTextSelection({ from: all[0].pos + 1, to: all[3].pos + 1 });
    if (commands.getParagraphLineHeight(editor) !== undefined) throw new Error("Mixed line heights were not reported");
    api.setEditable(false);
    const readonly = JSON.stringify(api.getSnapshot().json);
    if (
      commands.adjustParagraphIndent(editor, 1) ||
      commands.setParagraphLineHeight(editor, "3") ||
      JSON.stringify(api.getSnapshot().json) !== readonly
    )
      throw new Error("Read-only layout was changed");
    api.setEditable(true);
    api.setContent(
      '<p data-semlo-editor-indent="999" data-semlo-editor-line-height="calc(1 + 2)" style="margin-left:999em;line-height:999">bad</p>',
    );
    const unsafe = selected()[0].node.attrs;
    if (
      unsafe.semloEditorIndent !== 0 ||
      unsafe.semloEditorLineHeight !== null ||
      api.getSnapshot().html.includes("999")
    )
      throw new Error("Unsafe layout values were accepted");
    api.setContent({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: ["第一项", "第二项", "第三项"].map((text) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    });
    let items = listItems();
    let paragraphs = selected();
    editor.commands.setTextSelection(paragraphs[0].pos + 1);
    if (!commands.adjustParagraphIndent(editor, 1)) throw new Error("The first list item could not be indented");
    items = listItems();
    if (
      items.map(({ node }) => node.attrs.semloEditorListIndent).join(",") !== "1,0,0" ||
      items.map(({ node }) => node.textContent).join(",") !== "第一项,第二项,第三项"
    )
      throw new Error("Single-item indentation changed order or other items");
    const renderedItems = [...document.querySelectorAll("#layout-test .semlo-editor-prose ul > li")];
    if (
      getComputedStyle(renderedItems[0]).listStyleType !== "circle" ||
      getComputedStyle(renderedItems[1]).listStyleType === "circle"
    )
      throw new Error("Indented bullet marker did not change");
    if (
      !editor.commands.undo() ||
      listItems()[0].node.attrs.semloEditorListIndent !== 0 ||
      !editor.commands.redo() ||
      listItems()[0].node.attrs.semloEditorListIndent !== 1
    )
      throw new Error("List indentation undo/redo failed");
    paragraphs = selected();
    editor.commands.setTextSelection({
      from: paragraphs[1].pos + 1,
      to: paragraphs[2].pos + paragraphs[2].node.nodeSize - 1,
    });
    commands.adjustParagraphIndent(editor, 1);
    if (
      listItems()
        .map(({ node }) => node.attrs.semloEditorListIndent)
        .join(",") !== "1,1,1"
    )
      throw new Error("Multi-item indentation failed");
    commands.adjustParagraphIndent(editor, -1);
    if (
      listItems()
        .map(({ node }) => node.attrs.semloEditorListIndent)
        .join(",") !== "1,0,0"
    )
      throw new Error("Multi-item outdent failed");
    api.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "序号" }] }] }],
        },
      ],
    });
    paragraphs = selected();
    editor.commands.setTextSelection(paragraphs[0].pos + 1);
    commands.adjustParagraphIndent(editor, 1);
    if (
      getComputedStyle(document.querySelector("#layout-test .semlo-editor-prose ol > li")!).listStyleType !==
      "lower-alpha"
    )
      throw new Error("Indented ordered marker did not change");
    api.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: ["甲", "乙", "丙", "丁"].map((text) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    });
    for (const index of [1, 2]) {
      paragraphs = selected();
      editor.commands.setTextSelection(paragraphs[index].pos + 1);
      commands.adjustParagraphIndent(editor, 1);
    }
    const ordinals = () =>
      [...document.querySelectorAll("#layout-test .semlo-editor-prose > ol > li")]
        .map((el) => el.getAttribute("value"))
        .join(",");
    if (ordinals() !== "1,1,2,2")
      throw new Error("Ordered levels did not reset and continue independently: " + ordinals());
    const serialized = api.getSnapshot();
    const serializedList = new DOMParser().parseFromString(serialized.html, "text/html").querySelector("ol");
    const serializedOrdinals = [...serializedList!.children].map((item) => item.getAttribute("value")).join(",");
    if (serializedOrdinals !== "1,1,2,2" || JSON.stringify(serialized.json).includes("semloEditorListOrdinal"))
      throw new Error("Derived list numbers were not preserved in HTML or leaked into JSON");
    items = listItems();
    const newItem = editor.schema.nodes.listItem.create(
      { semloEditorListIndent: 1 },
      editor.schema.nodes.paragraph.create(null, editor.schema.text("新增")),
    );
    editor.view.dispatch(editor.state.tr.insert(items[2].pos, newItem));
    if (ordinals() !== "1,1,2,3,2") throw new Error("Ordered levels did not update after insertion: " + ordinals());
    items = listItems();
    editor.view.dispatch(editor.state.tr.delete(items[1].pos, items[1].pos + items[1].node.nodeSize));
    if (ordinals() !== "1,1,2,2") throw new Error("Ordered levels did not update after deletion: " + ordinals());
    items = listItems();
    const moved = items[1].node;
    let transaction = editor.state.tr.delete(items[1].pos, items[1].pos + items[1].node.nodeSize);
    transaction = transaction.insert(
      transaction.mapping.map(items[items.length - 1].pos + items[items.length - 1].node.nodeSize),
      moved,
    );
    editor.view.dispatch(transaction);
    if (
      ordinals() !== "1,1,2,1" ||
      listItems()
        .map(({ node }) => node.textContent)
        .join(",") !== "甲,丙,丁,新增"
    )
      throw new Error("Ordered levels did not update after a move: " + ordinals());
    api.setContent({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "待办" }] }],
            },
          ],
        },
      ],
    });
    paragraphs = selected();
    editor.commands.setTextSelection(paragraphs[0].pos + 1);
    commands.adjustParagraphIndent(editor, 1);
    if (
      listItems()[0].node.attrs.semloEditorListIndent !== 1 ||
      !api.getSnapshot().html.includes('data-semlo-editor-list-indent="1"')
    )
      throw new Error("Task item indentation failed");
    api.setContent("<p>键盘测试</p>");
    return {
      multiBlock: true,
      list: true,
      firstListItem: true,
      multiListItems: true,
      listMarkers: true,
      orderedRenumber: true,
      taskList: true,
      undoRedo: true,
      html: true,
      json: true,
      mixed: true,
      readOnly: true,
      invalidValues: true,
    };
  });
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.press("ControlOrMeta+Alt+]");
  if (
    (await page.evaluate(() =>
      window
        .__semloRequireFixture("layoutFunctions")
        .getParagraphLineHeight(window.__semloRequireFixture("layoutApi").editor),
    )) !== "2"
  )
    throw new Error("Line-height shortcut did not increase the default");
  await host.getByRole("button", { name: "缩进调整" }).click();
  await page.getByRole("menuitem", { name: "增加缩进" }).click();
  if ((await host.locator(".semlo-editor-prose p").getAttribute("data-semlo-editor-indent")) !== "1")
    throw new Error("Indent toolbar action failed");
  await host.getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "1.15", exact: true }).click();
  if ((await host.locator(".semlo-editor-prose p").getAttribute("data-semlo-editor-line-height")) !== "1.15")
    throw new Error("Line-height toolbar action failed");
  await page.evaluate(() => {
    window.__semloRequireFixture("layoutApi").destroy();
    document.querySelector("#layout-test")!.remove();
  });
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.getByRole("button", { name: "缩进调整" }).click();
  await page.getByRole("menuitem", { name: "增加缩进" }).click();
  await page.getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "2.5", exact: true }).click();
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    const paragraph = page.locator(".semlo-editor-prose > p").last();
    if (
      (await paragraph.getAttribute("data-semlo-editor-indent")) !== "1" ||
      (await paragraph.getAttribute("data-semlo-editor-line-height")) !== "2.5"
    )
      throw new Error(`${framework}: paragraph layout lost`);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return { ...result, shortcut: true, toolbar: true, frameworks: ["React", "SolidJS", "Vue"] };
}
