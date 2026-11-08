async function _browserTest(
  page: import("playwright").Page,
  fonts: import("../../fixtures/browser/font-toolbar").FontToolbarTools,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () =>
        Promise.resolve([
          { family: "Font A", fullName: "字体甲", postscriptName: "FontA-Regular" },
          { family: "Font B", fullName: "字体乙", postscriptName: "FontB-Bold" },
          { family: "Font C", fullName: "字体丙", postscriptName: "FontC-Italic" },
        ]),
    });
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "font-scope-test";
    document.body.prepend(host);
    window.scopeApi = createEditor({ element: host, content: "<p><strong>天地</strong>玄黄</p><p>宇宙洪荒</p>" });
  });
  const host = page.locator("#font-scope-test"),
    prose = host.locator(".semlo-editor-prose");
  const menu = page.getByRole("dialog", { name: "选择字体" });
  await prose.locator("p").first().click();
  await page.keyboard.press("End");
  await fonts.open(host);
  if (await menu.getByRole("radio").count()) throw new Error("The menu should not show a scope selector");
  await menu.getByRole("option", { name: "字体甲", exact: true }).click();
  let snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  if (
    snapshot.json.attrs?.semloEditorDocumentFontFamily !== "FontA-Regular" ||
    snapshot.json.attrs?.semloEditorDocumentFontName !== "字体甲"
  )
    throw new Error("Font face did not apply to the document");
  const inherited = await prose
    .locator("p")
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontFamily));
  if (inherited.some((value) => !value.includes("FontA-Regular")))
    throw new Error("Document font did not affect all paragraphs: " + JSON.stringify(inherited));

  const selectHeaven = async () => {
    const p = prose.locator("p").first();
    await p.click();
    const result = await p.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const offset = (node.textContent ?? "").indexOf("天地");
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 2);
        const selected = window.getSelection()!;
        selected.removeAllRanges();
        selected.addRange(range);
        return selected.toString();
      }
      return "";
    });
    if (result !== "天地") throw new Error("Could not select text for the test");
  };
  await selectHeaven();
  await fonts.open(host);
  await menu.getByLabel("搜索字体").fill("字体乙");
  await menu.getByRole("option", { name: "字体乙", exact: true }).click();
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  const firstText = snapshot.json.content![0].content!.find((node) => node.text === "天地");
  if (
    snapshot.json.attrs?.semloEditorDocumentFontFamily !== "FontA-Regular" ||
    firstText?.marks?.find((mark) => mark.type === "textStyle")?.attrs!.fontFamily !== '"FontB-Bold"' ||
    !firstText?.marks?.some((mark) => mark.type === "bold")
  )
    throw new Error("Selected-text face did not preserve the document font and text marks");

  await selectHeaven();
  await fonts.open(host);
  await menu.getByRole("option", { name: "默认字体", exact: true }).click();
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  const resetText = snapshot.json.content![0].content!.find((node) => node.text?.startsWith("天地"));
  if (
    snapshot.json.attrs?.semloEditorDocumentFontFamily !== "FontA-Regular" ||
    resetText?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily)
  )
    throw new Error("Resetting selected text altered the document font or left an inline font");

  await prose.locator("p").last().click();
  await page.keyboard.press("End");
  await fonts.open(host);
  await menu.getByRole("option", { name: "字体丙", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches("#font-scope-test .semlo-editor-prose"));
  await page.keyboard.type("X");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  const inserted = snapshot.json.content![1].content!.find((node) => node.text?.includes("X"));
  if (
    snapshot.json.attrs?.semloEditorDocumentFontFamily !== "FontC-Italic" ||
    !inserted ||
    inserted.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily)
  )
    throw new Error("A cursor did not change the document font");

  await selectHeaven();
  await fonts.open(host);
  await menu.getByRole("option", { name: "字体乙", exact: true }).click();
  await prose.locator("p").last().click();
  await page.keyboard.press("ArrowRight");
  await fonts.open(host);
  await menu.getByRole("option", { name: "字体甲", exact: true }).click();
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  if (
    snapshot.json.attrs?.semloEditorDocumentFontFamily !== "FontA-Regular" ||
    snapshot.json.content!.some((p) =>
      p.content?.some((node) => node.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily)),
    )
  )
    throw new Error("Document font did not clear inline font overrides");
  if (!snapshot.json.content![0].content!.some((node) => node.marks?.some((mark) => mark.type === "bold")))
    throw new Error("Document font lost another text style");
  await prose.locator("p").last().click();
  await page.keyboard.press("ArrowRight");
  await fonts.open(host);
  await menu.getByRole("option", { name: "默认字体", exact: true }).click();
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  if (snapshot.json.attrs?.semloEditorDocumentFontFamily || (await prose.evaluate((el) => el.style.fontFamily)))
    throw new Error("Document default did not clear its font");

  await prose.locator("p").first().click();
  const allSelection = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("scopeApi").editor;
    editor.commands.selectAll();
    return editor.state.selection.toJSON().type;
  });
  if (allSelection !== "all") throw new Error("Test failed to create an AllSelection: " + allSelection);
  await fonts.open(host);
  await menu.getByRole("option", { name: "字体乙", exact: true }).click();
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  const allTexts = snapshot.json.content!.flatMap(
    (node) => node.content?.filter((child) => child.type === "text") ?? [],
  );
  if (
    snapshot.json.attrs?.semloEditorDocumentFontFamily ||
    !allTexts.length ||
    allTexts.some((node) => node.marks?.find((mark) => mark.type === "textStyle")?.attrs!.fontFamily !== '"FontB-Bold"')
  )
    throw new Error("AllSelection changed the document default or did not style all selected text");

  await page.evaluate(() =>
    window.__semloRequireFixture("scopeApi").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "丙" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "丁" }] }] },
              ],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "后" }] },
      ],
    }),
  );
  await prose.locator("td").first().click();
  const cellSelection = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("scopeApi").editor,
      cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
    return { type: editor.state.selection.toJSON().type, cells: cells.length };
  });
  if (cellSelection.type !== "cell" || cellSelection.cells !== 4)
    throw new Error("Test failed to create a table selection: " + JSON.stringify(cellSelection));
  await fonts.open(host);
  await menu.getByRole("option", { name: "字体乙", exact: true }).click();
  snapshot = await page.evaluate(() => window.__semloRequireFixture("scopeApi").getSnapshot());
  const table = snapshot.json.content!.find((node) => node.type === "table");
  if (!table?.content) throw new Error("Table is missing from the editor snapshot");
  const cells = table.content
    .flatMap((row) => {
      if (!row.content) throw new Error("Table row has no cells");
      return row.content;
    })
    .map((cell) => {
      if (!cell.content?.[0]) throw new Error("Table cell has no paragraph");
      return cell.content[0].content?.[0];
    });
  if (
    cells.length !== 4 ||
    snapshot.json.attrs?.semloEditorDocumentFontFamily ||
    cells
      .slice(0, 2)
      .some((node) => node?.marks?.find((mark) => mark.type === "textStyle")?.attrs!.fontFamily !== '"FontB-Bold"') ||
    cells.slice(2).some((node) => node?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily))
  )
    throw new Error("Cell selection changed the document or unselected table cells: " + JSON.stringify(cells));

  await page.evaluate(() => window.__semloRequireFixture("scopeApi").setContent("<p>前</p><hr><p>后</p>"));
  await prose
    .locator("p")
    .first()
    .click({ position: { x: 5, y: 10 } });
  const nodeSelection = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("scopeApi").editor;
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "horizontalRule") position = pos;
    });
    editor.commands.setNodeSelection(position!);
    return editor.state.selection.toJSON().type;
  });
  if (nodeSelection !== "node") throw new Error("Test failed to create a non-text node selection: " + nodeSelection);
  await fonts.open(host);
  await menu.getByText("请选择文字或将光标置于正文，再设置字体。").waitFor();
  if (!(await menu.getByRole("option", { name: "默认字体", exact: true }).isDisabled()))
    throw new Error("A non-text node selection allowed applying a font");
  await page.keyboard.press("Escape");

  await prose
    .locator("p")
    .first()
    .click({ position: { x: 5, y: 10 } });
  await page.evaluate(() =>
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => new Promise((resolve) => (window.scopeLateResolve = resolve)),
    }),
  );
  await fonts.open(host);
  await page.evaluate(() => window.__semloRequireFixture("scopeApi").setContent("<p>新文档</p>"));
  if (await menu.count()) throw new Error("Document replacement left the old font picker open");
  const before = await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("scopeApi").getSnapshot().json));
  await page.evaluate(() => window.__semloRequireFixture("scopeLateResolve")([{ family: "过期字体" }]));
  await page.waitForTimeout(20);
  if (
    (await menu.count()) ||
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("scopeApi").getSnapshot().json))) !== before
  )
    throw new Error("A late font result changed the replacement document");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    documentFromCursor: true,
    selectedText: true,
    selectionRestore: true,
    documentClearsInline: true,
    documentReset: true,
    allSelection: true,
    cellSelection: true,
    nonTextSelection: true,
    replacedDocumentRace: true,
  };
}
