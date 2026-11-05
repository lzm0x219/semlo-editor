async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          window.imageClipboard = items;
        },
      },
    });
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "image-test";
    host.style.width = "800px";
    document.body.prepend(host);
    window.imageApi = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "before" }] },
          {
            type: "paragraph",
            content: [
              { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "测试图", width: 480, height: 208 } },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      },
    });
  });
  const host = page.locator("#image-test"),
    image = host.locator(".semlo-editor-image-frame img");
  await image.waitFor();
  await image.click();
  const handle = host.getByRole("button", { name: "调整图片大小（右下）" });
  if (!(await handle.isVisible())) throw new Error("Image selection controls not visible");
  const before = await image.boundingBox(),
    box = await handle.boundingBox();
  if (!before || !box) throw new Error("Image resize controls are not visible");
  const beforeClick = await page.evaluate(() =>
    JSON.stringify(window.__semloRequireFixture("imageApi").getSnapshot().json),
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  if (
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("imageApi").getSnapshot().json))) !==
    beforeClick
  )
    throw new Error("Clicking a resize handle changed the document");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 43, { steps: 8 });
  await page.mouse.up();
  const after = await image.boundingBox();
  if (!after) throw new Error("Resized image is not visible");
  if (after.width > before.width - 75 || Math.abs(after.width / after.height - before.width / before.height) > 0.04)
    throw new Error("Image resize or aspect ratio incorrect: " + JSON.stringify({ before, after }));
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("imageApi").getSnapshot());
  const attrs = snapshot.json.content
    ?.flatMap((node) => node.content ?? [])
    .find((node) => node.type === "image")?.attrs;
  if (!attrs) throw new Error("Image attributes are missing from the editor snapshot");
  if (!attrs.width || !attrs.height || !snapshot.html.includes(`width="${attrs.width}"`))
    throw new Error("Image dimensions not persisted");
  await page.keyboard.press("Meta+z");
  let current = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("imageApi")
        .getSnapshot()
        .json.content!.flatMap((node) => node.content ?? [])
        .find((node) => node.type === "image")!.attrs!,
  );
  if (current.width !== 480) throw new Error("Resize undo failed");
  await page.keyboard.press("Meta+Shift+z");
  current = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("imageApi")
        .getSnapshot()
        .json.content!.flatMap((node) => node.content ?? [])
        .find((node) => node.type === "image")!.attrs!,
  );
  if (current.width !== attrs.width) throw new Error("Resize redo failed");
  await image.click();
  await host.getByRole("button", { name: "图片更多操作" }).click();
  await host.getByRole("menuitem", { name: "复制图片" }).click();
  const copied = await page.evaluate(async () => ({
    types: window.imageClipboard?.[0]?.types,
    html: await (await window.__semloRequireFixture("imageClipboard")[0].getType("text/html")).text(),
  }));
  if (!copied.types?.includes("text/html") || !copied.html.includes("/tests/sample-image.svg"))
    throw new Error("Image clipboard payload missing");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.imageText = value;
        },
      },
    }),
  );
  await host.getByRole("button", { name: "图片更多操作" }).click();
  await host.getByRole("menuitem", { name: "复制图片" }).click();
  if (
    (await page.evaluate(() => window.__semloRequireFixture("imageText"))) !== "/tests/sample-image.svg" ||
    !(await host.getByText("已复制图片地址").count())
  )
    throw new Error("Image address fallback failed");
  await host.getByRole("button", { name: "删除图片" }).click();
  if (await image.count()) throw new Error("Image delete failed");
  await page.keyboard.press("Meta+z");
  if (!(await image.count())) throw new Error("Image delete undo failed");
  await page.evaluate((html) => {
    window.__semloRequireFixture("imageApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("imageApi").setContent(html);
  }, snapshot.html);
  current = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("imageApi")
        .getSnapshot()
        .json.content!.flatMap((node) => node.content ?? [])
        .find((node) => node.type === "image")!.attrs!,
  );
  if (Number(current.width) !== attrs.width || Number(current.height) !== attrs.height)
    throw new Error("Image HTML roundtrip failed");
  await image.click();
  await page.evaluate(() => window.__semloRequireFixture("imageApi").setEditable(false));
  if (await host.getByRole("button", { name: "删除图片" }).count()) throw new Error("Read-only image actions visible");
  await page.evaluate(() => {
    window.__semloRequireFixture("imageApi").destroy();
    document.querySelector("#image-test")!.remove();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return {
    beforeWidth: before.width,
    afterWidth: after.width,
    attrs,
    undoRedo: true,
    noOpClick: true,
    copyHTML: true,
    copyFallback: true,
    deleteUndo: true,
    htmlRoundtrip: true,
    readOnly: true,
  };
}
