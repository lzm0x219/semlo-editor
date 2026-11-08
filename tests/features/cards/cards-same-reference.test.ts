import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/cards-multi-editor-fixture.ts"));
});
afterAll(async () => closeServer?.());

for (const kind of ["semloEditorFormula", "semloEditorStatus"] as const) {
  test(`${kind}: same-reference replacement closes stale popup and prevents a stale write`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
    const host = page.locator('[data-editor-name="甲"]');
    const name = kind === "semloEditorFormula" ? "编辑公式" : "编辑状态";
    await host.getByRole("button", { name: kind === "semloEditorFormula" ? "公式：x" : "状态：甲状态" }).click();
    const dialog = page.getByRole("dialog", { name });
    if (kind === "semloEditorFormula") await dialog.getByLabel("TeX 公式").fill("stale formula");
    const result = await page.evaluate((nodeKind) => {
      const controller = window.__semloRequireFixture("cardMultiEditors")[0];
      const editor = controller.editor;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === nodeKind) pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, node);
      editor.view.dispatch(tr);
      const sameNode = editor.state.doc.nodeAt(pos) === node;
      const dialog = document.querySelector<HTMLElement>(
        nodeKind === "semloEditorFormula" ? ".semlo-editor-formula-editor" : ".semlo-editor-status-editor",
      );
      const wasOpen = !!dialog;
      if (nodeKind === "semloEditorFormula")
        dialog
          ?.querySelector("textarea")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else {
        const input = dialog?.querySelector("input");
        if (input) {
          input.value = "stale status";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return { sameNode, wasOpen, attrs: editor.state.doc.nodeAt(pos)!.attrs };
    }, kind);
    expect(result.sameNode).toBe(true);
    if (kind === "semloEditorFormula") expect(result.attrs.latex).toBe("x");
    else expect(result.attrs.label).toBe("甲状态");
    expect(result.wasOpen).toBe(false);
  });
}

for (const kind of ["semloEditorFormula", "semloEditorStatus"] as const) {
  test(`${kind}: adjacent edits, equal echoes, and rejected replacement keep the popup`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
    const host = page.locator('[data-editor-name="甲"]');
    await host.getByRole("button", { name: kind === "semloEditorFormula" ? "公式：x" : "状态：甲状态" }).click();
    const dialog = page.getByRole("dialog", { name: kind === "semloEditorFormula" ? "编辑公式" : "编辑状态" });
    const message = await page.evaluate((nodeKind) => {
      const controller = window.__semloRequireFixture("cardMultiEditors")[0];
      controller.setContent(controller.getSnapshot().json);
      const editor = controller.editor;
      editor.view.dispatch(editor.state.tr.insertText("邻", 1));
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === nodeKind) pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      const reject = () => {
        throw new Error("host rejected");
      };
      editor.on("beforeTransaction", reject);
      let message = "";
      try {
        editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, node));
      } catch (error) {
        message = (error as Error).message;
      } finally {
        editor.off("beforeTransaction", reject);
      }
      return message;
    }, kind);
    expect(message).toBe("host rejected");
    await expect(dialog).toBeVisible();
    if (kind === "semloEditorFormula") {
      await dialog.getByLabel("TeX 公式").fill("x+1");
      await dialog.getByRole("button", { name: "确定" }).click();
      await expect(host.getByRole("button", { name: "公式：x+1" })).toBeVisible();
    } else {
      await dialog.getByLabel("状态文字").fill("仍可编辑");
      await expect(host.getByRole("button", { name: "状态：仍可编辑" })).toBeVisible();
    }
  });
}

for (const kind of ["semloEditorFormula", "semloEditorStatus"] as const) {
  test(`${kind}: replacing one shared-reference node leaves another popup open`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.cardMultiEditors?.length === 2));
    const shared = await page.evaluate((nodeKind) => {
      const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
      const node =
        nodeKind === "semloEditorFormula"
          ? editor.schema.nodes.semloEditorFormula.create({ id: "same", latex: "x" })
          : editor.schema.nodes.semloEditorStatus.create({ label: "同状态", color: 0 });
      const paragraph = editor.schema.nodes.paragraph.create(null, [node, editor.schema.text("间隔"), node]);
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, paragraph));
      const nodes: unknown[] = [];
      editor.state.doc.descendants((candidate) => {
        if (candidate.type.name === nodeKind) nodes.push(candidate);
      });
      return nodes.length === 2 && nodes[0] === nodes[1];
    }, kind);
    expect(shared).toBe(true);
    const host = page.locator('[data-editor-name="甲"]');
    await host
      .getByRole("button", { name: kind === "semloEditorFormula" ? "公式：x" : "状态：同状态" })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: kind === "semloEditorFormula" ? "编辑公式" : "编辑状态" });
    await page.evaluate((nodeKind) => {
      const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
      const positions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === nodeKind) positions.push(pos);
      });
      const pos = positions[1];
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, node));
    }, kind);
    await expect(dialog).toBeVisible();
  });
}
