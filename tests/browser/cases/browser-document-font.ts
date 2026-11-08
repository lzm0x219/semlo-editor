async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const result = await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const { applyDocumentFont } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.prepend(host);
    const changes = [],
      reported: string[] = [];
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "甲乙",
              marks: [
                {
                  type: "textStyle",
                  attrs: { fontFamily: '"Arial"', semloEditorFontName: "Arial", fontSize: "22px", color: "#f5222d" },
                },
                { type: "bold" },
                { type: "link", attrs: { href: "https://example.com" } },
              ],
            },
            { type: "text", text: "丙丁" },
            { type: "text", text: "inline", marks: [{ type: "code" }] },
          ],
        },
        { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const a = 1" }] },
        { type: "paragraph" },
      ],
    };
    const api = createEditor({
      element: host,
      content,
      onChange: (snapshot) => changes.push(snapshot),
      onError: (error) => reported.push(error.message),
    });
    const root = host.querySelector<HTMLElement>(".semlo-editor-prose")!;
    const getTextStyle = () =>
      api
        .getSnapshot()
        .json.content![0].content!.find((node) => node.text === "甲乙")!
        .marks!.find((mark) => mark.type === "textStyle")!.attrs!;
    const fail = (message: string) => {
      throw new Error(message);
    };
    const getFont = () => api.getSnapshot().json.attrs!;
    const inlineCode = host.querySelector(".semlo-editor-prose p code"),
      blockCode = host.querySelector(".semlo-editor-prose .semlo-editor-code-card pre code");
    if (
      !inlineCode ||
      !blockCode ||
      !getComputedStyle(inlineCode).fontFamily.includes("monospace") ||
      !getComputedStyle(blockCode).fontFamily.includes("monospace")
    )
      fail("Default code did not use a monospace font");
    if (!applyDocumentFont(api.editor, "FZCaoQuanBeiLiShuS", "方正曹全碑隶书 简")) fail("Document font command failed");
    let snapshot = api.getSnapshot(),
      attrs = getTextStyle();
    if (
      getFont().semloEditorDocumentFontFamily !== "FZCaoQuanBeiLiShuS" ||
      getFont().semloEditorDocumentFontName !== "方正曹全碑隶书 简"
    )
      fail("Document font is not in JSON");
    if (!root.style.fontFamily.includes("FZCaoQuanBeiLiShuS") || root.dataset.semloEditorDocumentFontActive !== "true")
      fail("Document font is not on editor root");
    if (
      !getComputedStyle(host.querySelector(".semlo-editor-prose p code")!).fontFamily.includes("FZCaoQuanBeiLiShuS") ||
      !getComputedStyle(
        host.querySelector(".semlo-editor-prose .semlo-editor-code-card pre code")!,
      ).fontFamily.includes("FZCaoQuanBeiLiShuS")
    )
      fail("Code content did not inherit the document font");
    if (
      !document
        .getElementById(host.querySelector(".semlo-editor-toolbar-more")!.getAttribute("aria-controls")!)!
        .querySelector(".semlo-editor-font-family")!
        .textContent!.includes("方正曹全碑隶书 简")
    )
      fail("Toolbar did not show the document font");
    if (
      attrs.fontFamily ||
      attrs.semloEditorFontName ||
      attrs.fontSize !== "22px" ||
      !attrs.color ||
      !snapshot.html.includes("<strong>") ||
      !snapshot.html.includes("href=")
    )
      fail("Whole-document change lost or retained inline attributes incorrectly");
    if (
      !snapshot.html.includes('data-semlo-editor-document-font="FZCaoQuanBeiLiShuS"') ||
      !snapshot.html.includes('data-semlo-editor-document-font-name="方正曹全碑隶书 简"')
    )
      fail("HTML is missing document font metadata");
    const frame = document.createElement("iframe");
    await new Promise((resolve) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.srcdoc = "<!doctype html><html><body>" + snapshot.html + "</body></html>";
      document.body.append(frame);
    });
    const standaloneInline = frame.contentDocument!.querySelector("p code"),
      standaloneBlock = frame.contentDocument!.querySelector("pre code");
    if (
      !standaloneInline ||
      !standaloneBlock ||
      !frame.contentWindow!.getComputedStyle(standaloneInline).fontFamily.includes("FZCaoQuanBeiLiShuS") ||
      !frame.contentWindow!.getComputedStyle(standaloneBlock).fontFamily.includes("FZCaoQuanBeiLiShuS")
    )
      fail("Standalone HTML code did not inherit the document font");
    frame.remove();
    if (changes.length !== 1) fail("Document font change did not produce exactly one update");
    if (!api.editor.commands.undo()) fail("Cannot undo document font");
    if (getFont().semloEditorDocumentFontFamily || getTextStyle().fontFamily !== '"Arial"')
      fail("Undo did not restore document and inline font in one action");
    if (!api.editor.commands.redo()) fail("Cannot redo document font");
    if (getFont().semloEditorDocumentFontFamily !== "FZCaoQuanBeiLiShuS" || getTextStyle().fontFamily)
      fail("Redo did not restore whole-document font");
    snapshot = api.getSnapshot();
    const baseChanges = changes.length;
    api.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "旧内容" }] }] });
    if (getFont().semloEditorDocumentFontFamily || root.style.fontFamily)
      fail("setContent did not clear old document font");
    api.setContent(snapshot.json);
    if (
      getFont().semloEditorDocumentFontFamily !== "FZCaoQuanBeiLiShuS" ||
      !root.style.fontFamily.includes("FZCaoQuanBeiLiShuS")
    )
      fail("JSON setContent lost the document font");
    if (changes.length !== baseChanges) fail("setContent emitted onChange");
    const sameContent = JSON.parse(JSON.stringify(snapshot.json));
    sameContent.attrs.semloEditorDocumentFontFamily = "Times New Roman";
    sameContent.attrs.semloEditorDocumentFontName = "Times";
    api.editor.commands.setTextSelection(2);
    api.setContent(sameContent);
    if (getFont().semloEditorDocumentFontFamily !== "Times New Roman" || api.editor.state.selection.from !== 2)
      fail("Attribute-only setContent lost the value or selection");
    if (changes.length !== baseChanges) fail("Attribute-only setContent emitted onChange");
    api.setContent(snapshot.html);
    if (
      getFont().semloEditorDocumentFontFamily !== "FZCaoQuanBeiLiShuS" ||
      !root.style.fontFamily.includes("FZCaoQuanBeiLiShuS")
    )
      fail("HTML setContent lost the document font");
    const before = JSON.stringify(api.getSnapshot().json);
    api.setContent('<div data-semlo-editor-document-font="Arial"><p><unknown-element>bad</unknown-element></p></div>');
    if (JSON.stringify(api.getSnapshot().json) !== before || !reported.some((text) => text.includes("Invalid HTML")))
      fail("Unknown nested HTML was accepted");
    api.setContent('<div data-semlo-editor-document-font="Bad; color:red"><p>bad</p></div>');
    if (
      JSON.stringify(api.getSnapshot().json) !== before ||
      !reported.some((text) => text.includes("Invalid document font"))
    )
      fail("Unsafe font was accepted");
    const htmlHost = document.createElement("div"),
      jsonHost = document.createElement("div");
    document.body.append(htmlHost, jsonHost);
    let initialUpdates = 0;
    const fromHtml = createEditor({ element: htmlHost, content: snapshot.html, onChange: () => initialUpdates++ });
    const fromJson = createEditor({ element: jsonHost, content: snapshot.json, onChange: () => initialUpdates++ });
    for (const instance of [fromHtml, fromJson]) {
      if (
        instance.getSnapshot().json.attrs!.semloEditorDocumentFontFamily !== "FZCaoQuanBeiLiShuS" ||
        !instance.editor.view.dom.style.fontFamily.includes("FZCaoQuanBeiLiShuS")
      )
        fail("Initial content lost document font");
    }
    const htmlJson = fromHtml.getSnapshot().json;
    const importedInline = htmlJson.content![0].content!.find((node) => node.text === "inline");
    if (
      !importedInline?.marks?.some((mark) => mark.type === "code") ||
      importedInline.marks.some((mark) => mark.type === "textStyle")
    )
      fail("Inline code marks changed after HTML roundtrip");
    if (
      JSON.stringify(htmlJson.content!.find((node) => node.type === "codeBlock")) !==
      JSON.stringify(snapshot.json.content!.find((node) => node.type === "codeBlock"))
    )
      fail("Code block changed after HTML roundtrip");
    if (initialUpdates) fail("Initialization emitted onChange");
    const quoted = 'Font "Quoted" \\ Example';
    if (!applyDocumentFont(api.editor, quoted, quoted)) fail("Valid escaped family was rejected");
    const quotedHtml = api.getSnapshot().html;
    api.setContent(snapshot.json);
    api.setContent(quotedHtml);
    if (getFont().semloEditorDocumentFontFamily !== quoted || getFont().semloEditorDocumentFontName !== quoted)
      fail("Quoted family did not survive HTML roundtrip");
    api.editor.commands.setTextSelection({ from: 1, to: 3 });
    api.editor.commands.setFontFamily("Arial");
    if (!applyDocumentFont(api.editor, null, null)) fail("Default document font command failed");
    if (
      getFont().semloEditorDocumentFontFamily ||
      getFont().semloEditorDocumentFontName ||
      root.style.fontFamily ||
      getTextStyle().fontFamily
    )
      fail("Default font did not clear document and inline overrides");
    if (!getTextStyle().fontSize || !getTextStyle().color) fail("Default font erased other inline styles");
    if (
      !getComputedStyle(host.querySelector(".semlo-editor-prose p code")!).fontFamily.includes("monospace") ||
      !getComputedStyle(
        host.querySelector(".semlo-editor-prose .semlo-editor-code-card pre code")!,
      ).fontFamily.includes("monospace")
    )
      fail("Default font did not restore monospace code");
    api.setContent(snapshot.json);
    let emptyParagraph;
    api.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && !node.content.size) emptyParagraph = pos + 1;
    });
    api.editor.commands.setTextSelection(emptyParagraph!);
    api.editor.commands.insertContent("空段落后续输入");
    const lastParagraph = Array.from(root.querySelectorAll("p")).find((p) => p.textContent === "空段落后续输入");
    if (!lastParagraph || !getComputedStyle(lastParagraph).fontFamily.includes("FZCaoQuanBeiLiShuS"))
      fail("Text inserted in an empty paragraph did not inherit the document font");
    const historyHost = document.createElement("div");
    document.body.append(historyHost);
    const history = createEditor({ element: historyHost, content: "<p>one</p>" });
    history.editor.commands.setTextSelection(4);
    history.editor.commands.insertContent("T");
    if (!applyDocumentFont(history.editor, "Arial", "Arial")) fail("Document font command failed after typing");
    if (
      !history.editor.commands.undo() ||
      history.getSnapshot().text !== "oneT" ||
      history.getSnapshot().json.attrs!.semloEditorDocumentFontFamily
    )
      fail("First undo should remove only the document font");
    if (!history.editor.commands.undo() || history.getSnapshot().text !== "one")
      fail("Second undo should remove the earlier typing");
    if (
      !history.editor.commands.redo() ||
      history.getSnapshot().text !== "oneT" ||
      history.getSnapshot().json.attrs!.semloEditorDocumentFontFamily
    )
      fail("First redo should restore only the earlier typing");
    if (
      !history.editor.commands.redo() ||
      history.getSnapshot().text !== "oneT" ||
      history.getSnapshot().json.attrs!.semloEditorDocumentFontFamily !== "Arial"
    )
      fail("Second redo should restore the document font");
    history.destroy();
    const followingHost = document.createElement("div");
    document.body.append(followingHost);
    const following = createEditor({ element: followingHost, content: "<p>one</p>" });
    following.editor.commands.setTextSelection(4);
    if (!applyDocumentFont(following.editor, "Arial", "Arial")) fail("Document font command failed before typing");
    following.editor.commands.insertContent("T");
    if (
      !following.editor.commands.undo() ||
      following.getSnapshot().text !== "one" ||
      following.getSnapshot().json.attrs!.semloEditorDocumentFontFamily !== "Arial"
    )
      fail("First undo should remove only the subsequent typing");
    if (
      !following.editor.commands.undo() ||
      following.getSnapshot().text !== "one" ||
      following.getSnapshot().json.attrs!.semloEditorDocumentFontFamily
    )
      fail("Second undo should remove only the document font");
    if (
      !following.editor.commands.redo() ||
      following.getSnapshot().text !== "one" ||
      following.getSnapshot().json.attrs!.semloEditorDocumentFontFamily !== "Arial"
    )
      fail("First redo should restore only the document font");
    if (
      !following.editor.commands.redo() ||
      following.getSnapshot().text !== "oneT" ||
      following.getSnapshot().json.attrs!.semloEditorDocumentFontFamily !== "Arial"
    )
      fail("Second redo should restore the subsequent typing");
    following.destroy();
    fromHtml.destroy();
    fromJson.destroy();
    return {
      undoRedo: true,
      separateFontHistory: true,
      separateSubsequentTyping: true,
      otherStyles: true,
      jsonHtml: true,
      initialContent: true,
      controlledUpdate: true,
      invalidHtmlAndCss: true,
      escapedNames: true,
      defaultFont: true,
      codeInheritance: true,
      standaloneHtmlCode: true,
      emptyParagraph: true,
    };
  });
  if (errors.length) throw new Error(errors.join("; "));
  return result;
}
