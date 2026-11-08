import { expect, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import type { SequenceDocument, SequenceFramework } from "./numbering-sequences-framework-fixture";

export async function mountSequence(
  page: Page,
  origin: string,
  framework: SequenceFramework = "core",
  variant: SequenceDocument = "three",
  echo: "json" | "html" = "json",
) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountSequenceFixture === "function");
  await page.evaluate(
    ({ framework, variant, echo }) => window.__semloRequireFixture("mountSequenceFixture")(framework, variant, echo),
    { framework, variant, echo },
  );
  await settleSequence(page);
  return page.locator("#sequence-fixture .semlo-editor-prose");
}
export async function settleSequence(page: Page) {
  await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").settle());
}
export async function dragSequence(page: Page, source: Locator, target: Locator, before: boolean) {
  await source.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error("拖动源或目标没有可见边界");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, before ? to.y + 2 : to.y + to.height - 2, { steps: 10 });
  await page.mouse.up();
}
export async function readSequence(page: Page) {
  await settleSequence(page);
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("sequenceFixture"),
      editor = fixture.controller.editor;
    return {
      snapshot: fixture.controller.getSnapshot(),
      values: [...editor.view.dom.querySelectorAll("ol > li")].map((item) => (item as HTMLLIElement).value),
      texts: [...editor.view.dom.querySelectorAll("ol > li p")].map((item) => item.textContent),
      selection: editor.state.selection.$from.parent.textContent,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
    };
  });
}
export async function historySequence(page: Page, action: "undo" | "redo") {
  expect(
    await page.evaluate(
      (action) => window.__semloRequireFixture("sequenceFixture").controller.editor.commands[action](),
      action,
    ),
  ).toBe(true);
  await settleSequence(page);
}
export async function numberingMenu(page: Page, text: string, action?: "重新编号" | "继续编号") {
  await page.getByRole("button", { name: `设置列表编号：${text}`, exact: true }).click();
  const menu = page.getByRole("menu", { name: "设置列表编号", exact: true });
  if (action) await menu.getByRole("menuitem", { name: action, exact: true }).click();
  return menu;
}
