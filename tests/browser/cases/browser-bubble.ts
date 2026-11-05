async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const paragraph = page.locator(".semlo-editor-prose > p").first();
  await paragraph.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  const bubble = page.getByRole("toolbar", { name: "选中文字格式" });
  await bubble.getByRole("button", { name: "加粗" }).click();
  const bold = await paragraph.locator("strong").innerText();
  if (bold !== "一段文字") throw new Error("Floating toolbar changed the wrong text: " + bold);
  if (errors.length) throw new Error(errors.join("; "));
  return { bold, floatingToolbar: true };
}
