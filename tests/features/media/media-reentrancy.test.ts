import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const kind of ["audio", "video"] as const) {
  test(`${kind} removal tolerates synchronous controller destruction`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.append(host);
      window.mediaIsolationEditor = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: '${kind === "audio" ? "semloEditorAudio" : "semloEditorVideo"}', attrs: { src: '/files/test', name: 'test' } }]
      }});
    `,
    });
    await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
    await page.evaluate(() => {
      const api = window.__semloRequireFixture("mediaIsolationEditor");
      api.editor.once("update", () => api.destroy());
    });
    await page
      .locator("#media-isolated")
      .getByRole("button", { name: kind === "audio" ? "删除音频" : "删除视频" })
      .click();
    expect(errors).toEqual([]);
    await expect(page.locator("#media-isolated .semlo-editor")).toHaveCount(0);
  });
  test(`${kind} controls track read-only after view remount`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.append(host);
      window.mediaIsolationEditor = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: '${kind === "audio" ? "semloEditorAudio" : "semloEditorVideo"}', attrs: { src: '/files/test', name: 'test' } }]
      }});
    `,
    });
    await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
    await page.evaluate(() => {
      const api = window.__semloRequireFixture("mediaIsolationEditor");
      const editor = api.editor;
      editor.unmount();
      editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
      api.setEditable(false);
    });
    const remove = page
      .locator("#media-isolated")
      .getByRole("button", { name: kind === "audio" ? "删除音频" : "删除视频", includeHidden: true });
    await expect(remove).toBeHidden();
    await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").setEditable(true));
    await expect(remove).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
  });
}
