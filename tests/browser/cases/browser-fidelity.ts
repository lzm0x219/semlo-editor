async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  const insert = toolbar.getByRole("button", { name: "插入内容" });
  await insert.click();
  await insert.click();
  if (await page.locator(".semlo-editor-card-menu").count()) throw new Error("Insert button did not toggle menu");
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/");
  await page.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
  await page.getByLabel("3行2列").click();
  const table = page.locator(".semlo-editor-prose table").last();
  if (
    (await table.locator("tr").count()) !== 3 ||
    (await table.locator("tr").first().locator("td").count()) !== 2 ||
    (await page.locator(".semlo-editor-prose").innerText()).endsWith("/")
  )
    throw new Error("Slash table insertion failed");
  if (await page.locator(".semlo-editor-slash-menu, .semlo-editor-table-grid-popover").count())
    throw new Error("Slash table picker leaked");
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/dmk");
  await page.keyboard.press("Enter");
  let card = page.locator(".semlo-editor-prose .semlo-editor-code-card");
  await card.waitFor();
  await card.hover();
  await card.locator("code").click();
  await page.waitForTimeout(600);
  await page.keyboard.type("const value = 42");
  await page.keyboard.press("Enter");
  await page.keyboard.type("value");
  const beforeUndo = await card.locator("code").innerText();
  await page.keyboard.press("Meta+z");
  if ((await card.locator("code").innerText()) === beforeUndo) throw new Error("Code undo failed");
  await page.keyboard.press("Meta+Shift+z");
  if ((await card.locator("code").innerText()) !== beforeUndo) throw new Error("Code redo failed");
  await card.getByLabel("代码块名称").fill("跨框架代码");
  await card.getByLabel("代码语言").click();
  await page.getByRole("option", { name: "JavaScript", exact: true }).click();
  await card.getByLabel("代码主题").click();
  await page.getByRole("option", { name: "One Dark Pro", exact: true }).click();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  const settings = page.getByRole("menu", { name: "代码块设置" });
  await settings.getByRole("menuitem", { name: "字号", exact: true }).click();
  await page.getByRole("menu", { name: "字号", exact: true }).getByRole("menuitemradio", { name: "16px" }).click();
  await settings.getByRole("menuitemcheckbox", { name: "自动换行" }).click();
  await settings.press("Escape");
  await card.getByLabel("收起代码块").click();
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    card = page.locator(".semlo-editor-prose .semlo-editor-code-card");
    await card.waitFor();
    if (
      (await card.getByLabel("代码块名称").inputValue()) !== "跨框架代码" ||
      (await card.getByLabel("代码语言").getAttribute("data-value")) !== "javascript" ||
      (await card.getByLabel("代码主题").getAttribute("data-value")) !== "dark" ||
      (await card.getAttribute("data-code-wrap")) !== "true" ||
      (await card.evaluate((element) => element.style.fontSize)) !== "16px" ||
      !(await card.getByLabel("展开代码块").count())
    )
      throw new Error(framework + ": code attributes lost");
    if (!(await card.locator("code").textContent())?.includes("const value = 42"))
      throw new Error(framework + ": code content lost");
  }
  if (errors.length) throw new Error(errors.join("; "));
  return {
    insertToggle: true,
    slashTable: "3×2",
    keyboardCode: true,
    undoRedo: true,
    codeFrameworks: ["React", "SolidJS", "Vue"],
  };
}
