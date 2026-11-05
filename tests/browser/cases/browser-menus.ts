async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  await page.locator(".semlo-editor-prose > p").last().click();
  await toolbar.getByRole("button", { name: "插入内容" }).click();
  const dialog = page.getByRole("dialog", { name: "插入内容" });
  await dialog.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
  await page.getByLabel("2行4列").hover();
  if ((await page.locator(".semlo-editor-table-grid button.selected").count()) !== 8)
    throw new Error("Table grid highlighting wrong");
  await page.getByLabel("2行4列").click();
  const table = page.locator(".semlo-editor-prose table").last();
  if ((await table.locator("tr").count()) !== 2 || (await table.locator("tr").first().locator("td,th").count()) !== 4)
    throw new Error("Table dimensions wrong");
  if (await page.locator(".semlo-editor-table-grid-popover, .semlo-editor-card-menu").count())
    throw new Error("Table picker leaked");
  await toolbar.getByRole("button", { name: "插入内容" }).click();
  await dialog.getByLabel("搜索插入内容").fill("glk");
  if (!(await dialog.getByRole("option", { name: /高亮块/ }).count())) throw new Error("Card search failed");
  await page.keyboard.press("Escape");
  if (await dialog.count()) throw new Error("Card menu did not close on Escape");
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/zdk");
  await page.keyboard.press("Enter");
  if (!(await page.locator(".semlo-editor-prose summary").count())) throw new Error("Slash search or Enter failed");
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/");
  await page.getByRole("button", { name: "标题3", exact: true }).click();
  if (!(await page.locator(".semlo-editor-prose h3").count())) throw new Error("Slash quick format failed");
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "menu-test";
    document.body.prepend(host);
    window.menuTest = createEditor({ element: host, content: "<p>abcd</p>" });
    window.__semloRequireFixture("menuTest").editor.commands.focus();
    window.__semloRequireFixture("menuTest").editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  const local = page.locator("#menu-test");
  await local.getByRole("button", { name: "字号" }).click();
  await page.getByRole("menuitem", { name: "22px" }).click();
  if (!(await local.locator(".semlo-editor-prose").innerHTML()).includes("font-size: 22px"))
    throw new Error("Font size failed");
  await local.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page.getByRole("dialog", { name: "选择颜色" }).getByLabel("红色 #df2a3f").click();
  if (!(await local.locator(".semlo-editor-prose").innerHTML()).includes("color: rgb(223, 42, 63)"))
    throw new Error("Color failed");
  await local.getByRole("button", { name: "上下标" }).click();
  await page.getByRole("menuitem", { name: "上标" }).click();
  if (!(await local.locator(".semlo-editor-prose sup").count())) throw new Error("Superscript failed");
  await local.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: /标题2/ }).click();
  if (!(await local.locator(".semlo-editor-prose h2").count())) throw new Error("Heading failed");
  await local.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page.keyboard.press("Escape");
  if (await page.locator(".semlo-editor-palette").count()) throw new Error("Palette did not close on Escape");
  await local.getByRole("button", { name: "段落样式" }).click();
  await page.evaluate(() => window.__semloRequireFixture("menuTest").destroy());
  if (
    await page
      .locator(
        ".semlo-editor-dropdown, .semlo-editor-palette, .semlo-editor-card-menu, .semlo-editor-table-grid-popover",
      )
      .count()
  )
    throw new Error("Destroy leaked popup");
  await page.evaluate(() => document.querySelector("#menu-test")!.remove());
  if (errors.length) throw new Error(errors.join("; "));
  return { table: "2×4", search: true, escape: true, slash: true, selectionFormatting: true, destroyCleanup: true };
}
