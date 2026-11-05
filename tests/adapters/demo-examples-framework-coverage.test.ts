import { expect, test } from "@rstest/playwright";

test("every preview example keeps its content when loaded in each framework", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);

  const selector = page.getByRole("combobox", { name: "选择示例" });
  const host = page.locator("#editor-host");
  const prose = host.locator(".semlo-editor-prose");
  const options = await selector
    .locator("option")
    .evaluateAll((elements) =>
      elements.map((element) => ({ value: (element as HTMLOptionElement).value, title: element.textContent?.trim() })),
    );
  expect(options.length).toBeGreaterThan(1);

  // These selectors represent the specialized content whose node views could
  // otherwise disappear unnoticed even when the document heading survives.
  const selectors = [
    ".semlo-editor-heading-number",
    "table",
    'ul[data-type="taskList"]',
    "[data-semlo-editor-callout]",
    '[data-type="details"]',
    ".semlo-editor-columns-node",
    ".semlo-editor-database",
    ".semlo-editor-image-node",
    ".semlo-editor-gallery",
    ".semlo-editor-attachment",
    "audio",
    "video",
    ".semlo-editor-date-node",
    ".semlo-editor-calendar-node",
    ".semlo-editor-mention",
    ".semlo-editor-formula-node",
    ".semlo-editor-block-formula-node",
    ".semlo-editor-diagram",
    ".semlo-editor-embed",
  ];
  const expected = new Map<string, { heading: string; counts: number[] }>();

  for (const framework of ["Vue", "React", "SolidJS", "原生 JS"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    for (const option of options) {
      await selector.selectOption(option.value);
      await expect(selector).toHaveValue(option.value);
      await expect(prose).toBeVisible();
      await expect(prose.locator("h1").first()).not.toBeEmpty();

      if (expected.has(option.value)) {
        const baseline = expected.get(option.value)!;
        await expect(prose.locator("h1").first()).toHaveText(baseline.heading);
        await expect
          .poll(() =>
            prose.evaluate((element, paths) => paths.map((path) => element.querySelectorAll(path).length), selectors),
          )
          .toEqual(baseline.counts);
      } else {
        expected.set(option.value, {
          heading: await prose.locator("h1").first().innerText(),
          counts: await prose.evaluate(
            (element, paths) => paths.map((path) => element.querySelectorAll(path).length),
            selectors,
          ),
        });
      }
    }
  }
  expect(errors).toEqual([]);
});
