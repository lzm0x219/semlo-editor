import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    fullscreenStateEditors?: EditorController[];
  }
}

test("fullscreen persists for equal controlled content but resets for a different database", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "fullscreenStateContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    window.fullscreenStateEditors=[]
    for (let index=0;index<2;index++) {
      const host=document.createElement('div');host.id='fullscreen-state-'+index;document.body.prepend(host)
      window.fullscreenStateEditors.push(createEditor({element:host,outline:false,content:window.fullscreenStateContent}))
    }
  `,
  });
  const first = page.locator("#fullscreen-state-0 .semlo-editor-database");
  const second = page.locator("#fullscreen-state-1 .semlo-editor-database");
  await first.getByRole("button", { name: "全屏", exact: true }).click();
  await expect(first).toHaveClass(/is-maximized/);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("fullscreenStateEditors")[0];
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(first).toHaveClass(/is-maximized/);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("fullscreenStateEditors")[0];
    const replacement = editor.getSnapshot().json;
    replacement.content![0].attrs!.data.id = "different-database";
    editor.setContent(replacement);
  });
  await expect(first).not.toHaveClass(/is-maximized/);
  await expect(first.getByRole("button", { name: "全屏", exact: true })).toBeVisible();
  await expect(second).not.toHaveClass(/is-maximized/);
});
