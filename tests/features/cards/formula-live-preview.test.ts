import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { Transaction } from "@tiptap/pm/state";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/cards-multi-editor-fixture.ts"));
});
afterAll(async () => closeServer?.());
for (const method of ["Escape", "outside"] as const)
  test(`formula candidate ${method} cannot emit stale edit during beforeTransaction`, async ({ page }) => {
    await installFixtureGuards(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
    await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
    await page.getByRole("dialog", { name: "编辑公式" }).getByLabel("TeX 公式").fill("x+1");
    const result = await page.evaluate((method) => {
      const c = window.__semloRequireFixture("cardMultiEditors")[0];
      const editor = c.editor;
      const observed: string[] = [];
      editor.on("update", () =>
        observed.push(
          String(c.getSnapshot().json.content![1].content!.find((n) => n.type === "semloEditorFormula")!.attrs!.latex),
        ),
      );
      const handler = ({ transaction }: { transaction: Transaction }) => {
        if (transaction.getMeta("probe")) {
          if (method === "Escape")
            document
              .querySelector<HTMLTextAreaElement>(".semlo-editor-formula-editor textarea")!
              .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          else document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        }
      };
      editor.on("beforeTransaction", handler);
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorFormula") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      const replacement = editor.schema.nodes.semloEditorFormula.create({ id: "replacement", latex: "z" });
      let caught = "";
      try {
        editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, replacement).setMeta("probe", true));
      } catch (error) {
        caught = (error as Error).name;
      }
      editor.off("beforeTransaction", handler);
      return {
        observed,
        caught,
        value: c.getSnapshot().json.content![1].content!.find((n) => n.type === "semloEditorFormula")!.attrs!.latex,
      };
    }, method);
    expect(result).toEqual({ observed: ["z"], caught: "", value: "z" });
    await expect(page.getByRole("dialog", { name: "编辑公式" })).toHaveCount(0);
    expect(pageErrors).toHaveLength(1);
    expect(pageErrors[0]).toContain("transaction cannot be dispatched");
  });
for (const action of ["confirm", "Escape", "outside"] as const)
  test(`formula candidate normal ${action}`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
    const first = page.locator('[data-editor-name="甲"]');
    await first.getByRole("button", { name: "公式：x", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "编辑公式" });
    const input = panel.getByLabel("TeX 公式");
    await input.fill("x+1");
    await expect(first.getByRole("button", { name: "公式：x+1", exact: true })).toBeVisible();
    const previous = await page.evaluate(
      () =>
        window
          .__semloRequireFixture("cardMultiEditors")[0]
          .getSnapshot()
          .json.content![1].content!.find((n) => n.type === "semloEditorFormula")!.attrs!.latex,
    );
    expect(previous).toBe("x");
    await expect(panel.getByRole("button", { name: "取消" })).toHaveCount(0);
    if (action === "confirm") await panel.getByRole("button", { name: "确定" }).click();
    else if (action === "Escape") await input.press("Escape");
    else await page.mouse.click(0, 0);
    await expect(panel).toHaveCount(0);
    const expected = "x+1";
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireFixture("cardMultiEditors")[0]
            .getSnapshot()
            .json.content![1].content!.find((n) => n.type === "semloEditorFormula")!.attrs!.latex,
      ),
    ).toBe(expected);
    await expect(first.getByRole("button", { name: `公式：${expected}`, exact: true })).toBeVisible();
  });
test("formula saved with Escape supports undo and redo", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x", exact: true }).click();
  const input = page.getByRole("dialog", { name: "编辑公式" }).getByLabel("TeX 公式");
  await input.fill("x+1");
  await input.press("Escape");
  await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].editor.commands.undo());
  await expect(first.getByRole("button", { name: "公式：x", exact: true })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].editor.commands.redo());
  await expect(first.getByRole("button", { name: "公式：x+1", exact: true })).toBeVisible();
});
