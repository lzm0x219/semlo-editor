async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "block-insert-integration";
    document.body.prepend(host);
    window.insertChanges = 0;
    window.insertApi = createEditor({
      element: host,
      outline: false,
      content: "<p>第一段</p><p>第二段</p>",
      onChange: () => window.__semloIncrementFixture("insertChanges"),
    });
  });
  const host = page.locator("#block-insert-integration"),
    prose = host.locator(".semlo-editor-prose");
  const menu = page.getByRole("menu", { name: "块操作" }),
    panel = page.getByRole("dialog", { name: "插入内容" });
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("insertApi").getSnapshot().json);
  const set = (value: import("../../../packages/core/src/types").EditorContent) =>
    page.evaluate((value) => window.__semloRequireFixture("insertApi").setContent(value), value);
  const open = async (locator: import("playwright").Locator) => {
    await locator.hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await menu.getByRole("menuitem", { name: "在下方添加" }).click();
    await panel.waitFor();
  };
  const before = JSON.stringify(await snapshot()),
    changes = await page.evaluate(() => window.__semloRequireFixture("insertChanges"));
  await open(prose.locator("p").first());
  if (
    JSON.stringify(await snapshot()) !== before ||
    (await page.evaluate(() => window.__semloRequireFixture("insertChanges"))) !== changes
  )
    throw new Error("Opening the insert panel changed the document");
  await page.keyboard.press("Escape");
  if (
    (await panel.count()) ||
    JSON.stringify(await snapshot()) !== before ||
    (await page.evaluate(() => window.__semloRequireFixture("insertChanges"))) !== changes
  )
    throw new Error("Canceling insert below changed the document");
  if (!(await menu.count())) throw new Error("Closing the insert panel also closed the block menu");
  await page.keyboard.press("Escape");
  if (await menu.count()) throw new Error("Closing the block menu after the insert panel failed");
  await open(prose.locator("p").first());
  await panel.locator('.semlo-editor-card-item[data-command="quote"]').click();
  let result = await snapshot();
  if (
    result.content!.map((node) => node.type).join(",") !== "paragraph,blockquote,paragraph" ||
    result.content![0].content![0].text !== "第一段" ||
    result.content![2].content![0].text !== "第二段"
  )
    throw new Error("Quote was not inserted between the intended blocks: " + JSON.stringify(result));
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("insertApi").editor.commands.undo())) ||
    JSON.stringify(await snapshot()) !== before
  )
    throw new Error("Undo did not remove the inserted block in one step");
  await open(prose.locator("p").first());
  await panel.locator('.semlo-editor-card-item[data-command="table"]').hover();
  await page.getByRole("button", { name: "2行2列" }).click();
  result = await snapshot();
  if (result.content!.map((node) => node.type).join(",") !== "paragraph,table,paragraph")
    throw new Error("Table was not inserted below the chosen block");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("insertApi").editor.commands.undo())) ||
    JSON.stringify(await snapshot()) !== before
  )
    throw new Error("Undo did not remove the inserted table in one step");
  await open(prose.locator("p").first());
  await panel.locator('.semlo-editor-card-item[data-command="image"]').click();
  const image = page.getByRole("dialog", { name: "插入图片" });
  await image.waitFor();
  if (JSON.stringify(await snapshot()) !== before) throw new Error("Opening an image dialog inserted an empty block");
  await image.getByRole("button", { name: "取消" }).click();
  if (JSON.stringify(await snapshot()) !== before) throw new Error("Canceling the image dialog changed the document");
  await open(prose.locator("p").first());
  await panel.locator('.semlo-editor-card-item[data-command="image"]').click();
  await image.getByLabel("图片地址").fill("https://example.com/example.png");
  await image.getByRole("button", { name: "确定" }).click();
  result = await snapshot();
  if (
    result.content![0].content![0].text !== "第一段" ||
    result.content![1].type !== "paragraph" ||
    result.content![1].content?.length !== 1 ||
    result.content![1].content![0].type !== "image" ||
    result.content!.at(-1)!.content![0].text !== "第二段"
  )
    throw new Error("Image was not inserted below the selected block");
  await set('<p><a href="https://example.com/old">已有链接</a></p><p>之后</p>');
  await page.evaluate(() => {
    localStorage.setItem("semlo-editor.recent-commands.v1", JSON.stringify(["link"]));
    window.__semloRequireFixture("insertApi").editor.commands.setTextSelection(2);
  });
  const linkBefore = JSON.stringify(await snapshot());
  await open(prose.locator("p").first());
  if ((await panel.getByLabel("最近使用").count()) || (await panel.locator('[data-command="link"]').count()))
    throw new Error("The block insert panel should not show recently used links");
  await page.keyboard.press("Escape");
  if (JSON.stringify(await snapshot()) !== linkBefore)
    throw new Error("Closing the block insert panel changed the document");
  await set("<h1>折叠标题</h1><p>标题正文</p><h1>下一个标题</h1><p>末尾</p>");
  const headingBefore = JSON.stringify(await snapshot());
  await prose.getByRole("button", { name: "折叠标题：折叠标题" }).click();
  if (await prose.getByText("标题正文").isVisible()) throw new Error("The heading section did not collapse");
  await open(prose.locator("h1").first());
  await panel.locator('.semlo-editor-card-item[data-command="quote"]').click();
  const headingAfter = await snapshot();
  if (
    headingAfter.content!.map((node) => node.type).join(",") !== "heading,blockquote,paragraph,heading,paragraph" ||
    headingAfter.content![0].content![0].text !== "折叠标题"
  )
    throw new Error("Inserting below a collapsed heading changed the heading or misplaced the new block");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("insertApi").editor.commands.undo())) ||
    JSON.stringify(await snapshot()) !== headingBefore
  )
    throw new Error("Undo did not restore the collapsed-heading document");
  await set("<ul><li><p>第一项</p></li><li><p>第二项</p></li></ul>");
  const listBefore = JSON.stringify(await snapshot());
  await open(prose.locator("li").first().locator("p").first());
  await panel.locator('.semlo-editor-card-item[data-command="quote"]').click();
  result = await snapshot();
  const items = result.content![0].content!;
  if (
    items.length !== 3 ||
    items[0].content![0].content![0].text !== "第一项" ||
    !items[1].content!.some((node) => node.type === "blockquote") ||
    items[2].content![0].content![0].text !== "第二项"
  )
    throw new Error("List insertion did not create a new item at the intended position: " + JSON.stringify(result));
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("insertApi").editor.commands.undo())) ||
    JSON.stringify(await snapshot()) !== listBefore
  )
    throw new Error("Undo did not restore the list after insertion");
  await open(prose.locator("li").first().locator("p").first());
  await set("<p>已替换</p>");
  if ((await panel.count()) || !(await prose.getByText("已替换").count()))
    throw new Error("Changing the document left a stale insertion panel");
  await page.evaluate(() => window.__semloRequireFixture("insertApi").destroy());
  if (errors.length) throw new Error(errors.join("; "));
  return {
    deferredOpenAndCancel: true,
    quoteAndTable: true,
    imageCancelAndInsert: true,
    noRecentLinks: true,
    listItem: true,
    undo: true,
    staleTarget: true,
  };
}
