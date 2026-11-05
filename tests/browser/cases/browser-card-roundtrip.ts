async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const result = await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.append(host);
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            { type: "semloEditorStatus", attrs: { label: "进行中", color: 4 } },
            { type: "text", text: " " },
            { type: "semloEditorFormula", attrs: { id: "ftest", latex: "x^2" } },
            { type: "text", text: " " },
            {
              type: "semloEditorAttachment",
              attrs: { href: "https://example.com/file.txt", name: "文档.txt", size: 12, mimeType: "text/plain" },
            },
          ],
        },
        {
          type: "semloEditorColumns",
          content: [
            { type: "semloEditorColumn", content: [{ type: "paragraph", content: [{ type: "text", text: "左" }] }] },
            { type: "semloEditorColumn", content: [{ type: "paragraph", content: [{ type: "text", text: "右" }] }] },
          ],
        },
      ],
    };
    const api = createEditor({ element: host, content });
    const before = api.getSnapshot();
    if (!host.querySelector(".semlo-editor-formula .katex"))
      throw new Error("Formula did not render from initial content");
    if (
      !before.html.includes("data-semlo-editor-status") ||
      !before.html.includes('data-latex="x^2"') ||
      !before.html.includes("data-semlo-editor-attachment") ||
      !before.html.includes("data-semlo-editor-columns")
    )
      throw new Error("HTML serialization missing cards");
    api.setContent("<p>replacement</p>");
    api.setContent(before.html);
    const afterHTML = api.getSnapshot().json;
    const inline = afterHTML.content?.[0]?.content;
    if (!inline) throw new Error("HTML roundtrip lost the inline content");
    if (
      inline.find((n) => n.type === "semloEditorStatus")?.attrs?.label !== "进行中" ||
      inline.find((n) => n.type === "semloEditorStatus")?.attrs?.color !== 4
    )
      throw new Error("Status HTML roundtrip failed");
    if (
      inline.find((n) => n.type === "semloEditorFormula")?.attrs?.latex !== "x^2" ||
      inline.find((n) => n.type === "semloEditorAttachment")?.attrs?.name !== "文档.txt"
    )
      throw new Error("Inline card HTML roundtrip failed");
    if (afterHTML.content!.find((n) => n.type === "semloEditorColumns")?.content?.length !== 2)
      throw new Error("Column HTML roundtrip failed");
    api.setContent("<p>replacement</p>");
    api.setContent(before.json);
    if (api.getSnapshot().json.content!.find((n) => n.type === "semloEditorColumns")?.content?.length !== 2)
      throw new Error("JSON roundtrip failed");
    api.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "semloEditorAttachment", attrs: { href: "javascript:alert(1)", name: "untrusted" } }],
        },
      ],
    });
    if (api.getSnapshot().html.includes("javascript:")) throw new Error("Unsafe attachment URL serialized");
    api.destroy();
    host.remove();
    return { html: true, json: true, unsafeURLRejected: true };
  });
  if (errors.length) throw new Error(errors.join("; "));
  return result;
}
