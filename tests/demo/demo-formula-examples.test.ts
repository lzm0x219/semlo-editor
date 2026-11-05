import { expect, test } from "@rstest/playwright";

test("formula and diagram examples render and survive framework switches", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("formula");

  const host = page.locator("#editor-host");
  const inline = host.locator(".semlo-editor-formula-node");
  const block = host.locator(".semlo-editor-block-formula-node");
  const diagrams = host.locator(".semlo-editor-diagram");

  const expectRendered = async () => {
    await expect(inline.locator(".katex")).toHaveCount(1);
    await expect(block.locator(".katex-display")).toHaveCount(1);
    await expect(host.locator(".semlo-editor-formula.is-invalid")).toHaveCount(0);
    await expect(diagrams).toHaveCount(4);
    await expect(diagrams.locator(".semlo-editor-diagram-preview-content svg")).toHaveCount(4, { timeout: 30_000 });
  };

  await expectRendered();
  const editedFormula = String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`;
  await block.locator("button.semlo-editor-formula").click();
  const dialog = page.getByRole("dialog", { name: "编辑公式" });
  await dialog.getByLabel("TeX 公式").fill(editedFormula);
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(block.locator(".katex-display")).toHaveCount(1);

  for (const framework of ["React", "SolidJS", "原生 JS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await expect(page.getByRole("combobox", { name: "选择示例" })).toHaveValue("formula");
    await expectRendered();
    await block.locator("button.semlo-editor-formula").click();
    await expect(dialog.getByLabel("TeX 公式")).toHaveValue(editedFormula);
    await dialog.getByLabel("TeX 公式").press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
