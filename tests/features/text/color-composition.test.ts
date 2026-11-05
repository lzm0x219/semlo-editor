import { expect, test } from "@rstest/playwright";

test("custom color controls ignore composition keys", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'color-composition'; document.body.append(host)
      window.colorComposition = createEditor({ element: host, outline: false, content: '<p>目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "colorComposition")));
  await page.locator("#color-composition").getByRole("button", { name: "文字颜色", exact: true }).click();
  await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "更多颜色" }).click();
  const custom = page.getByRole("dialog", { name: "自定义颜色" });
  const input = custom.getByLabel("HEX", { exact: true });
  await input.fill("#12");
  for (const init of [
    { key: "Enter", isComposing: true },
    { key: "Enter", keyCode: 229 },
  ]) {
    const prevented = await input.evaluate(
      (element, options) =>
        !element.dispatchEvent(new KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true })),
      init,
    );
    expect(prevented).toBe(false);
    await expect(input).toHaveValue("#12");
  }
  const prevented = await input.evaluate(
    (element) =>
      !element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })),
  );
  expect(prevented).toBe(true);
  await expect(custom).toBeVisible();
  const field = custom.getByRole("slider", { name: "颜色饱和度与亮度" });
  const before = await field.getAttribute("aria-valuetext");
  for (const init of [
    { key: "ArrowRight", isComposing: true },
    { key: "ArrowRight", keyCode: 229 },
  ]) {
    const handled = await field.evaluate(
      (element, options) =>
        !element.dispatchEvent(new KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true })),
      init,
    );
    expect(handled).toBe(false);
    await expect(field).toHaveAttribute("aria-valuetext", before!);
  }
  const handled = await field.evaluate(
    (element) =>
      !element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })),
  );
  expect(handled).toBe(true);
  expect(await field.getAttribute("aria-valuetext")).not.toBe(before);
  await page.evaluate(() => Reflect.get(window, "colorComposition").destroy());
});
