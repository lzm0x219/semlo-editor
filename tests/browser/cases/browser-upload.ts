async function _browserTest(page: import("playwright").Page) {
  await page.goto(new URL("/", page.url()).href);
  return await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const wait = () => new Promise((resolve) => setTimeout(resolve, 35));
    const host = document.createElement("div");
    document.body.append(host);
    const pending: Array<{ file: File; resolve: (url: string) => void }> = [];
    const errors: string[] = [];
    const api = createEditor({
      element: host,
      content: "<p>alpha</p>",
      uploadImage: (file) => new Promise((resolve) => pending.push({ file, resolve })),
      onError: (error) => errors.push(error.message),
    });
    const paste = (name: string) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["image"], name, { type: "image/png" }));
      return api.editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    };
    const result: Partial<{
      placeholder: boolean;
      firstHtml: string;
      firstHasImage: boolean;
      firstNoPlaceholder: boolean;
      equivalentKeepsUpload: boolean;
      equivalentInserted: boolean;
      newDocument: string;
      noStaleImage: boolean;
      readonlyNoImage: boolean;
      reenabledNoStaleImage: boolean;
      destroyed: boolean;
    }> = {};
    api.editor.commands.setTextSelection(3);
    paste("first.png");
    result.placeholder = !!host.querySelector(".semlo-editor-uploading");
    api.editor.commands.insertContent("X");
    pending.shift()!.resolve("https://example.com/first.png");
    await wait();
    result.firstHtml = api.getSnapshot().html;
    result.firstHasImage = result.firstHtml.includes("https://example.com/first.png");
    result.firstNoPlaceholder = !host.querySelector(".semlo-editor-uploading");
    api.editor.commands.setTextSelection(2);
    paste("same.png");
    const equivalent = api.getSnapshot().json;
    api.setContent(JSON.parse(JSON.stringify(equivalent)));
    result.equivalentKeepsUpload = !!host.querySelector(".semlo-editor-uploading");
    pending.shift()!.resolve("https://example.com/same.png");
    await wait();
    result.equivalentInserted = api.getSnapshot().html.includes("same.png");
    api.editor.commands.setTextSelection(2);
    paste("second.png");
    api.setContent("<p>新的文档</p>");
    pending.shift()!.resolve("https://example.com/second.png");
    await wait();
    result.newDocument = api.getSnapshot().html;
    result.noStaleImage = !result.newDocument.includes("second.png");
    api.editor.commands.setTextSelection(2);
    paste("third.png");
    api.setEditable(false);
    pending.shift()!.resolve("https://example.com/third.png");
    await wait();
    result.readonlyNoImage = !api.getSnapshot().html.includes("third.png");
    api.setEditable(true);
    paste("return.png");
    api.setEditable(false);
    api.setEditable(true);
    pending.shift()!.resolve("https://example.com/return.png");
    await wait();
    result.reenabledNoStaleImage = !api.getSnapshot().html.includes("return.png");
    paste("fourth.png");
    const final = pending.shift()!;
    api.destroy();
    host.remove();
    final.resolve("https://example.com/fourth.png");
    await wait();
    result.destroyed = api.editor.isDestroyed;
    if (
      !result.placeholder ||
      !result.firstHasImage ||
      !result.firstNoPlaceholder ||
      !result.equivalentKeepsUpload ||
      !result.equivalentInserted ||
      !result.noStaleImage ||
      !result.readonlyNoImage ||
      !result.reenabledNoStaleImage ||
      !result.destroyed
    )
      throw new Error(JSON.stringify(result));
    return result;
  });
}
