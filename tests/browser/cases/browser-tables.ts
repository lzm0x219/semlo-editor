async function _browserTest(page: import("playwright").Page) {
  await page.goto(new URL("/", page.url()).href);
  return await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.append(host);
    const api = createEditor({ element: host, content: "<p>before</p>" });
    api.editor.commands.setTextSelection(7);
    if (!api.editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
      throw new Error("Table insertion failed");
    const positions: number[] = [];
    api.editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableHeader") positions.push(position);
    });
    if (
      positions.length !== 3 ||
      !api.editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] })
    )
      throw new Error("Cell selection failed");
    if (!api.editor.commands.mergeCells()) throw new Error("Merge failed");
    const merged = api.getSnapshot().json;
    const html = api.getSnapshot().html;
    if (!html.includes('colspan="2"')) throw new Error("Merged colspan missing: " + html);
    if (!api.editor.commands.splitCell()) throw new Error("Split failed");
    const split = api.getSnapshot().html;
    if (split.includes('colspan="2"')) throw new Error("Split left a merged cell: " + split);
    api.destroy();
    host.remove();
    return { headerCount: positions.length, merged: !!merged, split: true };
  });
}
