import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    detailsFidelityEditor?: EditorController;
  }
}

async function mount(
  page: Page,
  content = '<p>前文</p><details open><summary>折叠标题</summary><div data-type="detailsContent"><p>折叠正文</p></div></details><p>后文</p>',
) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'details-fidelity-test'
      document.body.prepend(host)
      window.detailsFidelityEditor = createEditor({
        element: host,
        outline: false,
        content: ${JSON.stringify(content)},
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.detailsFidelityEditor));
  return page.locator("#details-fidelity-test");
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").getSnapshot());

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("a fold stays open when its title is edited immediately after insertion", async ({ page }) => {
  const host = await mount(page, "<p></p>");
  await page.evaluate(async () => {
    const { editor } = window.__semloRequireFixture("detailsFidelityEditor");
    editor.commands.setDetails();
    editor.commands.insertContent("快速输入标题");
    // Allow the initial node view timer to run before checking the visible state.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  const card = host.locator('[data-type="details"]');
  const content = card.locator('[data-type="detailsContent"]');
  await expect(card.locator("summary")).toHaveText("快速输入标题");
  await expect(content).toBeVisible();
  await expect(card.getByRole("button", { name: "收起内容" })).toBeVisible();
  await content.locator("p").click();
  await page.keyboard.type("正文");
  await expect(content.locator("p")).toHaveText("正文");
});

test("a same-task read-only toggle survives initial reconciliation", async ({ page }) => {
  const host = await mount(page, "<p></p>");
  const unchanged = await page.evaluate(async () => {
    const controller = window.__semloRequireFixture("detailsFidelityEditor");
    controller.editor.commands.setDetails();
    controller.setEditable(false);
    const before = JSON.stringify(controller.getSnapshot().json);
    const button = document.querySelector<HTMLButtonElement>('#details-fidelity-test [data-type="details"] > button')!;
    button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return JSON.stringify(controller.getSnapshot().json) === before;
  });
  expect(unchanged).toBe(true);
  await expect(host.locator('[data-type="detailsContent"]')).toBeHidden();
  await expect(host.getByRole("button", { name: "展开内容" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").setEditable(true));
  await expect(host.locator('[data-type="detailsContent"]')).toBeVisible();
});

test("destroying a new fold cancels its deferred reconciliation", async ({ page }) => {
  const host = await mount(page, "<p></p>");
  const unchanged = await page.evaluate(async () => {
    const controller = window.__semloRequireFixture("detailsFidelityEditor");
    controller.editor.commands.setDetails();
    const card = document.querySelector('#details-fidelity-test [data-type="details"]')!;
    controller.destroy();
    const afterDestroy = card.outerHTML;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return card.outerHTML === afterDestroy;
  });
  expect(unchanged).toBe(true);
  await expect(host.locator('[data-type="details"]')).toHaveCount(0);
});

test("new folds open with the reference card and empty-field placeholders", async ({ page }) => {
  const host = await mount(page, "<p></p>");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").editor.commands.setDetails()),
  ).toBe(true);
  const card = host.locator('[data-type="details"]');
  const summary = card.locator("summary");
  const content = card.locator('[data-type="detailsContent"]');
  const toggle = card.getByRole("button", { name: "收起内容" });
  await expect(content).toBeVisible();
  const appearance = await card.evaluate((node) => {
    const summary = node.querySelector("summary")!;
    const paragraph = node.querySelector('[data-type="detailsContent"] > p')!;
    const style = getComputedStyle(node);
    return {
      height: node.getBoundingClientRect().height,
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      radius: style.borderRadius,
      summaryPlaceholder: getComputedStyle(summary, "::before").content,
      bodyPlaceholder: getComputedStyle(paragraph, "::before").content,
      bodyBorder: getComputedStyle(paragraph.parentElement!).borderLeftWidth,
    };
  });
  expect(appearance.height).toBeCloseTo(78, 0);
  expect(appearance.borderColor).toBe("rgb(231, 233, 232)");
  expect(appearance.borderWidth).toBe("1px");
  expect(appearance.radius).toBe("6px");
  expect(appearance.summaryPlaceholder).toBe('"请输入折叠卡片标题"');
  expect(appearance.bodyPlaceholder).toBe('"在此输入内容"');
  expect(appearance.bodyBorder).toBe("0px");
  await toggle.click();
  await expect(content).toBeHidden();
  await expect(summary).toBeVisible();
  expect((await card.boundingBox())!.height).toBeCloseTo(44, 0);
  await expect(card.getByRole("button", { name: "展开内容" })).toBeVisible();
});

test("Enter in a closed fold title opens it and creates a paragraph before its body", async ({ page }) => {
  const host = await mount(page);
  const content = host.locator('[data-type="detailsContent"]');
  await host.getByRole("button", { name: "收起内容" }).click();
  await expect(content).toBeHidden();
  await host.locator("summary").click();
  await page.waitForFunction(
    () =>
      window.__semloRequireFixture("detailsFidelityEditor").editor.state.selection.$head.parent.type.name ===
      "detailsSummary",
  );
  await page.keyboard.press("Enter");
  await expect(content).toBeVisible();
  await expect(content.locator("p")).toHaveCount(2);
  const selection = await page.evaluate(() => {
    const { $head } = window.__semloRequireFixture("detailsFidelityEditor").editor.state.selection;
    return { parent: $head.parent.type.name, offset: $head.parentOffset };
  });
  expect(selection).toEqual({ parent: "paragraph", offset: 0 });
  await page.keyboard.type("新");
  await expect(content.locator("p").first()).toHaveText("新");
  await expect(content.locator("p").last()).toHaveText("折叠正文");
});

for (const startingOpen of [true, false]) {
  test(`Enter in an empty ${startingOpen ? "open" : "closed"} fold reuses its empty body`, async ({ page }) => {
    const host = await mount(page, "<p></p>");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").editor.commands.setDetails()),
    ).toBe(true);
    const content = host.locator('[data-type="detailsContent"]');
    await expect(content).toBeVisible();
    const originalParagraph = await content.locator("p").elementHandle();
    if (!startingOpen) {
      await host.getByRole("button", { name: "收起内容" }).click();
      await expect(content).toBeHidden();
    }
    await host.locator("summary").click();
    await page.waitForFunction(
      () =>
        window.__semloRequireFixture("detailsFidelityEditor").editor.state.selection.$head.parent.type.name ===
        "detailsSummary",
    );
    await page.keyboard.press("Enter");
    await expect(content).toBeVisible();
    await expect(content.locator("p")).toHaveCount(1);
    expect(await originalParagraph!.evaluate((element) => element.isConnected)).toBe(true);
    const selection = await page.evaluate(() => {
      const { $head } = window.__semloRequireFixture("detailsFidelityEditor").editor.state.selection;
      return { parent: $head.parent.type.name, offset: $head.parentOffset };
    });
    expect(selection).toEqual({ parent: "paragraph", offset: 0 });
    await page.keyboard.type("新正文");
    await expect(content.locator("p")).toHaveText("新正文");
  });
}

test("folding preserves content and round-trips open state through HTML and JSON", async ({ page }) => {
  const host = await mount(page);
  const content = host.locator('[data-type="detailsContent"]');
  const toggle = host.getByRole("button", { name: "收起内容" });
  await expect(content).toBeVisible();
  const before = await snapshot(page);
  await toggle.click();
  await expect(content).toBeHidden();
  await expect(host.getByText("折叠标题")).toBeVisible();
  const closed = await snapshot(page);
  expect(closed.text).toBe(before.text);
  expect(closed.json).not.toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(content).toBeVisible();
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(content).toBeHidden();
  expect((await snapshot(page)).json).toEqual(closed.json);
  for (const value of [closed.html, closed.json]) {
    await page.evaluate((next) => {
      window.__semloRequireFixture("detailsFidelityEditor").setContent("<p>临时</p>");
      window.__semloRequireFixture("detailsFidelityEditor").setContent(next);
    }, value);
    expect((await snapshot(page)).json).toEqual(closed.json);
    await expect(host.locator('[data-type="detailsContent"]')).toBeHidden();
    await expect(host.getByText("折叠标题")).toBeVisible();
  }
});

test("a read-only fold can be opened without modifying the document", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "收起内容" }).click();
  await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").setEditable(false));
  const before = await snapshot(page);
  await host.getByRole("button", { name: "展开内容" }).click();
  await expect(host.locator('[data-type="detailsContent"]')).toBeVisible();
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").destroy());
  await expect(host.locator('[data-type="details"]')).toHaveCount(0);
});

test("leaving read-only restores the saved state before editing the fold", async ({ page }) => {
  const host = await mount(page);
  const content = host.locator('[data-type="detailsContent"]');
  await expect(content).toBeVisible();
  const before = await snapshot(page);
  await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").setEditable(false));
  await host.getByRole("button", { name: "收起内容" }).click();
  await expect(content).toBeHidden();
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.evaluate(() => window.__semloRequireFixture("detailsFidelityEditor").setEditable(true));
  await expect(content).toBeVisible();
  await host.getByRole("button", { name: "收起内容" }).click();
  await expect(content).toBeHidden();
  expect((await snapshot(page)).json).not.toEqual(before.json);
});
