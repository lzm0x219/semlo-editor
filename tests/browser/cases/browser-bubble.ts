async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const paragraph = page.locator(".semlo-editor-prose > p").first();
  const before = await paragraph.innerHTML();
  await paragraph.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  const bubble = page.getByRole("toolbar", { name: "选中文字工具" });
  await bubble.waitFor({ state: "visible" });
  const buttons = bubble.getByRole("button");
  if ((await buttons.count()) !== 1) throw new Error("默认选区工具应只有 AI 入口");
  const ai = bubble.getByRole("button", { name: "AI 写作", exact: true });
  if (!(await ai.isDisabled())) throw new Error("未配置服务时 AI 入口应禁用");
  const selected = await page.evaluate(() => document.getSelection()?.toString());
  if (selected !== "一段文字") throw new Error("选区文字发生变化：" + selected);
  if ((await paragraph.innerHTML()) !== before) throw new Error("显示默认选区工具不应修改正文");
  const main = page.getByRole("toolbar", { name: "文本格式", exact: true });
  if (!(await main.getByRole("button", { name: "加粗", exact: true }).isEnabled()))
    throw new Error("主工具栏格式应仍可用");
  if (errors.length) throw new Error(errors.join("; "));
  return { selected, defaultTools: ["AI 写作"], disabled: true, unchanged: true, floatingToolbar: true };
}
