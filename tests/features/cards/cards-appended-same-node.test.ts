import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/cards/cards-appended-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

for (const kind of ["semloEditorFormula", "semloEditorStatus"] as const) {
  test(`${kind}: appended same-reference replacement prevents stale popup writes`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() =>
      Boolean(window.cardMultiEditors?.length === 2 && Reflect.get(window, "appendSameCardNode")),
    );
    const host = page.locator('[data-editor-name="甲"]');
    await host.getByRole("button", { name: kind === "semloEditorFormula" ? "公式：x" : "状态：甲状态" }).click();
    const dialog = page.getByRole("dialog", { name: kind === "semloEditorFormula" ? "编辑公式" : "编辑状态" });
    if (kind === "semloEditorFormula") await dialog.getByLabel("TeX 公式").fill("stale formula");
    const result = await page.evaluate((nodeKind) => {
      const c = window.__semloRequireFixture("cardMultiEditors")[0];
      let pos = -1;
      c.editor.state.doc.descendants((node, at) => {
        if (node.type.name === nodeKind) pos = at;
      });
      const before = c.editor.state.doc.nodeAt(pos)!;
      Reflect.apply(Reflect.get(window, "appendSameCardNode"), window, [nodeKind]);
      const sameNode = c.editor.state.doc.nodeAt(pos) === before;
      const panel = document.querySelector<HTMLElement>(
        nodeKind === "semloEditorFormula" ? ".semlo-editor-formula-editor" : ".semlo-editor-status-editor",
      );
      const wasOpen = !!panel;
      if (nodeKind === "semloEditorFormula")
        panel?.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else {
        const input = panel?.querySelector("input");
        if (input) {
          input.value = "stale status";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return { sameNode, wasOpen, attrs: c.editor.state.doc.nodeAt(pos)!.attrs };
    }, kind);
    expect(result.sameNode).toBe(true);
    if (kind === "semloEditorFormula") expect(result.attrs.latex).toBe("x");
    else expect(result.attrs.label).toBe("甲状态");
    expect(result.wasOpen).toBe(false);
  });
}

for (const kind of ["semloEditorDate", "semloEditorCalendar"] as const) {
  test(`${kind}: appended same-reference replacement prevents stale popup writes`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() =>
      Boolean(window.cardMultiEditors?.length === 2 && Reflect.get(window, "appendSameCardNode")),
    );
    const host = page.locator('[data-editor-name="甲"]');
    await host
      .getByRole("button", { name: kind === "semloEditorDate" ? "日期：2026-11-03" : "日程：甲日程" })
      .first()
      .click();
    const result = await page.evaluate((nodeKind) => {
      const c = window.__semloRequireFixture("cardMultiEditors")[0];
      let pos = -1;
      c.editor.state.doc.descendants((node, at) => {
        if (node.type.name === nodeKind) pos = at;
      });
      const before = c.editor.state.doc.nodeAt(pos)!;
      Reflect.apply(Reflect.get(window, "appendSameCardNode"), window, [nodeKind]);
      const sameNode = c.editor.state.doc.nodeAt(pos) === before;
      const panel = document.querySelector<HTMLElement>(
        nodeKind === "semloEditorDate" ? ".semlo-editor-date-picker" : ".semlo-editor-calendar-event-editor",
      );
      const wasOpen = !!panel;
      if (nodeKind === "semloEditorDate") panel?.querySelector<HTMLButtonElement>('[aria-label="2026-11-05"]')?.click();
      else {
        const title = panel?.querySelector<HTMLTextAreaElement>('[aria-label="日程标题"]');
        if (title) {
          title.value = "stale calendar";
          title.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return { sameNode, wasOpen, attrs: c.editor.state.doc.nodeAt(pos)!.attrs };
    }, kind);
    expect(result.sameNode).toBe(true);
    if (kind === "semloEditorDate") expect(result.attrs.date).toBe("2026-11-03");
    else expect(result.attrs.events[0].title).toBe("甲日程");
    expect(result.wasOpen).toBe(false);
  });
}

for (const kind of ["semloEditorFormula", "semloEditorStatus", "semloEditorDate", "semloEditorCalendar"] as const) {
  test(`${kind}: an appended same-node replacement remains detected when the root shifts its position`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(origin);
    await page.waitForFunction(() =>
      Boolean(window.cardMultiEditors?.length === 2 && Reflect.get(window, "appendSameCardNode")),
    );
    const host = page.locator('[data-editor-name="甲"]');
    const buttonName =
      kind === "semloEditorFormula"
        ? "公式：x"
        : kind === "semloEditorStatus"
          ? "状态：甲状态"
          : kind === "semloEditorDate"
            ? "日期：2026-11-03"
            : "日程：甲日程";
    const dialogName =
      kind === "semloEditorFormula"
        ? "编辑公式"
        : kind === "semloEditorStatus"
          ? "编辑状态"
          : kind === "semloEditorDate"
            ? "选择日期"
            : "编辑日程";
    await host.getByRole("button", { name: buttonName }).first().click();
    const dialog = page.getByRole("dialog", { name: dialogName });
    const result = await page.evaluate((nodeKind) => {
      const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
      let original: unknown;
      editor.state.doc.descendants((node) => {
        if (node.type.name === nodeKind) original = node;
      });
      Reflect.apply(Reflect.get(window, "appendSameCardNode"), window, [nodeKind, true]);
      let same = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === nodeKind) same = node === original;
      });
      return { same, text: editor.state.doc.textContent };
    }, kind);
    expect(result.same).toBe(true);
    expect(result.text).toContain("前");
    await expect(dialog).toHaveCount(0);
  });
}
