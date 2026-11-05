import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    attachmentHiddenProbe?: {
      api: EditorController;
      pending: Array<{ name: string; reject: (error: Error) => void; resolve: (url: string) => void }>;
      unhandled: Array<{ host: boolean; cleanup: boolean; plugin: boolean }>;
      getBefore: () => string;
      getSelection: () => string;
      changes: () => { before: number; now: number };
    };
  }
}

test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const mode of ["normal", "write", "throw", "unmount", "destroy"] as const) {
  test(`failed cleanup visual invalidation survives plugin update (${mode})`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'hidden-probe'; document.body.append(host);
      const pending = [], unhandled = [], hostError = new Error('宿主报错'), cleanupError = new Error('清理事务报错'), pluginError = new Error('插件更新报错');
      const mode = ${JSON.stringify(mode)};
      let duringCleanup = false, onRedraw = false, before = '', selection = '', changes = 0, beforeChanges = 0;
      const contains = (error, target) => error === target || (Array.isArray(error?.errors) && error.errors.some(e => contains(e, target)));
      window.addEventListener('unhandledrejection', event => {
        unhandled.push({ host: contains(event.reason, hostError), cleanup: contains(event.reason, cleanupError), plugin: contains(event.reason, pluginError) });
        event.preventDefault();
      });
      const api = createEditor({ element: host, outline: false, content: '<p></p>',
        uploadAttachment: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })),
        onChange: () => { changes++; },
        onError: () => { before = JSON.stringify(api.getSnapshot().json); selection = JSON.stringify(api.editor.state.selection.toJSON()); beforeChanges = changes; duringCleanup = true; throw hostError; } });
      api.editor.on('beforeTransaction', () => { if (duringCleanup) { duringCleanup = false; onRedraw = true; throw cleanupError; } });
      const Plugin = api.editor.state.plugins[0].constructor;
      api.editor.registerPlugin(new Plugin({ view() { return { update(view) {
        if (!onRedraw) return;
        onRedraw = false;
        if (mode === 'write') view.dispatch(view.state.tr.insertText('插件写入', 1));
        if (mode === 'throw') throw pluginError;
        if (mode === 'unmount') api.editor.unmount();
        if (mode === 'destroy') api.destroy();
      } } } }));
      window.attachmentHiddenProbe = { api, pending, unhandled, getBefore: () => before, getSelection: () => selection, changes: () => ({ before: beforeChanges, now: changes }) };
    `,
    });
    const host = page.locator("#hidden-probe");
    await page.waitForFunction(() => Boolean(window.attachmentHiddenProbe));
    await host.locator('input[type="file"][multiple]').setInputFiles([
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);
    await host
      .locator('input[type="file"][multiple]')
      .setInputFiles({ name: "other.txt", mimeType: "text/plain", buffer: Buffer.from("other") });
    await page.waitForFunction(() => window.attachmentHiddenProbe?.pending.length === 2);
    await page.evaluate(() =>
      window.__semloRequireFixture("attachmentHiddenProbe").pending[0].reject(new Error("上传失败")),
    );
    await page.waitForFunction(() => window.attachmentHiddenProbe?.unhandled.length === 1, undefined, {
      timeout: 3000,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("attachmentHiddenProbe").unhandled)).toEqual([
      { host: true, cleanup: true, plugin: mode === "throw" },
    ]);
    if (mode === "destroy") {
      await expect(host.locator(".semlo-editor")).toHaveCount(0);
      return;
    }
    if (mode === "unmount") {
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("attachmentHiddenProbe").api.editor;
        editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
      });
    }
    await expect(host.locator(".semlo-editor-uploading", { hasText: "second.txt" })).toHaveCount(0);
    await expect(host.locator(".semlo-editor-uploading", { hasText: "other.txt" })).toHaveCount(1);
    const counts = await page.evaluate(() => window.__semloRequireFixture("attachmentHiddenProbe").changes());
    expect(counts.now - counts.before).toBe(mode === "write" ? 1 : 0);
    if (mode === "write") await expect(host.locator(".semlo-editor-prose")).toContainText("插件写入");
    else
      expect(
        await page.evaluate(() => {
          const probe = window.__semloRequireFixture("attachmentHiddenProbe");
          return (
            JSON.stringify(probe.api.getSnapshot().json) === probe.getBefore() &&
            JSON.stringify(probe.api.editor.state.selection.toJSON()) === probe.getSelection()
          );
        }),
      ).toBe(true);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("attachmentHiddenProbe").api.editor;
      editor.unmount();
      editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
      editor.commands.insertContent("额外编辑");
      editor.commands.undo();
    });
    await expect(host.locator(".semlo-editor-uploading", { hasText: "second.txt" })).toHaveCount(0);
    await expect(host.locator(".semlo-editor-uploading", { hasText: "other.txt" })).toHaveCount(1);
    const stored = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("attachmentHiddenProbe").api.editor;
      const plugin = editor.state.plugins.find((item) =>
        (item as unknown as { key: string }).key.startsWith("semlo-editor-attachment-upload"),
      );
      if (!plugin) throw new Error("Missing attachment plugin");
      const state = plugin.getState(editor.state) as { decorations: { find: () => Array<{ spec: { name: string } }> } };
      return state.decorations.find().map((item) => item.spec.name);
    });
    expect(stored).not.toContain("second.txt");
    expect(stored).toContain("other.txt");
    await page.evaluate(() =>
      window.__semloRequireFixture("attachmentHiddenProbe").pending[1].resolve("/files/other.txt"),
    );
    await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "other.txt" })).toHaveCount(1);
    await page.evaluate(() => window.__semloRequireFixture("attachmentHiddenProbe").api.destroy());
  });
}
