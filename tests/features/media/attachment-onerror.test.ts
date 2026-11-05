import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    attachmentCleanupProbe?: {
      api: EditorController;
      pending: Array<{ name: string; reject: (error: Error) => void; resolve: (url: string) => void }>;
      reported: string[];
      unhandled: string[];
    };
  }
}

test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const mode of ["plain", "start", "replace", "readonly", "destroy", "unmount"] as const) {
  test(`a throwing onError cleans its attachment batch (${mode})`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'cleanup-probe'; document.body.append(host);
      const pending = [], reported = [], unhandled = [], mode = ${JSON.stringify(mode)};
      window.addEventListener('unhandledrejection', event => { unhandled.push(String(event.reason?.message ?? event.reason)); event.preventDefault() });
      const api = createEditor({ element: host, outline: false, content: '<p></p>',
        uploadAttachment: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })),
        onError: error => {
          reported.push(error.message);
          if (mode === 'start') {
            const input = host.querySelector('input[type="file"][multiple]');
            const transfer = new DataTransfer();
            transfer.items.add(new File(['other'], 'other.txt', { type: 'text/plain' }));
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (mode === 'replace') api.setContent('<p>新文档</p>');
          if (mode === 'readonly') api.setEditable(false);
          if (mode === 'destroy') api.destroy();
          if (mode === 'unmount') api.editor.unmount();
          throw new Error('宿主 onError 抛错');
        } });
      window.attachmentCleanupProbe = { api, pending, reported, unhandled };
    `,
    });
    const host = page.locator("#cleanup-probe");
    await page.waitForFunction(() => Boolean(window.attachmentCleanupProbe));
    await host.locator('input[type="file"][multiple]').setInputFiles([
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);
    await page.waitForFunction(() => window.attachmentCleanupProbe?.pending.length === 1);
    if (mode === "plain") {
      await host
        .locator('input[type="file"][multiple]')
        .setInputFiles({ name: "other.txt", mimeType: "text/plain", buffer: Buffer.from("other") });
      await page.waitForFunction(() => window.attachmentCleanupProbe?.pending.length === 2);
    }
    await page.evaluate(() =>
      window.__semloRequireFixture("attachmentCleanupProbe").pending[0].reject(new Error("上传失败")),
    );
    await page.waitForFunction(() => window.attachmentCleanupProbe?.unhandled.length === 1, undefined, {
      timeout: 3000,
    });
    const state = await page.evaluate(() => {
      const probe = window.__semloRequireFixture("attachmentCleanupProbe");
      return { started: probe.pending.map((item) => item.name), reported: probe.reported, unhandled: probe.unhandled };
    });
    expect(state).toEqual({
      started: mode === "plain" || mode === "start" ? ["first.txt", "other.txt"] : ["first.txt"],
      reported: ["上传失败"],
      unhandled: ["宿主 onError 抛错"],
    });
    if (mode === "unmount") {
      await page.evaluate(() => {
        const { editor } = window.__semloRequireFixture("attachmentCleanupProbe").api;
        editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
      });
    }
    await expect(host.locator(".semlo-editor-uploading", { hasText: "second.txt" })).toHaveCount(0);
    await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "second.txt" })).toHaveCount(0);
    if (mode === "plain" || mode === "start") {
      await expect(host.locator(".semlo-editor-uploading", { hasText: "other.txt" })).toHaveCount(1);
      await page.evaluate(() =>
        window.__semloRequireFixture("attachmentCleanupProbe").pending[1].resolve("/files/other.txt"),
      );
      await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "other.txt" })).toHaveCount(1);
    }
    if (mode === "replace") await expect(host.locator(".semlo-editor-prose")).toContainText("新文档");
    if (mode !== "destroy")
      await page.evaluate(() => window.__semloRequireFixture("attachmentCleanupProbe").api.destroy());
  });
}
