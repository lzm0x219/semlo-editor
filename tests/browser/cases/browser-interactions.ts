async function _browserTest(page: import("playwright").Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/折叠");
  await page.getByRole("option", { name: /折叠块/ }).waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".semlo-editor-prose summary").waitFor();
  await page.keyboard.type("折叠标题测试");
  const summary = await page.locator(".semlo-editor-prose summary").innerText();
  if (!summary.includes("折叠标题测试")) throw new Error("Cannot type a fold summary: " + summary);
  const inside = page.locator('.semlo-editor-prose [data-type="detailsContent"] p').first();
  await inside.click();
  await page.keyboard.type("折叠正文测试");
  const insideText = await inside.innerText();
  if (!insideText.includes("折叠正文测试")) throw new Error("Cannot type fold content: " + insideText);
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    await page.locator(".semlo-editor-prose summary").waitFor();
    if (!(await page.locator(".semlo-editor-prose summary").innerText()).includes("折叠标题测试"))
      throw new Error(framework + ": lost summary");
    if (!(await page.locator('.semlo-editor-prose [data-type="detailsContent"]').innerText()).includes("折叠正文测试"))
      throw new Error(framework + ": lost body");
  }
  await page.getByText("记录一闪而过的灵感").click();
  await page.keyboard.press("Meta+/");
  const dialog = page.getByRole("dialog", { name: "插入内容" });
  await dialog.waitFor();
  await dialog.getByLabel("搜索插入内容").fill("高亮");
  await dialog.getByRole("option", { name: /高亮块/ }).click();
  if (
    !(await page.locator(".semlo-editor-prose aside[data-semlo-editor-callout]").count()) ||
    !(await page.locator(".semlo-editor-prose").innerText()).includes("记录一闪而过的灵感")
  )
    throw new Error("Callout was not inserted or lost existing content");
  await page.getByRole("button", { name: "只读预览" }).click();
  if (await page.getByRole("toolbar", { name: "文本格式" }).count())
    throw new Error("Toolbar remained visible in read-only mode");
  if (problems.length) throw new Error("Page errors: " + problems.join("; "));
  return {
    foldSummary: summary,
    foldBody: insideText,
    frameworks: ["Vue", "React", "SolidJS"],
    shortcutMenu: true,
    calloutPreservesText: true,
    readOnly: true,
    errors: problems,
  };
}
