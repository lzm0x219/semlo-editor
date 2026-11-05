async function _browserTest(page: import("playwright").Page) {
  await page.goto(new URL("/", page.url()).href);
  return await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.append(host);
    const errors: string[] = [];
    const api = createEditor({ element: host, content: "<p>safe</p>", onError: (error) => errors.push(error.message) });
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "test.png", { type: "image/png" }));
    const target = host.querySelector(".semlo-editor-prose");
    const editableEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: 1,
      clientY: 1,
    });
    target!.dispatchEvent(editableEvent);
    api.setEditable(false);
    const readOnlyEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: 1,
      clientY: 1,
    });
    target!.dispatchEvent(readOnlyEvent);
    const result = {
      editablePrevented: editableEvent.defaultPrevented,
      readonlyPrevented: readOnlyEvent.defaultPrevented,
      message: errors[0],
      content: api.getSnapshot().text,
    };
    api.destroy();
    host.remove();
    if (
      !result.editablePrevented ||
      !result.readonlyPrevented ||
      result.message !== "请先配置图片上传" ||
      result.content !== "safe"
    )
      throw new Error(JSON.stringify(result));
    return result;
  });
}
