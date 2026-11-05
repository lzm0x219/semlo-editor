import { expect, test } from "@rstest/playwright";

test("the preview word count excludes image alt text but counts body edits", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("media");
  const host = page.locator("#editor-host");
  const images = host.locator(".semlo-editor-image-node");
  const count = page.locator("#count");
  await expect(images).toHaveCount(6);
  await expect(count).toContainText("字");
  const initial = Number.parseInt((await count.innerText()).replace(/\D/g, ""), 10);
  expect(initial).toBeGreaterThan(0);

  await images.first().hover();
  await images.first().getByRole("button", { name: "删除图片" }).click();
  await expect(images).toHaveCount(5);
  await expect(count).toHaveText(`${initial} 字`);
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(images).toHaveCount(6);
  await expect(count).toHaveText(`${initial} 字`);

  const mixed = host.locator(".semlo-editor-prose p").filter({ hasText: "图片后的文字" });
  await mixed.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("字");
  await expect(count).toHaveText(`${initial + 1} 字`);
});
