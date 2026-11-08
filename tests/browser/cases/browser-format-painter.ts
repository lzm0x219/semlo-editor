async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    window.createPainterEditor = createEditor;
    const host = document.createElement("div");
    host.id = "painter-test";
    document.body.prepend(host);
    window.painterApi = createEditor({ element: host, content: "<p>准备</p>" });
  });
  const host = page.locator("#painter-test"),
    prose = host.locator(".semlo-editor-prose");
  const painter = host.locator(".semlo-editor-toolbar .semlo-editor-format-painter");
  if (
    (await host.locator(".semlo-editor-toolbar").getByRole("button", { name: "格式刷", exact: true }).count()) !== 1 ||
    !(await painter.getAttribute("title"))?.includes("⇧⌘S")
  )
    throw new Error("The toolbar format painter or its shortcut hint is missing");
  const text = (value: string, marks: NonNullable<import("@tiptap/core").JSONContent["marks"]> = []) => ({
    type: "text",
    text: value,
    ...(marks.length ? { marks } : {}),
  });
  const paragraph = (...content: import("@tiptap/core").JSONContent[]) => ({ type: "paragraph", content });
  const mark = (type: string, attrs?: Record<string, unknown>) => ({ type, ...(attrs ? { attrs } : {}) });
  const content = (paragraphs: import("@tiptap/core").JSONContent[], attrs?: Record<string, unknown>) => ({
    type: "doc",
    ...(attrs ? { attrs } : {}),
    content: paragraphs,
  });
  const reset = async (value: import("../../../packages/core/src/types").EditorContent) =>
    page.evaluate((value) => window.__semloRequireFixture("painterApi").setContent(value), value);
  const selectParagraph = async (index: number) =>
    page.evaluate((index) => {
      const editor = window.__semloRequireFixture("painterApi").editor;
      let position = 0;
      for (let i = 0; i < index; i++) position += editor.state.doc.child(i).nodeSize;
      const node = editor.state.doc.child(index);
      editor.commands.focus();
      editor.commands.setTextSelection({ from: position + 1, to: position + 1 + node.textContent.length });
    }, index);
  const selectionAt = async (index: number, offset = 0) =>
    page.evaluate(
      ({ index, offset }) => {
        const editor = window.__semloRequireFixture("painterApi").editor;
        let position = 0;
        for (let i = 0; i < index; i++) position += editor.state.doc.child(i).nodeSize;
        editor.commands.focus();
        editor.commands.setTextSelection(position + 1 + offset);
      },
      { index, offset },
    );
  const paragraphData = async (index: number) =>
    page.evaluate(
      (index) => window.__semloRequireFixture("painterApi").getSnapshot().json.content![index].content!,
      index,
    );
  const hasMark = (node: import("@tiptap/core").JSONContent, type: string) =>
    node.marks?.some((mark) => mark.type === type) ?? false;
  const styleOf = (node: import("@tiptap/core").JSONContent) =>
    node.marks?.find((mark) => mark.type === "textStyle")?.attrs;
  const waitForParagraph = async (index: number, type: string, present: boolean) =>
    page.waitForFunction(
      ({ index, type, present }) => {
        const nodes = window.__semloRequireFixture("painterApi").getSnapshot().json.content![index].content ?? [];
        return nodes.length > 0 && nodes.every((node) => !!node.marks?.some((mark) => mark.type === type) === present);
      },
      { index, type, present },
    );
  const dragParagraph = async (index: number) => {
    const target = prose.locator("p").nth(index);
    await target.scrollIntoViewIfNeeded();
    const points = await target.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
        texts: Text[] = [];
      let node;
      while ((node = walker.nextNode())) if (node instanceof Text && node.length) texts.push(node);
      if (!texts.length) throw new Error("No target text");
      const first = document.createRange(),
        last = document.createRange();
      first.setStart(texts[0], 0);
      first.setEnd(texts[0], 1);
      const tail = texts.at(-1)!;
      last.setStart(tail, tail.length - 1);
      last.setEnd(tail, tail.length);
      const a = first.getBoundingClientRect(),
        b = last.getBoundingClientRect();
      return { startX: a.left + 0.2, startY: a.top + a.height / 2, endX: b.right - 0.2, endY: b.top + b.height / 2 };
    });
    await page.mouse.move(points.startX, points.startY);
    await page.mouse.down();
    await page.mouse.move(points.endX, points.endY, { steps: 12 });
    await page.mouse.up();
  };

  await reset(
    content([
      paragraph(text("粗体源", [mark("bold")])),
      paragraph(text("目标一")),
      paragraph(text("目标二", [mark("bold")])),
    ]),
  );
  await selectParagraph(0);
  const bubble = host.locator(".semlo-editor-bubble");
  await bubble.waitFor({ state: "visible" });
  await painter.click();
  if ((await painter.getAttribute("aria-pressed")) !== "true") throw new Error("Single-click did not arm the painter");
  if (await bubble.isVisible()) throw new Error("The floating toolbar obscures the painter target");
  await dragParagraph(1);
  await waitForParagraph(1, "bold", true);
  if ((await painter.getAttribute("aria-pressed")) !== "false")
    throw new Error("Single-use painter did not exit after a drag");
  await bubble.waitFor({ state: "visible" });
  await page.evaluate(() => window.__semloRequireFixture("painterApi").editor.commands.undo());
  if ((await paragraphData(1)).some((node) => hasMark(node, "bold")))
    throw new Error("Undo did not restore the target format");
  await page.evaluate(() => window.__semloRequireFixture("painterApi").editor.commands.redo());
  if (!(await paragraphData(1)).every((node) => hasMark(node, "bold")))
    throw new Error("Redo did not restore the painted format");
  await reset(content([paragraph(text("普通源")), paragraph(text("粗体目标", [mark("bold")]))]));
  await selectParagraph(0);
  await painter.click();
  await dragParagraph(1);
  await waitForParagraph(1, "bold", false);

  await reset(
    content([paragraph(text("连续源", [mark("bold")])), paragraph(text("目标甲")), paragraph(text("目标乙"))]),
  );
  await selectParagraph(0);
  await painter.dblclick();
  if (
    (await painter.getAttribute("aria-pressed")) !== "true" ||
    (await painter.getAttribute("data-semlo-editor-painter-continuous")) !== "true"
  )
    throw new Error("Double-click did not enable continuous painting");
  await dragParagraph(1);
  await waitForParagraph(1, "bold", true);
  if ((await painter.getAttribute("aria-pressed")) !== "true")
    throw new Error("Continuous painter exited after its first target");
  await dragParagraph(2);
  await waitForParagraph(2, "bold", true);
  await page.keyboard.press("Escape");
  if ((await painter.getAttribute("aria-pressed")) !== "false")
    throw new Error("Escape did not exit continuous painting");
  await page.evaluate(() => window.__semloRequireFixture("painterApi").editor.commands.undo());
  if (
    !(await paragraphData(1)).every((node) => hasMark(node, "bold")) ||
    (await paragraphData(2)).some((node) => hasMark(node, "bold"))
  )
    throw new Error("Continuous brush strokes were not separate undo steps");
  await page.evaluate(() => window.__semloRequireFixture("painterApi").editor.commands.undo());
  if ((await paragraphData(1)).some((node) => hasMark(node, "bold")))
    throw new Error("Undo did not remove the earlier brush stroke");

  const styled = [
    mark("link", { href: "https://source.example/" }),
    mark("bold"),
    mark("italic"),
    mark("underline"),
    mark("strike"),
    mark("highlight", { color: "#ffec00" }),
    mark("textStyle", {
      fontFamily: '"Face-Regular"',
      semloEditorFontName: "可读字形",
      semloEditorFontVariants: { bold: "Face-Bold" },
      fontSize: "23px",
      color: "#123456",
    }),
  ];
  await reset(
    content([
      paragraph(text("格式源", styled)),
      paragraph(
        text("带链接目标", [
          mark("link", { href: "https://target.example/" }),
          mark("textStyle", { fontSize: "12px", color: "#abcdef" }),
        ]),
      ),
    ]),
  );
  await selectParagraph(0);
  await painter.click();
  await dragParagraph(1);
  await waitForParagraph(1, "bold", true);
  let target = await paragraphData(1);
  for (const node of target) {
    for (const name of ["bold", "italic", "underline", "strike", "highlight"])
      if (!hasMark(node, name)) throw new Error("Missing copied mark: " + name);
    const attrs = styleOf(node),
      link = node.marks!.find((mark) => mark.type === "link")?.attrs!.href;
    if (
      link !== "https://target.example/" ||
      attrs?.fontFamily !== '"Face-Regular"' ||
      attrs.semloEditorFontName !== "可读字形" ||
      attrs.semloEditorFontVariants?.bold !== "Face-Bold" ||
      attrs.fontSize !== "23px" ||
      attrs.color !== "#123456"
    )
      throw new Error("Copied text style or preserved link is wrong: " + JSON.stringify(node));
  }

  await reset(
    content(
      [
        paragraph(text("继承源")),
        paragraph(text("局部目标", [mark("textStyle", { fontFamily: '"Other"', semloEditorFontName: "其他字体" })])),
      ],
      {
        semloEditorDocumentFontFamily: "Whole Font",
        semloEditorDocumentFontName: "全文字形",
        semloEditorDocumentFontVariants: { bold: "Whole-Bold" },
      },
    ),
  );
  await selectParagraph(0);
  await painter.click();
  await dragParagraph(1);
  await page.waitForFunction(() =>
    window
      .__semloRequireFixture("painterApi")
      .getSnapshot()
      .json.content![1].content![0].marks?.some(
        (mark) => mark.type === "textStyle" && mark.attrs!.semloEditorFontName === "全文字形",
      ),
  );
  target = await paragraphData(1);
  if (
    target.some(
      (node) =>
        styleOf(node)?.fontFamily !== '"Whole Font"' || styleOf(node)?.semloEditorFontVariants?.bold !== "Whole-Bold",
    )
  )
    throw new Error("The inherited document font was not copied");

  await reset(
    content([
      paragraph(
        text("甲乙", [mark("bold"), mark("textStyle", { fontSize: "22px", color: "#112233" })]),
        text("丙丁", [mark("textStyle", { fontSize: "22px", color: "#112233" })]),
      ),
      paragraph(
        text("混合目标", [mark("bold"), mark("italic"), mark("textStyle", { fontSize: "12px", color: "#abcdef" })]),
      ),
    ]),
  );
  await selectParagraph(0);
  await painter.click();
  await dragParagraph(1);
  await waitForParagraph(1, "italic", false);
  target = await paragraphData(1);
  if (
    target.some(
      (node) => !hasMark(node, "bold") || styleOf(node)?.fontSize !== "22px" || styleOf(node)?.color !== "#112233",
    )
  )
    throw new Error("Mixed source did not preserve disputed attributes and copy shared attributes");

  await reset(content([paragraph(text("键盘源", [mark("bold")])), paragraph(text("键盘目标"))]));
  await selectParagraph(0);
  await page.keyboard.press("ControlOrMeta+Shift+S");
  await page.waitForTimeout(80);
  if ((await painter.getAttribute("aria-pressed")) !== "true") throw new Error("The shortcut did not arm the painter");
  await selectionAt(1);
  await page.keyboard.down("Shift");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await waitForParagraph(1, "bold", true);
  if ((await painter.getAttribute("aria-pressed")) !== "false")
    throw new Error("Keyboard selection did not complete single-use painting");
  await selectionAt(0, 1);
  await painter.click();
  await prose.locator("p").nth(1).click();
  if ((await painter.getAttribute("aria-pressed")) !== "true")
    throw new Error("A caret click incorrectly consumed the painter");
  await selectionAt(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("新");
  target = await paragraphData(1);
  if (!target.some((node) => node.text?.includes("新") && hasMark(node, "bold")))
    throw new Error("Keyboard application at a caret did not style subsequent text");

  await selectParagraph(0);
  await painter.click();
  await page.evaluate(() => window.__semloRequireFixture("painterApi").setEditable(false));
  if (!(await painter.isDisabled()) || (await painter.getAttribute("aria-pressed")) !== "false")
    throw new Error("Read-only mode did not disable and cancel the painter");
  await page.evaluate(() => window.__semloRequireFixture("painterApi").setEditable(true));
  await selectParagraph(0);
  await painter.click();
  await reset("<p>替换后内容</p>");
  if ((await painter.getAttribute("aria-pressed")) !== "false")
    throw new Error("Replacing the document did not cancel the painter");

  await page.evaluate(() => {
    const second = document.createElement("div");
    second.id = "painter-second";
    document.body.append(second);
    window.painterSecond = window.__semloRequireFixture("createPainterEditor")({
      element: second,
      content: "<p>另一编辑器</p>",
    });
  });
  await selectParagraph(0);
  await painter.click();
  await page.locator("#painter-second .semlo-editor-prose p").click();
  if ((await painter.getAttribute("aria-pressed")) !== "false")
    throw new Error("Switching editors left the first painter active");
  if (
    await page.evaluate(
      () => window.__semloRequireFixture("painterSecond").getSnapshot().json.content![0].content![0].marks?.length ?? 0,
    )
  )
    throw new Error("Painting leaked to another editor");
  await page.evaluate(() => {
    window.__semloRequireFixture("painterApi").destroy();
    window.__semloRequireFixture("painterSecond").destroy();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return {
    singleAndClear: true,
    continuous: true,
    allStylesAndLinks: true,
    inheritedDocumentFont: true,
    mixedSource: true,
    keyboard: true,
    undoRedo: true,
    lifecycleAndMultipleEditors: true,
  };
}
