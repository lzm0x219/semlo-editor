async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "link-test";
    document.body.prepend(host);
    window.linkApi = createEditor({ element: host, content: "<p><strong>abc</strong> def</p>" });
  });
  const host = page.locator("#link-test"),
    prose = host.locator(".semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await host.getByRole("button", { name: "链接", exact: true }).click();
  let form = page.getByRole("dialog", { name: "插入链接" });
  if ((await form.getByLabel("文本").inputValue()) !== "abc") throw new Error("Selected text was not prefilled");
  if (!(await form.getByRole("button", { name: "确定" }).isDisabled())) throw new Error("Empty URL was accepted");
  await form.getByLabel("链接", { exact: true }).fill("example.com");
  await form.getByRole("button", { name: "确定" }).click();
  let anchor = prose.locator("a");
  if (
    (await anchor.getAttribute("href")) !== "https://example.com" ||
    (await anchor.innerText()) !== "abc" ||
    !(await anchor.locator("strong").count())
  )
    throw new Error("Link lost its selection or formatting");
  await anchor.click();
  await page.keyboard.press("Meta+k");
  form = page.getByRole("dialog", { name: "插入链接" });
  if (
    (await form.getByLabel("文本").inputValue()) !== "abc" ||
    (await form.getByLabel("链接", { exact: true }).inputValue()) !== "https://example.com"
  )
    throw new Error("Existing link was not prefilled");
  await form.getByLabel("文本").fill("新的名称");
  await form.getByLabel("链接", { exact: true }).fill("https://example.org/path");
  await form.getByRole("button", { name: "确定" }).click();
  anchor = prose.locator("a");
  if ((await anchor.innerText()) !== "新的名称" || (await anchor.getAttribute("href")) !== "https://example.org/path")
    throw new Error("Editing existing link failed");
  await page.evaluate(() => window.__semloRequireFixture("linkApi").setContent("<p></p>"));
  await prose.locator("p").click();
  await page.keyboard.press("Meta+k");
  form = page.getByRole("dialog", { name: "插入链接" });
  if ((await form.getByLabel("文本").inputValue()) !== "链接") throw new Error("Default link text missing");
  await form.getByLabel("文本").fill("独立链接");
  await form.getByLabel("链接", { exact: true }).fill("https://example.com");
  await form.getByRole("button", { name: "确定" }).click();
  if ((await prose.locator("a").innerText()) !== "独立链接") throw new Error("Link without selection was not inserted");
  await page.evaluate(() => window.__semloRequireFixture("linkApi").setContent("<p></p>"));
  await prose.locator("p").click();
  await page.keyboard.type("/");
  await page.getByRole("button", { name: "链接", exact: true }).last().click();
  form = page.getByRole("dialog", { name: "插入链接" });
  await form.waitFor();
  await page.keyboard.press("Escape");
  anchor = prose.locator("a");
  if ((await form.count()) || (await anchor.innerText()) !== "链接" || (await anchor.getAttribute("href")) !== null)
    throw new Error("Cancelling slash link did not keep the unaddressed placeholder");
  await page.keyboard.press("Meta+z");
  if ((await prose.innerText()).trim() !== "/") throw new Error("Undo did not restore the slash");
  await page.keyboard.press("Escape");
  await host.getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  if (!(await menu.locator(".semlo-editor-recent-list").getByRole("button", { name: "链接", exact: true }).count()))
    throw new Error("Recent link missing from menu");
  const sections = await menu.locator(".semlo-editor-card-section").allTextContents();
  if (sections.join("|") !== "基础|智能专区|画板类|数据表|程序员专区|布局和样式|小工具|嵌入本地文件|嵌入第三方服务")
    throw new Error("Current menu order incorrect: " + sections.join("|"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__semloRequireFixture("linkApi").destroy();
    document.querySelector("#link-test")!.remove();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return {
    selectedText: true,
    formatPreserved: true,
    edit: true,
    emptySelection: true,
    slashCancel: true,
    menuOrder: sections,
  };
}
