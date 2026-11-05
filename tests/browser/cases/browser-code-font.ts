async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () =>
        Promise.resolve([
          { family: "Arial", fullName: "Arial" },
          { family: "Times New Roman", fullName: "Times New Roman" },
        ]),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.codeFontCopied = text;
        },
      },
    });
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "code-font-test";
    document.body.prepend(host);
    window.codeFontErrors = [];
    window.codeFontApi = createEditor({
      element: host,
      content: '<p>甲<code>inline</code>乙</p><pre><code class="language-javascript">const value = 1;</code></pre>',
      onError: (error) => window.__semloRequireFixture("codeFontErrors").push(error.message),
    });
  });
  const host = page.locator("#code-font-test"),
    prose = host.locator(".semlo-editor-prose");
  const toolbar = host.getByRole("button", { name: "字体", exact: true }),
    menu = page.getByRole("dialog", { name: "选择字体" });
  const selectText = async (container: import("playwright").Locator, text: string) => {
    await container.click();
    const selected = await container.evaluate((el, text) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = (node.textContent ?? "").indexOf(text);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      }
      return "";
    }, text);
    if (selected !== text) throw new Error("Could not select code text: " + text);
  };
  const choose = async (name: string) => {
    await toolbar.click();
    await menu.getByRole("option", { name, exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.matches("#code-font-test .semlo-editor-prose"));
  };
  await selectText(prose.locator("p code"), "nli");
  await choose("Arial");
  let snapshot = await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot());
  let inline = snapshot.json.content![0].content!.find((node) => node.text === "nli");
  if (
    !inline?.marks?.some((mark) => mark.type === "code") ||
    !inline.marks!.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily?.includes("Arial"))
  )
    throw new Error("Inline code lost its semantic mark or selected font: " + JSON.stringify(inline));
  const inlineStyle = await prose
    .locator('p code [data-semlo-editor-font-name="Arial"]')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  if (!inlineStyle.includes("Arial")) throw new Error("Selected inline code did not render in the selected font");
  if (
    snapshot.json
      .content![0].content!.filter((node) => node.marks?.some((mark) => mark.type === "code"))
      .map((node) => node.text)
      .join("") !== "inline"
  )
    throw new Error("Only the selected part of inline code should change");

  await selectText(host.locator(".semlo-editor-code-card code"), "const");
  await choose("Arial");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot());
  let block = snapshot.json.content!.find((node) => node.type === "codeBlock");
  if (
    block?.attrs?.language !== "javascript" ||
    !block
      .content!.find((node) => node.text === "const")
      ?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily?.includes("Arial"))
  )
    throw new Error("Selected code-block text lost font or language: " + JSON.stringify(block));
  if (
    !(
      await host
        .locator('.semlo-editor-code-card code [data-semlo-editor-font-name="Arial"]')
        .evaluate((el) => getComputedStyle(el).fontFamily)
    ).includes("Arial")
  )
    throw new Error("Selected code block did not render in the selected font");
  if (!(await host.locator(".semlo-editor-code-card .hljs-keyword").count()))
    throw new Error("Syntax highlighting disappeared");
  await host.locator(".semlo-editor-code-copy").click();
  if ((await page.evaluate(() => window.__semloRequireFixture("codeFontCopied"))) !== "const value = 1;")
    throw new Error("Code copy changed after font selection");
  await page.evaluate(() => window.__semloRequireFixture("codeFontApi").editor.commands.undo());
  block = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeFontApi")
      .getSnapshot()
      .json.content!.find((node) => node.type === "codeBlock"),
  );
  if (block!.content!.some((node) => node.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily)))
    throw new Error("Undo did not remove selected code-block font");
  await page.evaluate(() => window.__semloRequireFixture("codeFontApi").editor.commands.redo());
  snapshot = await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot());
  if (
    !snapshot.json
      .content!.find((node) => node.type === "codeBlock")!
      .content!.some((node) => node.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily))
  )
    throw new Error("Redo did not restore selected code-block font");
  const original = snapshot.json;
  const comparable = (json: import("@tiptap/core").JSONContent) =>
    page.evaluate((value) => {
      const normalize = (node: import("@tiptap/core").JSONContent) => {
        if (node.marks)
          for (const mark of node.marks)
            if (mark.type === "textStyle") {
              const span = document.createElement("span");
              span.style.fontFamily = mark.attrs!.fontFamily ?? "";
              mark.attrs!.fontFamily = span.style.fontFamily || null;
              mark.attrs!.fontSize ||= null;
              mark.attrs!.color ||= null;
            }
        for (const child of node.content ?? []) normalize(child);
      };
      const copy = structuredClone(value);
      normalize(copy);
      return JSON.stringify(copy.content);
    }, json);
  await page.evaluate((html) => {
    window.__semloRequireFixture("codeFontApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("codeFontApi").setContent(html);
  }, snapshot.html);
  snapshot = await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot());
  if (
    (await comparable(snapshot.json)) !== (await comparable(original)) ||
    (await page.evaluate(() => window.__semloRequireFixture("codeFontErrors").length))
  )
    throw new Error(
      "HTML did not round-trip formatted inline/block code: " +
        JSON.stringify({
          original,
          actual: snapshot.json,
          errors: await page.evaluate(() => window.__semloRequireFixture("codeFontErrors")),
        }),
    );
  await page.evaluate((json) => {
    window.__semloRequireFixture("codeFontApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("codeFontApi").setContent(json);
  }, original);
  if (
    JSON.stringify(
      (await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot().json)).content,
    ) !== JSON.stringify(original.content)
  )
    throw new Error("JSON did not round-trip formatted code");

  await page.evaluate(() =>
    window
      .__semloRequireFixture("codeFontApi")
      .setContent('<p>abc<code>def</code>ghi</p><pre><code class="language-javascript">const x = 1;</code></pre>'),
  );
  await prose.locator("p").first().click();
  const mixedSelection = await page.evaluate(() => {
    const p = document.querySelector("#code-font-test .semlo-editor-prose p"),
      c = document.querySelector("#code-font-test .semlo-editor-code-card code");
    const first = document.createTreeWalker(p!, NodeFilter.SHOW_TEXT).nextNode(),
      last = document.createTreeWalker(c!, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(first!, 0);
    range.setEnd(last!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await choose("Times New Roman");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot());
  const mixedParagraph = snapshot.json.content![0].content!,
    mixedBlock = snapshot.json.content!.find((node) => node.type === "codeBlock");
  const hasTimes = (node: import("@tiptap/core").JSONContent | undefined) =>
    node?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily?.includes("Times New Roman"));
  if (
    !mixedParagraph.every(hasTimes) ||
    !mixedParagraph.find((node) => node.text === "def")?.marks?.some((mark) => mark.type === "code") ||
    !hasTimes(mixedBlock!.content!.find((node) => node.text === "const")) ||
    hasTimes(mixedBlock!.content!.find((node) => node.text?.includes(" x = 1;")))
  )
    throw new Error("Mixed selection formatted the wrong code/text: " + JSON.stringify({ mixedSelection, snapshot }));
  await page.evaluate((html) => {
    window.__semloRequireFixture("codeFontApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("codeFontApi").setContent(html);
  }, snapshot.html);
  const restoredMixed = await page.evaluate(() => window.__semloRequireFixture("codeFontApi").getSnapshot().json);
  if (
    !restoredMixed.content![0].content!.every(hasTimes) ||
    !hasTimes(
      restoredMixed.content!.find((node) => node.type === "codeBlock")!.content!.find((node) => node.text === "const"),
    )
  )
    throw new Error("Mixed selection did not survive HTML roundtrip");

  const schema = await page.evaluate(() => {
    const { schema } = window.__semloRequireFixture("codeFontApi").editor;
    return {
      codeWithFont: !schema.marks.code.excludes(schema.marks.textStyle),
      codeWithBold: !schema.marks.code.excludes(schema.marks.bold),
      blockWithFont: schema.nodes.codeBlock.allowsMarkType(schema.marks.textStyle),
      blockWithBold: schema.nodes.codeBlock.allowsMarkType(schema.marks.bold),
    };
  });
  if (!schema.codeWithFont || !schema.codeWithBold || !schema.blockWithFont || schema.blockWithBold)
    throw new Error("Code mark permissions were changed unexpectedly: " + JSON.stringify(schema));

  // Simulate a text drag whose native selection arrives before ProseMirror's
  // selection transaction, while the previously selected image is still active.
  await page.evaluate(async () => {
    window.__semloRequireFixture("codeFontApi").destroy();
    document.querySelector("#code-font-test")!.remove();
    const { createEditor } = await import("/dist/index.js");
    const nodeHost = document.createElement("div");
    nodeHost.id = "node-font-test";
    nodeHost.style.marginTop = "160px";
    document.body.prepend(nodeHost);
    window.nodeFontApi = createEditor({
      element: nodeHost,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "天地玄黄宇宙" }] },
          ...Array.from({ length: 6 }, () => ({ type: "paragraph", content: [{ type: "text", text: "间隔" }] })),
          { type: "paragraph", content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "测试图" } }] },
        ],
      },
    });
    const editor = window.__semloRequireFixture("nodeFontApi").editor;
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") position = pos;
    });
    editor.commands.setNodeSelection(position!);
    editor.view.focus();
    window.originalNodeDispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (transaction) => {
      if (transaction.selectionSet && !transaction.docChanged) return;
      window.__semloRequireFixture("originalNodeDispatch")(transaction);
    };
  });
  const nodeHost = page.locator("#node-font-test"),
    paragraph = nodeHost.locator(".semlo-editor-prose p").first();
  await paragraph.scrollIntoViewIfNeeded();
  const coords = await paragraph.evaluate((el) => {
    const text = el.firstChild,
      first = document.createRange(),
      last = document.createRange();
    first.setStart(text!, 0);
    first.setEnd(text!, 1);
    last.setStart(text!, 3);
    last.setEnd(text!, 4);
    const a = first.getBoundingClientRect(),
      b = last.getBoundingClientRect();
    return { start: { x: a.left + 1, y: a.top + a.height / 2 }, end: { x: b.right - 1, y: b.top + b.height / 2 } };
  });
  await page.mouse.move(coords.start.x, coords.start.y);
  await page.mouse.down();
  await page.mouse.move(coords.end.x, coords.end.y, { steps: 12 });
  await page.mouse.up();
  const delayed = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nodeFontApi").editor;
    editor.view.dispatch = window.__semloRequireFixture("originalNodeDispatch");
    editor.view.focus();
    const p = document.querySelector("#node-font-test .semlo-editor-prose p"),
      text = document.createTreeWalker(p!, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const isNodeSelection = (
      value: import("@tiptap/pm/state").Selection,
    ): value is import("@tiptap/pm/state").NodeSelection => "node" in value;
    const pmSelection = editor.state.selection;
    const before = {
      node: isNodeSelection(pmSelection) ? pmSelection.node.type.name : undefined,
      selected: selection.toString(),
    };
    document.querySelector<HTMLElement>("#node-font-test .semlo-editor-font-family")!.click();
    return before;
  });
  if (delayed.node !== "image" || delayed.selected !== "天地玄黄")
    throw new Error("Could not reproduce delayed text selection after node selection: " + JSON.stringify(delayed));
  await menu.getByRole("option", { name: "Arial", exact: true }).click();
  const selectedText = await paragraph.locator('[data-semlo-editor-font-name="Arial"]').innerText();
  const nodeSnapshot = await page.evaluate(() => window.__semloRequireFixture("nodeFontApi").getSnapshot().json);
  if (
    selectedText !== "天地玄黄" ||
    nodeSnapshot.attrs?.semloEditorDocumentFontFamily ||
    !nodeSnapshot.content!.some((node) => node.content?.some((child) => child.type === "image"))
  )
    throw new Error("Text drag following node selection formatted the wrong content");

  // A later, normally synchronized drag must not leave a stale pointer marker
  // that can convert another node selection back into a text selection.
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nodeFontApi").editor;
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") position = pos;
    });
    editor.commands.setNodeSelection(position!);
    editor.view.focus();
  });
  await paragraph.scrollIntoViewIfNeeded();
  const again = await paragraph.evaluate((el) => {
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(),
      first = document.createRange(),
      last = document.createRange();
    first.setStart(text!, 0);
    first.setEnd(text!, 1);
    last.setStart(text!, 2);
    last.setEnd(text!, 3);
    const a = first.getBoundingClientRect(),
      b = last.getBoundingClientRect();
    return { start: { x: a.left + 1, y: a.top + a.height / 2 }, end: { x: b.right - 1, y: b.top + b.height / 2 } };
  });
  await page.mouse.move(again.start.x, again.start.y);
  await page.mouse.down();
  await page.mouse.move(again.end.x, again.end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const selection = window.__semloRequireFixture("nodeFontApi").editor.state.selection;
    return !("node" in selection) && !selection.empty;
  });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nodeFontApi").editor;
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") position = pos;
    });
    editor.commands.setNodeSelection(position!);
    editor.view.focus();
    window.originalNodeDispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (transaction) => {
      if (transaction.selectionSet && !transaction.docChanged) return;
      window.__semloRequireFixture("originalNodeDispatch")(transaction);
    };
    const p = document.querySelector("#node-font-test .semlo-editor-prose p"),
      text = document.createTreeWalker(p!, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(30);
  const stale = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nodeFontApi").editor;
    editor.view.dispatch = window.__semloRequireFixture("originalNodeDispatch");
    editor.view.focus();
    const p = document.querySelector("#node-font-test .semlo-editor-prose p"),
      text = document.createTreeWalker(p!, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const isNodeSelection = (
      value: import("@tiptap/pm/state").Selection,
    ): value is import("@tiptap/pm/state").NodeSelection => "node" in value;
    const pmSelection = editor.state.selection;
    const before = {
      node: isNodeSelection(pmSelection) ? pmSelection.node.type.name : undefined,
      selected: selection.toString(),
    };
    document.querySelector<HTMLElement>("#node-font-test .semlo-editor-font-family")!.click();
    return before;
  });
  if (stale.node !== "image" || stale.selected !== "天地")
    throw new Error("Could not reproduce stale native selection on a selected image: " + JSON.stringify(stale));
  await menu.getByText("请选择文字或将光标置于正文，再设置字体。").waitFor();
  if (!(await menu.getByRole("option", { name: "Arial", exact: true }).isDisabled()))
    throw new Error("A stale drag changed the selected image into a text selection");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__semloRequireFixture("nodeFontApi").destroy());
  if (errors.length) throw new Error(errors.join("; "));
  return {
    inlineCode: true,
    partialSelection: true,
    codeBlock: true,
    language: true,
    highlight: true,
    copy: true,
    undoRedo: true,
    jsonHtml: true,
    mixedSelection: true,
    otherMarksUnchanged: true,
    delayedTextDrag: true,
    staleDragCleared: true,
  };
}
