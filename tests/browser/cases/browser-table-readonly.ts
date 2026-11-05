async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const content =
      "<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table><p>tail</p>";
    window.tableTests = {};
    for (const [id, editable] of [
      ["normal", true],
      ["toggled", false],
      ["cancel", true],
      ["destroy", true],
    ] as const) {
      const host = document.createElement("div");
      host.id = `table-${id}`;
      host.style.width = "700px";
      document.body.prepend(host);
      window.__semloRequireFixture("tableTests")[id] = createEditor({ element: host, editable, content });
    }
    const add = window.addEventListener,
      remove = window.removeEventListener;
    const active = new Set<EventListenerOrEventListenerObject | null>();
    window.tableListenerTrace = {
      start() {
        active.clear();
        this.enabled = true;
      },
      stop() {
        this.enabled = false;
        return active.size;
      },
      restore() {
        window.addEventListener = add;
        window.removeEventListener = remove;
      },
      enabled: false,
    };
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (window.__semloRequireFixture("tableListenerTrace").enabled && (type === "mousemove" || type === "mouseup"))
        active.add(listener);
      return add.call(this, type, listener!, options);
    };
    window.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "mousemove" || type === "mouseup") active.delete(listener);
      return remove.call(this, type, listener!, options);
    };
  });
  const snapshot = (id: string) => page.evaluate((name) => window.__semloRequireTableEditor(name).getSnapshot(), id);
  const columnWidth = (snap: import("../../../packages/core/src/types").EditorSnapshot) =>
    snap.json.content![0].content!.map((row) => row.content![0].attrs!.colwidth);
  const hover = async (id: string) => {
    const host = page.locator(`#table-${id}`),
      cell = host.locator("td").first();
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    if (!box) throw new Error(`${id}: table cell is not visible`);
    const x = box.x + box.width - 1,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    return { host, x, y };
  };
  const drag = async (id: string, distance = 65) => {
    const { host, x, y } = await hover(id);
    if (!(await host.locator(".column-resize-handle").count())) throw new Error(`${id}: resize handle missing`);
    await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 5 });
    await page.mouse.up();
  };
  const styles = (id: string) =>
    page.locator(`#table-${id} table`).evaluate((table) => ({
      cols: [...table.querySelectorAll(":scope > colgroup > col")].map((col) => col.getAttribute("style")),
      width: table.style.width,
      minWidth: table.style.minWidth,
    }));
  try {
    for (const id of ["normal", "toggled"]) {
      const count = await page.evaluate(
        (name) =>
          window
            .__semloRequireTableEditor(name)
            .editor.state.plugins.filter(
              (plugin) =>
                "key" in plugin && typeof plugin.key === "string" && plugin.key.startsWith("tableColumnResizing$"),
            ).length,
        id,
      );
      if (count !== 1) throw new Error(`${id}: expected one column-resizing plugin, got ${count}`);
    }
    await drag("normal");
    if (!columnWidth(await snapshot("normal"))[0]) throw new Error("Initially editable table did not resize");
    const beforeSecondResize = await snapshot("normal");
    await drag("normal", 45);
    const afterSecondResize = await snapshot("normal");
    await page.locator("#table-normal td p").first().click();
    await page.keyboard.type("X");
    const afterTyping = await snapshot("normal");
    if (JSON.stringify(afterTyping.json) === JSON.stringify(afterSecondResize.json))
      throw new Error("Typing after table resize failed");
    await page.keyboard.press("Meta+z");
    if (JSON.stringify((await snapshot("normal")).json) !== JSON.stringify(afterSecondResize.json))
      throw new Error("Undo combined typing with a preceding resize");
    await page.keyboard.press("Meta+z");
    if (JSON.stringify((await snapshot("normal")).json) !== JSON.stringify(beforeSecondResize.json))
      throw new Error("Undo did not isolate the resize");
    await page.keyboard.press("Meta+Shift+z");
    await page.keyboard.press("Meta+Shift+z");
    if (JSON.stringify((await snapshot("normal")).json) !== JSON.stringify(afterTyping.json))
      throw new Error("Redo lost a resize or subsequent typing");
    await page.evaluate(() => window.__semloRequireTableEditor("toggled").setEditable(true));
    const initial = await snapshot("toggled");
    const initialStyles = await styles("toggled");
    await drag("toggled");
    const saved = await snapshot("toggled"),
      widths = columnWidth(saved);
    if (!widths[0]?.[0] || widths[0][0] !== widths[1]?.[0] || !saved.html.includes(`colwidth="${widths[0][0]}"`)) {
      throw new Error("Resized column widths were not saved to JSON and HTML: " + JSON.stringify(widths));
    }
    await page.evaluate(() => window.__semloRequireTableEditor("toggled").editor.commands.undo());
    if (JSON.stringify(columnWidth(await snapshot("toggled"))) !== JSON.stringify(columnWidth(initial)))
      throw new Error("Undo did not restore original table widths");
    if (JSON.stringify(await styles("toggled")) !== JSON.stringify(initialStyles))
      throw new Error("Undo did not restore table width on screen");
    await page.evaluate(() => window.__semloRequireTableEditor("toggled").editor.commands.redo());
    if (JSON.stringify(columnWidth(await snapshot("toggled"))) !== JSON.stringify(widths))
      throw new Error("Redo did not restore resized table widths");
    await page.evaluate((html) => {
      const api = window.__semloRequireTableEditor("toggled");
      api.setContent("<p>reset</p>");
      api.setContent(html);
    }, saved.html);
    if (JSON.stringify(columnWidth(await snapshot("toggled"))) !== JSON.stringify(widths))
      throw new Error("HTML table-width round trip failed");
    await page.evaluate((json) => {
      const api = window.__semloRequireTableEditor("toggled");
      api.setContent("<p>reset</p>");
      api.setContent(json);
    }, saved.json);
    if (JSON.stringify(columnWidth(await snapshot("toggled"))) !== JSON.stringify(widths))
      throw new Error("JSON table-width round trip failed");

    const selected = await page.evaluate(() => {
      const editor = window.__semloRequireTableEditor("toggled").editor,
        positions: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") positions.push(position);
      });
      return editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    });
    if (!selected) throw new Error("Table cell selection is unavailable");
    await page.locator("#table-toggled td").first().click({ button: "right" });
    if ((await page.locator("#table-toggled .selectedCell").count()) !== 2)
      throw new Error("Context menu lost the selected cells");
    const merged = await page.evaluate(() => window.__semloRequireTableEditor("toggled").editor.commands.mergeCells());
    if (!merged) throw new Error("Merging selected cells failed");
    const mergedSnapshot = await snapshot("toggled");
    if (!mergedSnapshot.html.includes('colspan="2"')) throw new Error("Merged cell was not serialized");
    await page.evaluate((html) => {
      const api = window.__semloRequireTableEditor("toggled");
      api.setContent("<p>reset</p>");
      api.setContent(html);
    }, mergedSnapshot.html);
    const mergedRoundtrip = await snapshot("toggled");
    if (JSON.stringify(mergedRoundtrip.json.content![0]) !== JSON.stringify(mergedSnapshot.json.content![0]))
      throw new Error("Merged table HTML round trip lost its structure or widths");
    await drag("toggled", 45);
    const mergedResized = await snapshot("toggled");
    const mergedWidth = mergedResized.json.content![0].content![0].content![0].attrs!.colwidth;
    const nextRowWidth = mergedResized.json.content![0].content![1].content![1].attrs!.colwidth;
    if (!mergedWidth?.[1] || mergedWidth[1] !== nextRowWidth?.[0])
      throw new Error("Resizing a merged cell did not update the matching column");
    await page.evaluate(() => window.__semloRequireTableEditor("toggled").editor.commands.undo());
    if (JSON.stringify((await snapshot("toggled")).json) !== JSON.stringify(mergedRoundtrip.json))
      throw new Error("Undo after merged-cell resize failed");
    await page.evaluate(() => window.__semloRequireTableEditor("toggled").editor.commands.redo());
    if (JSON.stringify((await snapshot("toggled")).json) !== JSON.stringify(mergedResized.json))
      throw new Error("Redo after merged-cell resize failed");
    await page.evaluate(() => window.__semloRequireTableEditor("toggled").editor.commands.undo());
    for (const invalid of [
      "<p><unknown-element>bad</unknown-element></p>",
      "<table><tbody><tr><td><p><unknown-element>bad</unknown-element></p></td></tr></tbody></table>",
    ]) {
      await page.evaluate((html) => window.__semloRequireTableEditor("toggled").setContent(html), invalid);
      if (JSON.stringify((await snapshot("toggled")).json) !== JSON.stringify(mergedRoundtrip.json))
        throw new Error("Unknown HTML tag was accepted");
      if (!(await page.locator('#table-toggled [role="alert"]').isVisible()))
        throw new Error("Invalid HTML did not report an error");
    }

    // An unfinished drag must leave neither saved widths nor preview styles behind.
    const untouched = await snapshot("cancel"),
      originalStyles = await styles("cancel");
    const start = await hover("cancel");
    await page.evaluate(() => window.__semloRequireFixture("tableListenerTrace").start());
    await page.mouse.down();
    await page.mouse.move(start.x + 95, start.y, { steps: 5 });
    if (JSON.stringify(await styles("cancel")) === JSON.stringify(originalStyles))
      throw new Error("Drag preview did not change the table");
    await page.evaluate(() => window.__semloRequireTableEditor("cancel").setEditable(false));
    if (await page.evaluate(() => window.__semloRequireFixture("tableListenerTrace").stop()))
      throw new Error("Read-only transition left drag listeners attached");
    if (JSON.stringify(await styles("cancel")) !== JSON.stringify(originalStyles))
      throw new Error("Read-only transition left a stale width preview");
    await page.mouse.up();
    if (JSON.stringify((await snapshot("cancel")).json) !== JSON.stringify(untouched.json))
      throw new Error("Cancelled drag changed table content");
    const readonly = await hover("cancel");
    if (await readonly.host.locator(".column-resize-handle").count())
      throw new Error("Read-only table exposes resize handles");
    await page.mouse.down();
    await page.mouse.move(readonly.x + 65, readonly.y, { steps: 5 });
    await page.mouse.up();
    if (JSON.stringify((await snapshot("cancel")).json) !== JSON.stringify(untouched.json))
      throw new Error("Read-only table resized");
    await page.evaluate(() => window.__semloRequireTableEditor("cancel").setEditable(true));
    await drag("cancel");
    if (!columnWidth(await snapshot("cancel"))[0]) throw new Error("Table did not resize after re-enabling editing");

    // Direct access to the underlying editor must also cancel an active drag.
    const beforeDirect = await snapshot("cancel"),
      beforeDirectStyles = await styles("cancel");
    const direct = await hover("cancel");
    await page.evaluate(() => window.__semloRequireFixture("tableListenerTrace").start());
    await page.mouse.down();
    await page.mouse.move(direct.x + 75, direct.y, { steps: 4 });
    await page.evaluate(() => window.__semloRequireTableEditor("cancel").editor.setEditable(false, false));
    if (await page.evaluate(() => window.__semloRequireFixture("tableListenerTrace").stop()))
      throw new Error("Direct read-only transition left drag listeners attached");
    await page.mouse.up();
    if (
      JSON.stringify((await snapshot("cancel")).json) !== JSON.stringify(beforeDirect.json) ||
      JSON.stringify(await styles("cancel")) !== JSON.stringify(beforeDirectStyles)
    )
      throw new Error("Direct read-only transition failed to cancel preview");

    const doomed = await hover("destroy");
    await page.evaluate(() => window.__semloRequireFixture("tableListenerTrace").start());
    await page.mouse.down();
    await page.mouse.move(doomed.x + 60, doomed.y, { steps: 4 });
    await page.evaluate(() => window.__semloRequireTableEditor("destroy").destroy());
    if (await page.evaluate(() => window.__semloRequireFixture("tableListenerTrace").stop()))
      throw new Error("Destroy left drag listeners attached");
    await page.mouse.up();
    if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
    return {
      initiallyReadonly: true,
      editable: true,
      savedWidth: widths[0][0],
      undoRedo: true,
      htmlJson: true,
      mergedCells: true,
      invalidHtml: true,
      selection: true,
      cancelled: true,
      cleanup: true,
    };
  } finally {
    await page.evaluate(() => {
      window.__semloRequireFixture("tableListenerTrace").restore();
      for (const [id, api] of Object.entries(window.__semloRequireFixture("tableTests"))) {
        if (!api) throw new Error(`Browser fixture table editor ${id} is not initialized`);
        api.destroy();
        document.querySelector(`#table-${id}`)?.remove();
      }
    });
  }
}
