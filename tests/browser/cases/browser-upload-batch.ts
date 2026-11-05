async function _browserTest(page: import("playwright").Page) {
  await page.goto(new URL("/", page.url()).href);
  return await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const wait = () => new Promise((resolve) => setTimeout(resolve, 35));
    const assert = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message);
    };
    const setup = () => {
      const host = document.createElement("div");
      document.body.append(host);
      const calls: Array<{ name: string; resolve: (url: string) => void; reject: (reason?: unknown) => void }> = [];
      const errors: string[] = [];
      const api = createEditor({
        element: host,
        content: "<p>alpha</p>",
        uploadImage: (file) => new Promise((resolve, reject) => calls.push({ name: file.name, resolve, reject })),
        onError: (error) => errors.push(error.message),
      });
      const transfer = (names: string[]) => {
        const data = new DataTransfer();
        for (const name of names) data.items.add(new File(["image"], name, { type: "image/png" }));
        return data;
      };
      const paste = (names: string[]) =>
        api.editor.view.dom.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer(names), bubbles: true, cancelable: true }),
        );
      const drop = (names: string[]) => {
        const rect = api.editor.view.dom.getBoundingClientRect();
        return api.editor.view.dom.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: transfer(names),
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 10,
            clientY: rect.top + 10,
          }),
        );
      };
      return { api, host, calls, errors, paste, drop };
    };
    const dispose = ({ api, host }: ReturnType<typeof setup>) => {
      api.destroy();
      host.remove();
    };

    // One failed file must not prevent later files from being inserted, and
    // document edits while awaiting uploads must not reverse their order.
    const batch = setup();
    batch.api.editor.commands.setTextSelection(3);
    batch.paste(["first.png", "invalid.png", "last.png"]);
    assert(
      batch.host.querySelectorAll(".semlo-editor-uploading").length === 3,
      "all batch placeholders should be visible",
    );
    assert(batch.calls.map((call) => call.name).join() === "first.png", "the first upload should start first");
    batch.api.editor.commands.insertContent("X");
    batch.calls[0].resolve("https://example.com/first.png");
    await wait();
    assert(batch.calls.map((call) => call.name).join() === "first.png,invalid.png", "second upload should start");
    batch.calls[1].resolve("javascript:invalid");
    await wait();
    assert(
      batch.calls.map((call) => call.name).join() === "first.png,invalid.png,last.png",
      "failure should not stop the batch",
    );
    batch.calls[2].resolve("https://example.com/last.png");
    await wait();
    // Inline atom nodes may have ProseMirror separator images between them;
    // count only the actual image node views.
    const images = Array.from(batch.host.querySelectorAll(".semlo-editor-image-frame > img")).map((image) =>
      image.getAttribute("alt"),
    );
    assert(images.join() === "first.png,last.png", `successful images must retain order: ${images}`);
    assert(
      batch.errors.length === 1 && batch.errors[0].includes("地址无效"),
      "one invalid URL should report one error",
    );
    assert(!batch.host.querySelector(".semlo-editor-uploading"), "finished batch should remove every placeholder");
    const html = batch.api.getSnapshot().html;
    assert(
      html.indexOf("alX") < html.indexOf("first.png") && html.indexOf("last.png") < html.indexOf("pha"),
      "images should stay at the original position after text edits",
    );
    dispose(batch);

    // Replacing the document cancels the entire old batch, including files
    // whose upload callbacks have not yet started.
    const replacement = setup();
    replacement.paste(["old-first.png", "old-second.png"]);
    replacement.api.setContent("<p>新的文档</p>");
    replacement.calls[0].resolve("https://example.com/old-first.png");
    await wait();
    assert(replacement.calls.length === 1, "document replacement must not start the next old upload");
    assert(!replacement.api.getSnapshot().html.includes("old-first.png"), "replacement must not receive old images");
    assert(!replacement.host.querySelector(".semlo-editor-uploading"), "replacement should clear old placeholders");
    assert(replacement.errors.length === 0, "cancelled upload should not report an error");
    dispose(replacement);

    // Drop uses the same batch path. Re-enabling editing does not revive an
    // upload that was cancelled while the editor was read-only.
    const readonly = setup();
    assert(readonly.drop(["drop-first.png", "drop-second.png"]) === false, "image drop should be handled");
    readonly.api.setEditable(false);
    readonly.api.setEditable(true);
    readonly.calls[0].reject(new Error("cancelled network request"));
    await wait();
    assert(readonly.calls.length === 1, "read-only cancellation must not start the next old upload");
    assert(!readonly.host.querySelector(".semlo-editor-uploading"), "read-only cancellation should clear placeholders");
    assert(readonly.errors.length === 0, "late failure from a cancelled upload should be ignored");
    dispose(readonly);

    // A host can also access the underlying editor directly. In that case the
    // queued placeholders must be removed without starting another upload.
    const directReadonly = setup();
    directReadonly.paste(["direct-first.png", "direct-second.png"]);
    directReadonly.api.editor.setEditable(false, false);
    directReadonly.calls[0].resolve("https://example.com/direct-first.png");
    await wait();
    assert(directReadonly.calls.length === 1, "direct read-only mode must not start the next upload");
    assert(
      !directReadonly.host.querySelector(".semlo-editor-uploading"),
      "direct read-only mode should remove queued placeholders",
    );
    assert(
      !directReadonly.api.getSnapshot().html.includes("direct-first.png"),
      "read-only editor should not insert the image",
    );
    dispose(directReadonly);

    const destroyed = setup();
    destroyed.paste(["destroy-first.png", "destroy-second.png"]);
    const pending = destroyed.calls[0];
    dispose(destroyed);
    pending.resolve("https://example.com/destroy-first.png");
    await wait();
    assert(destroyed.calls.length === 1, "destroy must not start another upload");
    assert(destroyed.errors.length === 0, "destroyed editor should ignore late results");

    return { ordered: images, failures: batch.errors.length, cancelled: true };
  });
}
