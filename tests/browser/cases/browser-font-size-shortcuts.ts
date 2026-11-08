async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const {
      Editor,
      createStarterKitWithCodeFonts,
      CodeCard,
      TextStyle,
      FontSize,
      FontFamily,
      Color,
      Highlight,
      Subscript,
      Superscript,
      DocumentFontExtension,
      LocalFontName,
      FontSizeShortcuts,
    } = await import("/dist/index.js");
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
    let platform = "MacIntel";
    Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform });
    const editors = new Map<string, { editor: import("@tiptap/core").Editor; host: HTMLElement }>();
    window.fontShortcutEvents = [];
    const recordKey = (event: KeyboardEvent) => {
      if (event.code === "Equal" || event.code === "Minus")
        window
          .__semloRequireFixture("fontShortcutEvents")
          .push({ code: event.code, prevented: event.defaultPrevented });
    };
    document.addEventListener("keydown", recordKey);
    window.fontShortcutFixture = {
      create(id, content, editable = true) {
        const host = document.createElement("div");
        host.id = `font-shortcut-${id}`;
        document.body.prepend(host);
        const editor = new Editor({
          element: host,
          content,
          editable,
          extensions: [
            createStarterKitWithCodeFonts([]),
            CodeCard,
            TextStyle,
            FontFamily,
            FontSize,
            Color,
            Highlight.configure({ multicolor: true }),
            Subscript,
            Superscript,
            LocalFontName,
            DocumentFontExtension,
            FontSizeShortcuts,
          ],
        });
        editor.view.dom.setAttribute("tabindex", "0");
        editors.set(id, { editor, host });
      },
      platform(value) {
        platform = value;
      },
      select(id, first, firstOffset, last, lastOffset, reverse = false) {
        const editor = editors.get(id)!.editor;
        let start: number | undefined, end: number | undefined;
        editor.state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          if (start === undefined && (node.text ?? "").includes(first))
            start = pos + (node.text ?? "").indexOf(first) + firstOffset;
          if (end === undefined && (node.text ?? "").includes(last))
            end = pos + (node.text ?? "").indexOf(last) + lastOffset;
        });
        if (start === undefined || end === undefined)
          throw new Error(`Could not find selected text: ${first}, ${last}`);
        editor.view.focus();
        editor.commands.setTextSelection(reverse ? { from: end, to: start } : { from: start, to: end });
      },
      snapshot(id) {
        return editors.get(id)!.editor.getJSON();
      },
      editable(id, value) {
        editors.get(id)!.editor.setEditable(value, false);
      },
      focused(id) {
        return document.activeElement === editors.get(id)!.editor.view.dom;
      },
      destroyed(id) {
        const item = editors.get(id)!;
        item.editor.destroy();
        item.host.remove();
        editors.delete(id);
      },
      cleanup() {
        for (const { editor, host } of editors.values()) {
          editor.destroy();
          host.remove();
        }
        editors.clear();
        document.removeEventListener("keydown", recordKey);
        if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
        else Reflect.deleteProperty(navigator, "platform");
      },
    };
    window
      .__semloRequireFixture("fontShortcutFixture")
      .create("simple", '<p><span style="font-size: 15px">简例</span></p>');
    window
      .__semloRequireFixture("fontShortcutFixture")
      .create("mouse", '<p><span style="font-size: 24px">甲乙</span><span style="font-size: 15px">丙丁</span></p>');
    window.__semloRequireFixture("fontShortcutFixture").create("mixed", {
      type: "doc",
      attrs: {
        semloEditorDocumentFontFamily: "DocumentFont",
        semloEditorDocumentFontName: "Document Font",
        semloEditorDocumentFontVariants: { bold: "Document Bold" },
      },
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "甲乙",
              marks: [
                { type: "bold" },
                {
                  type: "textStyle",
                  attrs: {
                    fontSize: "24px",
                    fontFamily: "Arial",
                    semloEditorFontName: "Arial",
                    semloEditorFontVariants: { bold: "Arial Bold" },
                    color: "#f5222d",
                  },
                },
              ],
            },
            {
              type: "text",
              text: "丙丁",
              marks: [
                { type: "italic" },
                {
                  type: "textStyle",
                  attrs: { fontSize: "15px", fontFamily: "Georgia", semloEditorFontName: "Georgia", color: "#008800" },
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "戊己",
              marks: [{ type: "underline" }, { type: "textStyle", attrs: { fontSize: "16px", color: "#3344ff" } }],
            },
          ],
        },
      ],
    });
    window.__semloRequireFixture("fontShortcutFixture").create("cursor", "<p>ab</p>");
    window.__semloRequireFixture("fontShortcutFixture").create("code", {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "前段",
              marks: [{ type: "textStyle", attrs: { fontSize: "22px", color: "#ff0000" } }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "javascript", title: "示例", theme: "light", collapsed: false },
          content: [
            {
              type: "text",
              text: "let abc",
              marks: [{ type: "textStyle", attrs: { fontSize: "15px", color: "#008800" } }],
            },
          ],
        },
      ],
    });
    window
      .__semloRequireFixture("fontShortcutFixture")
      .create("bounds", '<p><span style="font-size: 12px">低</span><span style="font-size: 48px">高</span></p>');
    window
      .__semloRequireFixture("fontShortcutFixture")
      .create("fallback", '<p><span style="font-size: 1em">未知</span>默认</p>');
  });
  const select = (id: string, first: string, from: number, last: string, to: number, reverse = false) =>
    page.evaluate((args) => window.__semloRequireFixture("fontShortcutFixture").select(...args), [
      id,
      first,
      from,
      last,
      to,
      reverse,
    ] as [string, string, number, string, number, boolean]);
  const snapshot = (id: string) =>
    page.evaluate((id) => window.__semloRequireFixture("fontShortcutFixture").snapshot(id), id);
  const characters = (json: import("@tiptap/core").JSONContent) => {
    const result: Array<{ char: string; marks: NonNullable<import("@tiptap/core").JSONContent["marks"]> }> = [];
    const visit = (node: import("@tiptap/core").JSONContent) => {
      if (node.type === "text") {
        if (typeof node.text !== "string") throw new Error("Text node is missing its text");
        for (const char of node.text) result.push({ char, marks: node.marks ?? [] });
      }
      for (const child of node.content ?? []) visit(child);
    };
    visit(json);
    if (!result.length) throw new Error("Expected text characters in the editor snapshot");
    return result;
  };
  const style = (character: ReturnType<typeof characters>[number]) =>
    character.marks.find((mark) => mark.type === "textStyle")?.attrs ?? {};
  const size = (character: ReturnType<typeof characters>[number] | undefined) => {
    if (!character) throw new Error("Expected character was not found");
    return style(character).fontSize ?? null;
  };
  const withoutSize = (character: ReturnType<typeof characters>[number]) =>
    character.marks.map((mark) =>
      mark.type === "textStyle" ? { ...mark, attrs: { ...mark.attrs, fontSize: null } } : mark,
    );
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  try {
    await select("simple", "简例", 0, "简例", 2);
    if (!(await page.evaluate(() => window.__semloRequireFixture("fontShortcutFixture").focused("simple"))))
      throw new Error("Editor did not receive keyboard focus");
    await page.keyboard.press("ControlOrMeta+Alt+-");
    if (!characters(await snapshot("simple")).every((char) => size(char) === "14px"))
      throw new Error("15px decrease should produce 14px");
    await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
    if (!characters(await snapshot("simple")).every((char) => size(char) === "15px"))
      throw new Error("14px increase should produce 15px");

    const mouseRange = await page.locator("#font-shortcut-mouse p").evaluate((paragraph) => {
      const spans = paragraph.querySelectorAll("span"),
        first = spans[0].getBoundingClientRect(),
        last = spans[1].getBoundingClientRect();
      return { x1: first.left + 0.5, x2: last.right - 0.5, y: first.top + first.height / 2 };
    });
    await page.mouse.move(mouseRange.x1, mouseRange.y);
    await page.mouse.down();
    await page.mouse.move(mouseRange.x2, mouseRange.y, { steps: 8 });
    await page.mouse.up();
    if ((await page.evaluate(() => window.getSelection()!.toString())) !== "甲乙丙丁")
      throw new Error("Mouse did not select the mixed-size text");
    await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
    if (!characters(await snapshot("mouse")).every((char) => size(char) === "29px"))
      throw new Error("Shortcut did not apply to a real mouse selection");

    const before = await snapshot("mixed");
    await select("mixed", "甲乙", 1, "戊己", 1, true);
    await page.keyboard.press("ControlOrMeta+Alt+=");
    const adjusted = await snapshot("mixed"),
      originalChars = characters(before),
      adjustedChars = characters(adjusted);
    if (!same(before.attrs, adjusted.attrs)) throw new Error("Document font attributes changed");
    for (let i = 0; i < originalChars.length; i++) {
      if (!same(withoutSize(originalChars[i]), withoutSize(adjustedChars[i])))
        throw new Error(`Other formatting changed for ${originalChars[i].char}`);
      const expected = i > 0 && i < 5 ? "29px" : size(originalChars[i]);
      if (size(adjustedChars[i]) !== expected)
        throw new Error(
          `Mixed cross-block selection applied wrong size to ${originalChars[i].char}: ${size(adjustedChars[i])}`,
        );
    }
    await page.keyboard.type("X");
    const typed = await snapshot("mixed");
    await page.keyboard.press("ControlOrMeta+z");
    if (!same(await snapshot("mixed"), adjusted)) throw new Error("Undo did not isolate subsequent typing");
    await page.keyboard.press("ControlOrMeta+z");
    if (!same(await snapshot("mixed"), before)) throw new Error("Undo did not restore mixed original sizes");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    if (!same(await snapshot("mixed"), typed)) throw new Error("Redo did not restore font sizes and subsequent typing");

    const beforeCode = await snapshot("code");
    await select("code", "前段", 0, "let abc", 3);
    await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
    const afterCode = await snapshot("code"),
      codeOriginal = characters(beforeCode),
      codeAdjusted = characters(afterCode);
    if (!same(beforeCode.content![1].attrs, afterCode.content![1].attrs))
      throw new Error("Code block attributes changed");
    for (let i = 0; i < codeOriginal.length; i++) {
      if (!same(withoutSize(codeOriginal[i]), withoutSize(codeAdjusted[i])))
        throw new Error("Cross-block code selection changed another format");
      const expected = i < 5 ? "24px" : size(codeOriginal[i]);
      if (size(codeAdjusted[i]) !== expected) throw new Error("Cross-block code selection applied an incorrect size");
    }

    await select("cursor", "ab", 2, "ab", 2);
    await page.keyboard.press("ControlOrMeta+Alt+-");
    await page.keyboard.type("Z");
    let cursor = characters(await snapshot("cursor"));
    if (size(cursor.find((char) => char.char === "Z")) !== "14px")
      throw new Error("Collapsed selection did not apply 14px to subsequent typing");
    await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
    await page.keyboard.type("Y");
    cursor = characters(await snapshot("cursor"));
    if (size(cursor.find((char) => char.char === "Y")) !== "15px")
      throw new Error("Collapsed selection did not retain the updated stored size");
    await page.keyboard.press("ControlOrMeta+z");
    cursor = characters(await snapshot("cursor"));
    if (!cursor.some((char) => char.char === "Z") || cursor.some((char) => char.char === "Y"))
      throw new Error("Undo grouped text typed across separate cursor size changes");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    if (size(characters(await snapshot("cursor")).find((char) => char.char === "Y")) !== "15px")
      throw new Error("Redo lost cursor font size");

    const bounds = await snapshot("bounds");
    await select("bounds", "低", 0, "低", 1);
    await page.keyboard.press("ControlOrMeta+Alt+-");
    await select("bounds", "高", 0, "高", 1);
    await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
    if (!same(await snapshot("bounds"), bounds)) throw new Error("Font size exceeded supported bounds");
    if (
      !(await page.evaluate(() => window.__semloRequireFixture("fontShortcutEvents").slice(-2))).every(
        (event) => event.prevented,
      )
    )
      throw new Error("Boundary shortcut was not consumed");
    await select("bounds", "低", 0, "低", 1);
    const steps = [12, 13, 14, 15, 16, 19, 22, 24, 29, 32, 40, 48];
    for (const expected of steps.slice(1)) {
      await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
      if (size(characters(await snapshot("bounds")).find((char) => char.char === "低")) !== `${expected}px`)
        throw new Error(`Increasing skipped the ${expected}px step`);
    }
    for (const expected of steps.slice(0, -1).reverse()) {
      await page.keyboard.press("ControlOrMeta+Alt+-");
      if (size(characters(await snapshot("bounds")).find((char) => char.char === "低")) !== `${expected}px`)
        throw new Error(`Decreasing skipped the ${expected}px step`);
    }
    await select("fallback", "未知", 0, "未知", 2);
    await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
    if (
      !characters(await snapshot("fallback"))
        .filter((char) => "未知".includes(char.char))
        .every((char) => size(char) === "16px")
    )
      throw new Error("Unsupported font size did not fall back to 15px");
    await select("fallback", "默认", 0, "默认", 2);
    await page.keyboard.press("ControlOrMeta+Alt+-");
    if (
      !characters(await snapshot("fallback"))
        .filter((char) => "默认".includes(char.char))
        .every((char) => size(char) === "14px")
    )
      throw new Error("Missing font size did not fall back to 15px");

    await page.evaluate(() => window.__semloRequireFixture("fontShortcutFixture").platform("Win32"));
    await select("simple", "简例", 0, "简例", 2);
    await page.keyboard.press("Control+Alt+-");
    if (!characters(await snapshot("simple")).every((char) => size(char) === "14px"))
      throw new Error("Windows decrease shortcut failed");
    await page.keyboard.press("Control+Alt+Shift+=");
    if (!characters(await snapshot("simple")).every((char) => size(char) === "15px"))
      throw new Error("Windows increase shortcut failed");
    const readonly = await snapshot("simple");
    const ignored = await page.evaluate(() => {
      const dom = document.querySelector("#font-shortcut-simple .ProseMirror");
      const composing = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "-",
        code: "Minus",
        ctrlKey: true,
        altKey: true,
        isComposing: true,
      });
      const wrongModifier = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "-",
        code: "Minus",
        metaKey: true,
        altKey: true,
      });
      dom!.dispatchEvent(composing);
      dom!.dispatchEvent(wrongModifier);
      return { composing: composing.defaultPrevented, wrongModifier: wrongModifier.defaultPrevented };
    });
    if (ignored.composing || ignored.wrongModifier || !same(await snapshot("simple"), readonly))
      throw new Error("Shortcut intercepted composition or unrelated modifiers");
    await page.evaluate(() => window.__semloRequireFixture("fontShortcutFixture").editable("simple", false));
    await select("simple", "简例", 0, "简例", 2);
    await page.keyboard.press("Control+Alt+-");
    if (!same(await snapshot("simple"), readonly)) throw new Error("Read-only editor changed font size");
    await page.evaluate(() => window.__semloRequireFixture("fontShortcutFixture").destroyed("simple"));
    await page.keyboard.press("Control+Alt+-");
    if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
    return {
      mac: true,
      windows: true,
      mouseSelection: true,
      mixed: true,
      crossBlock: true,
      codeBlock: true,
      documentFont: true,
      formats: true,
      cursor: true,
      bounds: true,
      fallback: true,
      undoRedo: true,
      readonly: true,
      destroy: true,
    };
  } finally {
    await page.evaluate(() => window.__semloRequireFixture("fontShortcutFixture").cleanup());
  }
}
