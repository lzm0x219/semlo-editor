async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "resize-test";
    host.style.width = "800px";
    document.body.prepend(host);
    window.resizeApi = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "semloEditorColumns",
            content: [
              {
                type: "semloEditorColumn",
                content: [{ type: "paragraph", content: [{ type: "text", text: "left" }] }],
              },
              {
                type: "semloEditorColumn",
                content: [{ type: "paragraph", content: [{ type: "text", text: "middle" }] }],
              },
              {
                type: "semloEditorColumn",
                content: [{ type: "paragraph", content: [{ type: "text", text: "right" }] }],
              },
            ],
          },
        ],
      },
    });
  });
  const host = page.locator("#resize-test"),
    columns = host.locator(".semlo-editor-column"),
    handle = host.getByRole("separator").first();
  await handle.waitFor();
  await page.waitForTimeout(80);
  const before = await columns.evaluateAll((es) => es.map((el) => el.getBoundingClientRect().width));
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await columns.evaluateAll((es) => es.map((el) => el.getBoundingClientRect().width));
  if (after[0] < before[0] + 75 || after[1] > before[1] - 75 || Math.abs(after[2] - before[2]) > 3)
    throw new Error("Drag did not resize only adjacent columns: " + JSON.stringify({ before, after }));
  const resized = await page.evaluate(() => window.__semloRequireFixture("resizeApi").getSnapshot());
  const saved = resized.json.content![0].attrs!.widths;
  if (!Array.isArray(saved) || saved[0] <= saved[1] || !resized.html.includes("data-widths"))
    throw new Error("Resized widths not serialized");
  await page.keyboard.press("Meta+z");
  let restored = await page.evaluate(
    () => window.__semloRequireFixture("resizeApi").getSnapshot().json.content![0].attrs!.widths,
  );
  if (restored !== null) throw new Error("Undo did not restore original widths: " + JSON.stringify(restored));
  await page.keyboard.press("Meta+Shift+z");
  restored = await page.evaluate(
    () => window.__semloRequireFixture("resizeApi").getSnapshot().json.content![0].attrs!.widths,
  );
  if (!restored || Math.abs(restored[0] - saved[0]) > 0.0001) throw new Error("Redo failed");
  await page.evaluate((html) => {
    window.__semloRequireFixture("resizeApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("resizeApi").setContent(html);
  }, resized.html);
  const fromHtml = await page.evaluate(
    () => window.__semloRequireFixture("resizeApi").getSnapshot().json.content![0].attrs!.widths,
  );
  if (!fromHtml || Math.abs(fromHtml[0] - saved[0]) > 0.0001) throw new Error("HTML width roundtrip failed");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const fromKey = await page.evaluate(
    () => window.__semloRequireFixture("resizeApi").getSnapshot().json.content![0].attrs!.widths,
  );
  if (fromKey[0] <= fromHtml[0]) throw new Error("Keyboard resize failed");
  await page.keyboard.press("Meta+z");
  const keyUndo = await page.evaluate(
    () => window.__semloRequireFixture("resizeApi").getSnapshot().json.content![0].attrs!.widths,
  );
  if (Math.abs(keyUndo[0] - fromHtml[0]) > 0.0001) throw new Error("Keyboard undo failed");
  await page.evaluate(() => window.__semloRequireFixture("resizeApi").setEditable(false));
  if (await handle.isVisible()) throw new Error("Resize handle shown in read-only mode");
  await page.evaluate(() => window.__semloRequireFixture("resizeApi").setEditable(true));
  if (!(await handle.isVisible())) throw new Error("Resize handle did not return");
  await page.evaluate(() => {
    window.__semloRequireFixture("resizeApi").destroy();
    document.querySelector("#resize-test")!.remove();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return { before, after, widths: saved, undoRedo: true, htmlRoundtrip: true, keyboard: true, readOnly: true };
}
