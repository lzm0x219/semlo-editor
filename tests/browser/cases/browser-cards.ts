async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const toolbar = page.getByRole("toolbar", { name: "文本格式" });
  const showMenu = async () => {
    await toolbar.getByRole("button", { name: "插入内容" }).click();
    return page.getByRole("dialog", { name: "插入内容" });
  };
  await page.locator(".semlo-editor-prose > p").last().click();
  let menu = await showMenu();
  await menu.getByRole("option", { name: /状态/ }).click();
  const status = page.locator(".semlo-editor-prose .semlo-editor-status-node");
  const editor = page.getByRole("dialog", { name: "编辑状态" });
  await editor.getByLabel("状态文字").fill("进行中");
  await editor.getByRole("button", { name: "蓝色" }).click();
  await editor.getByLabel("状态文字").press("Enter");
  if (!(await status.innerText()).includes("进行中")) throw new Error("Status text not saved");
  if ((await status.locator("button").evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgb(192, 221, 252)")
    throw new Error("Status color not applied");
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/gs");
  await page.keyboard.press("Enter");
  const formulaDialog = page.getByRole("dialog", { name: "编辑公式" });
  await formulaDialog.getByLabel("TeX 公式").fill("\\frac{a}{b}");
  if (!(await formulaDialog.locator(".katex").count())) throw new Error("Formula preview not rendered");
  await formulaDialog.getByLabel("TeX 公式").press("Meta+Enter");
  const formula = page.locator(".semlo-editor-prose .semlo-editor-formula-node");
  if (!(await formula.locator(".katex").count())) throw new Error("Formula not rendered");
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  menu = await showMenu();
  await menu.getByRole("option", { name: /分栏卡片/ }).hover();
  await page.getByRole("menuitem", { name: "三栏" }).click();
  const columns = page.locator(".semlo-editor-prose .semlo-editor-columns").last();
  if ((await columns.locator(".semlo-editor-column").count()) !== 3) throw new Error("Three-column layout failed");
  for (const [index, text] of ["左栏", "中栏", "右栏"].entries()) {
    await columns.locator(".semlo-editor-column").nth(index).locator("p").first().click();
    await page.keyboard.type(text);
  }
  menu = await showMenu();
  if (!(await menu.getByRole("option", { name: /附件/ }).isEnabled())) throw new Error("Attachment menu is disabled");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.semlo-editor input[type="file"][multiple]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["attachment verification"], "fixture-attachment.txt", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const attachment = page.locator(".semlo-editor-prose a.semlo-editor-attachment");
  await attachment.waitFor();
  if (
    !(await attachment.innerText()).includes("fixture-attachment.txt") ||
    !(await attachment.getAttribute("href"))?.startsWith("blob:")
  )
    throw new Error("Attachment insertion failed");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    if (!(await page.locator(".semlo-editor-status-node").innerText()).includes("进行中"))
      throw new Error(framework + ": status lost");
    if (!(await page.locator(".semlo-editor-formula-node .katex").count()))
      throw new Error(framework + ": formula lost");
    if (
      (await page.locator(".semlo-editor-columns .semlo-editor-column").count()) !== 3 ||
      !(await page.locator(".semlo-editor-columns").innerText()).includes("中栏")
    )
      throw new Error(framework + ": columns lost");
    if (!(await page.locator(".semlo-editor-attachment").innerText()).includes("fixture-attachment.txt"))
      throw new Error(framework + ": attachment lost");
  }
  await page.getByRole("button", { name: "只读预览" }).click();
  if (
    !(await page.locator(".semlo-editor-status-node button").isDisabled()) ||
    !(await page.locator(".semlo-editor-formula-node button").isDisabled())
  )
    throw new Error("Read-only card controls active");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    status: true,
    formula: true,
    columns: 3,
    attachment: true,
    frameworks: ["React", "SolidJS", "Vue"],
    readOnly: true,
  };
}
