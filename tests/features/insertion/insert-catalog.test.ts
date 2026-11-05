import { expect, test } from "@rstest/playwright";

test("the insertion menu exposes observed groups and available commands", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await expect(menu.locator(".semlo-editor-card-section")).toHaveText([
    "基础",
    "智能专区",
    "画板类",
    "数据表",
    "程序员专区",
    "布局和样式",
    "小工具",
    "嵌入本地文件",
    "嵌入第三方服务",
  ]);
  for (const command of [
    "canvas",
    "mindmap",
    "flowchart",
    "uml",
    "figma",
    "netease",
    "youku",
    "canva",
    "processon",
    "juejin",
    "taobao",
    "modao",
    "jinshuju",
    "amap",
    "yida",
  ])
    await expect(menu.locator(`[data-command="${command}"]`)).toBeEnabled();
  await expect(menu.locator('[data-command="bilibili"]')).toBeEnabled();
  await expect(menu.locator('[data-command="codepen"]')).toBeEnabled();
  const search = menu.getByLabel("搜索插入内容");
  await search.fill("hb");
  await expect(menu.locator(".semlo-editor-card-section")).toHaveText(["搜索结果"]);
  await expect(menu.locator('[data-command="canvas"]')).toBeEnabled();
  await search.fill("gddt");
  await expect(menu.locator('[data-command="amap"]')).toBeEnabled();
  await search.fill("yd");
  await expect(menu.locator('[data-command="yida"]')).toBeEnabled();
});
