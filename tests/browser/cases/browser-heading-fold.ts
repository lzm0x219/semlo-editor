async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (page.url() !== "about:blank" && !page.url().startsWith("file:")) await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "heading-fold-test";
    document.body.prepend(host);
    window.foldChanges = 0;
    const h = (level: number, text: string) => ({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text }],
    });
    const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    window.foldApi = createEditor({
      element: host,
      onChange: () => window.__semloIncrementFixture("foldChanges"),
      content: {
        type: "doc",
        content: [
          h(1, "父标题"),
          p("父正文"),
          {
            type: "table",
            content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("表格正文")] }] }],
          },
          h(2, "子标题"),
          p("子正文"),
          h(3, "孙标题"),
          p("孙正文"),
          h(2, "同级标题"),
          p("同级正文"),
          h(1, "后续标题"),
          p("后续正文"),
        ],
      },
    });
    window.foldPos = (text) => {
      let found = -1;
      window.__semloRequireFixture("foldApi").editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.textContent === text) found = pos;
      });
      return found;
    };
  });
  const host = page.locator("#heading-fold-test"),
    prose = host.locator(".semlo-editor-prose");
  const heading = (name: string) => prose.locator("h1,h2,h3,h4,h5,h6").filter({ hasText: name });
  const paragraph = (name: string) => prose.locator("p").filter({ hasText: name });
  const toggle = (name: string) => heading(name).locator("button.semlo-editor-heading-fold-toggle");
  const visible = async (locator: import("playwright").Locator, expected: boolean, label: string) => {
    if ((await locator.isVisible()) !== expected) throw new Error(`${label}: unexpected visibility`);
  };
  const original = await page.evaluate(() =>
    JSON.stringify(window.__semloRequireFixture("foldApi").getSnapshot().json),
  );
  const originalHTML = await page.evaluate(() => window.__semloRequireFixture("foldApi").getSnapshot().html);
  if ((await host.locator("button.semlo-editor-heading-fold-toggle").count()) !== 5)
    throw new Error("Headings with content did not expose fold controls");

  await paragraph("孙正文").click();
  await toggle("孙标题").click();
  await visible(paragraph("孙正文"), false, "grandchild fold");
  const relocated = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldApi").editor,
      pos = window.__semloRequireFixture("foldPos")("孙标题"),
      node = editor.state.doc.nodeAt(pos);
    return editor.state.selection.from === pos + node!.nodeSize - 1;
  });
  if (!relocated) throw new Error("Folding left the selection in hidden content");
  await toggle("子标题").click();
  await visible(paragraph("子正文"), false, "child fold");
  await visible(heading("孙标题"), false, "nested heading hidden");
  await visible(heading("同级标题"), true, "same-level boundary");
  await toggle("父标题").click();
  await visible(paragraph("父正文"), false, "parent fold");
  await visible(prose.locator("table"), false, "parent fold hides table node view");
  await visible(heading("子标题"), false, "child hidden by parent");
  await visible(heading("后续标题"), true, "higher-level boundary");

  await toggle("父标题").click();
  await visible(paragraph("父正文"), true, "parent expansion");
  await visible(prose.locator("table"), true, "parent expansion restores table");
  await visible(heading("子标题"), true, "child restored");
  await visible(paragraph("子正文"), false, "nested state retained");
  await toggle("父标题").click();
  const outline = host.getByRole("navigation", { name: "文档大纲" });
  const openOutline = async () => {
    if (await outline.getByRole("button", { name: "隐藏大纲", exact: true }).isVisible()) return;
    await outline.getByRole("button", { name: "展开大纲", exact: true }).focus();
    await page.keyboard.press("Enter");
  };
  await openOutline();
  await outline.getByRole("button", { name: "孙标题", exact: true }).click();
  await visible(heading("孙标题"), true, "outline reveals heading");
  await visible(paragraph("子正文"), true, "outline expands parent sections");
  await visible(paragraph("孙正文"), false, "target heading state retained");
  await toggle("孙标题").focus();
  await page.keyboard.press("Enter");
  await visible(paragraph("孙正文"), true, "keyboard expansion");
  if (
    !(await toggle("孙标题").evaluate(
      (el) => el === document.activeElement && el.getAttribute("aria-expanded") === "true",
    ))
  )
    throw new Error("Keyboard toggle did not retain focus or expanded state");
  if (
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("foldApi").getSnapshot().json))) !==
      original ||
    (await page.evaluate(() => window.__semloRequireFixture("foldApi").getSnapshot().html)) !== originalHTML ||
    (await page.evaluate(() => window.__semloRequireFixture("foldChanges"))) !== 0
  )
    throw new Error("Folding changed serialized document data");

  await toggle("子标题").click();
  await toggle("父标题").click();
  await paragraph("后续正文").click();
  await page.keyboard.press("Meta+a");
  const all = await page.evaluate(() => {
    const state = window.__semloRequireFixture("foldApi").editor.state;
    return {
      empty: state.selection.empty,
      from: state.selection.from,
      to: state.selection.to,
      size: state.doc.content.size,
    };
  });
  if (all.empty || all.from > 1 || all.to < all.size - 1)
    throw new Error("Select-all was collapsed while a section was folded: " + JSON.stringify(all));
  await visible(paragraph("父正文"), false, "select-all keeps ancestor folded");
  await visible(paragraph("子正文"), false, "select-all keeps nested section folded");
  await page.keyboard.press("Backspace");
  if ((await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.getText())).trim())
    throw new Error("Deleting all did not remove hidden text");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.commands.undo())) ||
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("foldApi").getSnapshot().json))) !== original
  )
    throw new Error("Undo did not restore content after deleting a folded selection");

  await toggle("子标题").click();
  await toggle("父标题").click();
  const crossSelection = () =>
    page.evaluate(() => {
      const editor = window.__semloRequireFixture("foldApi").editor,
        from = window.__semloRequireFixture("foldPos")("父标题") + 1,
        end = window.__semloRequireFixture("foldPos")("后续标题"),
        to = end + editor.state.doc.nodeAt(end)!.nodeSize - 1;
      editor.commands.setTextSelection({ from, to });
      return { expectedFrom: from, expectedTo: to, from: editor.state.selection.from, to: editor.state.selection.to };
    });
  let crossing = await crossSelection();
  if (crossing.from !== crossing.expectedFrom || crossing.to !== crossing.expectedTo)
    throw new Error("A selection across a folded section was collapsed: " + JSON.stringify(crossing));
  await visible(paragraph("子正文"), false, "cross-section selection keeps nested folds");
  await toggle("父标题").click();
  await toggle("子标题").click();
  crossing = await crossSelection();
  await toggle("子标题").click();
  await toggle("父标题").click();
  const afterFolding = await page.evaluate(() => ({
    from: window.__semloRequireFixture("foldApi").editor.state.selection.from,
    to: window.__semloRequireFixture("foldApi").editor.state.selection.to,
  }));
  if (afterFolding.from !== crossing.expectedFrom || afterFolding.to !== crossing.expectedTo)
    throw new Error("Folding a section collapsed a selection whose endpoints remain visible");
  await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.commands.insertContent("跨越替换"));
  if ((await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.getText())).includes("子正文"))
    throw new Error("Editing a cross-section selection left hidden text behind");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.commands.undo())) ||
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("foldApi").getSnapshot().json))) !== original
  )
    throw new Error("Undo did not restore a cross-section edit");

  if ((await toggle("父标题").getAttribute("aria-expanded")) === "false") await toggle("父标题").click();
  if ((await toggle("子标题").getAttribute("aria-expanded")) === "true") await toggle("子标题").click();
  await toggle("父标题").click();
  const hiddenEndpoint = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldApi").editor;
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "子正文") from = pos + 1;
    });
    const to = window.__semloRequireFixture("foldPos")("后续标题") + 1;
    editor.commands.setTextSelection({ from, to });
    return { from, to, actualFrom: editor.state.selection.from, actualTo: editor.state.selection.to };
  });
  if (hiddenEndpoint.from !== hiddenEndpoint.actualFrom || hiddenEndpoint.to !== hiddenEndpoint.actualTo)
    throw new Error("A selection endpoint inside hidden content was lost");
  await visible(paragraph("子正文"), true, "hidden endpoint expands ancestors");

  await page.evaluate(() =>
    window
      .__semloRequireFixture("foldApi")
      .editor.commands.setTextSelection(window.__semloRequireFixture("foldPos")("子标题") + 1),
  );
  await toggle("子标题").click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldApi").editor;
    editor.view.dispatch(
      editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text("首部新增"))),
    );
  });
  if ((await toggle("子标题").getAttribute("aria-expanded")) !== "false")
    throw new Error("Fold state was lost after insertion");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.commands.undo())) ||
    (await toggle("子标题").getAttribute("aria-expanded")) !== "false"
  )
    throw new Error("Fold state was lost after undo");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("foldApi").editor.commands.redo())) ||
    (await toggle("子标题").getAttribute("aria-expanded")) !== "false"
  )
    throw new Error("Fold state was lost after redo");
  await visible(paragraph("子正文"), false, "mapped fold remains hidden");
  const clamped = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldApi").editor;
    let target = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "子正文") target = pos + 1;
    });
    editor.commands.setTextSelection(target);
    const pos = window.__semloRequireFixture("foldPos")("子标题"),
      node = editor.state.doc.nodeAt(pos);
    return editor.state.selection.from === pos + node!.nodeSize - 1;
  });
  if (!clamped) throw new Error("A programmatic selection remained in folded content");

  await page.evaluate(() => window.__semloRequireFixture("foldApi").setEditable(false));
  await toggle("子标题").click();
  await visible(paragraph("子正文"), true, "readonly expansion");
  await toggle("子标题").click();
  await visible(paragraph("子正文"), false, "readonly folding");
  await page.evaluate(() => window.__semloRequireFixture("foldApi").setEditable(true));
  await page.evaluate(() =>
    window.__semloRequireFixture("foldApi").setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "外标题" }] },
        {
          type: "blockquote",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "内标题" }] },
            { type: "paragraph", content: [{ type: "text", text: "内正文" }] },
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "内同级" }] },
            { type: "paragraph", content: [{ type: "text", text: "同级内容" }] },
          ],
        },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "末标题" }] },
        { type: "paragraph", content: [{ type: "text", text: "末正文" }] },
      ],
    }),
  );
  await visible(paragraph("内正文"), true, "new document starts expanded");
  await toggle("内标题").click();
  await visible(paragraph("内正文"), false, "nested container fold");
  await visible(heading("内同级"), true, "nested same-level boundary");
  await toggle("外标题").click();
  await visible(heading("内标题"), false, "outer fold hides nested container");
  await openOutline();
  await outline.getByRole("button", { name: "内标题", exact: true }).click();
  await visible(heading("内标题"), true, "nested heading revealed");
  await visible(paragraph("内正文"), false, "nested fold retained after reveal");
  await page.evaluate(() => window.__semloRequireFixture("foldApi").destroy());
  if (await host.locator(".semlo-editor-heading-fold-toggle").count())
    throw new Error("Destroy left heading controls behind");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    nested: true,
    levelBoundaries: true,
    outlineReveal: true,
    selectionSafety: true,
    selectAllAndDelete: true,
    crossSectionSelection: true,
    hiddenEndpoint: true,
    keyboard: true,
    positionMapping: true,
    undoRedo: true,
    readonly: true,
    nestedContainers: true,
    serialization: true,
    destroy: true,
  };
}
