async function _browserTest(page: import("playwright").Page) {
  await page.goto(new URL("/", page.url()).href);
  return await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const wait = () => new Promise((resolve) => setTimeout(resolve, 35));
    const host = document.createElement("div");
    document.body.append(host);
    const pending: Array<{ file: File; resolve: (url: string) => void }> = [],
      errors: string[] = [];
    const api = createEditor({
      element: host,
      content: "<p>alpha</p>",
      uploadAttachment: (file) => new Promise((resolve) => pending.push({ file, resolve })),
      onError: (error) => errors.push(error.message),
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    const send = (names: string[]) => {
      const transfer = new DataTransfer();
      names.forEach((name) => transfer.items.add(new File(["data"], name, { type: "text/plain" })));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    api.editor.commands.setTextSelection(3);
    send(["first.txt"]);
    api.editor.commands.insertContent("X");
    if (!host.querySelector(".semlo-editor-uploading")) throw new Error("Upload placeholder missing");
    pending.shift()!.resolve("https://example.com/first.txt");
    await wait();
    const first = api.getSnapshot().html;
    if (!first.includes("first.txt") || !first.includes("X") || host.querySelector(".semlo-editor-uploading"))
      throw new Error("Attachment did not follow the selection");
    api.editor.commands.setTextSelection(2);
    send(["old.txt"]);
    api.setContent("<p>new document</p>");
    pending.shift()!.resolve("https://example.com/old.txt");
    await wait();
    if (api.getSnapshot().html.includes("old.txt")) throw new Error("Replaced document received stale upload");
    api.editor.commands.setTextSelection(2);
    send(["readonly.txt"]);
    api.setEditable(false);
    pending.shift()!.resolve("https://example.com/readonly.txt");
    await wait();
    if (api.getSnapshot().html.includes("readonly.txt")) throw new Error("Read-only document received stale upload");
    api.setEditable(true);
    api.editor.commands.setTextSelection(2);
    send(["a.txt", "b.txt"]);
    pending.shift()!.resolve("https://example.com/a.txt");
    await wait();
    pending.shift()!.resolve("https://example.com/b.txt");
    await wait();
    const multiple = api.getSnapshot().html;
    if (multiple.indexOf("a.txt") < 0 || multiple.indexOf("b.txt") <= multiple.indexOf("a.txt"))
      throw new Error("Multiple attachments lost their order");
    send(["bad.txt"]);
    pending.shift()!.resolve("javascript:alert(1)");
    await wait();
    if (!errors.some((message) => message.includes("地址无效")) || api.getSnapshot().html.includes("javascript:"))
      throw new Error("Unsafe upload URL accepted");
    send(["destroy.txt"]);
    const last = pending.shift()!;
    api.destroy();
    host.remove();
    last.resolve("https://example.com/destroy.txt");
    await wait();
    return { mapped: true, replacement: true, readOnly: true, multiple: true, unsafeURLRejected: true, destroy: true };
  });
}
