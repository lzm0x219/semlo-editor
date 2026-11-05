async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "outline-test";
    document.body.replaceChildren(host);
    const { createEditor } = await import("/dist/index.js");
    window.outlineChanges = 0;
    window.outlineApi = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "第一节" }] },
          { type: "paragraph", content: [{ type: "text", text: "第一节内容" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "子标题" }] },
          { type: "paragraph", content: [{ type: "text", text: "子标题内容" }] },
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "三级标题" }] },
          { type: "paragraph", content: [{ type: "text", text: "三级标题内容" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "第二节" }] },
          { type: "paragraph", content: [{ type: "text", text: "第二节内容" }] },
        ],
      },
      onChange: () => window.__semloIncrementFixture("outlineChanges"),
    });
  });
  const host = page.locator("#outline-test"),
    nav = host.getByRole("navigation", { name: "文档大纲" });
  const link = (text: string) => nav.getByRole("button", { name: text, exact: true });
  await nav.waitFor();
  const open = async () => {
    if (await nav.getByRole("button", { name: "隐藏大纲", exact: true }).isVisible()) return;
    await nav.getByRole("button", { name: "展开大纲", exact: true }).focus();
    await page.keyboard.press("Enter");
    await nav.getByRole("button", { name: "隐藏大纲", exact: true }).waitFor();
  };
  await open();
  for (const name of ["第一节", "子标题", "三级标题", "第二节"])
    if ((await link(name).count()) !== 1) throw new Error(`Missing outline item: ${name}`);
  const indent = await nav
    .locator(".semlo-editor-outline-row")
    .evaluateAll((rows) => rows.map((row) => parseFloat(getComputedStyle(row).paddingLeft)));
  if (!(indent[0] < indent[1] && indent[1] < indent[2] && indent[3] === indent[0]))
    throw new Error("Outline hierarchy was not reflected in indentation: " + indent);
  const original = await page.evaluate(() =>
    JSON.stringify(window.__semloRequireFixture("outlineApi").getSnapshot().json),
  );
  await nav.getByRole("button", { name: "折叠 第一节", exact: true }).click();
  if ((await link("子标题").count()) || (await link("三级标题").count()) || !(await link("第二节").count()))
    throw new Error("Folding an outline branch hid the wrong rows");
  await nav.getByRole("button", { name: "展开 第一节", exact: true }).click();
  if (!(await link("三级标题").count())) throw new Error("Expanding an outline branch failed");
  await nav.getByRole("button", { name: "折叠全部层级", exact: true }).click();
  if (await link("子标题").count()) throw new Error("Collapse all left a child visible");
  await nav.getByRole("button", { name: "展开全部层级", exact: true }).click();
  if (!(await link("三级标题").count())) throw new Error("Expand all left a child hidden");
  await nav.getByRole("button", { name: "隐藏大纲", exact: true }).click();
  if (await link("第一节").isVisible()) throw new Error("The outline list remained visible after hiding");
  await open();
  if (!(await link("第一节").isVisible())) throw new Error("The compact outline could not be reopened");
  if (
    (await page.evaluate(() => window.__semloRequireFixture("outlineChanges"))) ||
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("outlineApi").getSnapshot().json))) !==
      original
  )
    throw new Error("Outline UI changed document content");

  const first = host.locator("h1").first(),
    child = host.locator("h2").first();
  await first.getByRole("button", { name: "折叠标题：第一节", exact: true }).click();
  if (await child.isVisible()) throw new Error("The heading did not fold its section");
  await open();
  await link("子标题").click();
  if (!(await child.isVisible())) throw new Error("Outline navigation did not reveal a folded ancestor");
  if (
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("outlineApi").getSnapshot().json))) !==
    original
  )
    throw new Error("Heading visibility changed document data");

  await nav.getByRole("button", { name: "折叠 第一节", exact: true }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("outlineApi").editor.chain().setTextSelection(1).insertContent("新").run(),
  );
  if (!(await link("新第一节").count()) || (await link("子标题").count()))
    throw new Error("Editing a heading lost its outline or fold state");
  await nav.getByRole("button", { name: "展开 新第一节", exact: true }).click();
  if (!(await link("子标题").count())) throw new Error("A renamed branch could not be expanded");
  await page.evaluate(() => window.__semloRequireFixture("outlineApi").setEditable(false));
  if (!(await nav.isVisible())) throw new Error("Read-only mode hid the outline");
  await open();
  await link("第二节").click();
  await page.evaluate(() => window.__semloRequireFixture("outlineApi").destroy());
  if (await nav.count()) throw new Error("Destroying the editor left its outline mounted");
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const noOutline = document.createElement("div");
    noOutline.id = "outline-off";
    document.body.append(noOutline);
    window.outlineOff = createEditor({ element: noOutline, outline: false, content: "<h1>关闭大纲</h1>" });
  });
  if (await page.locator("#outline-off").getByRole("navigation", { name: "文档大纲" }).count())
    throw new Error("outline: false did not hide the outline");
  await page.evaluate(() => window.__semloRequireFixture("outlineOff").destroy());
  if (errors.length) throw new Error(errors.join("; "));
  return {
    hierarchy: true,
    branchAndAllFold: true,
    showHide: true,
    jumpRevealsBody: true,
    liveUpdates: true,
    readOnly: true,
    teardown: true,
    optional: true,
  };
}
