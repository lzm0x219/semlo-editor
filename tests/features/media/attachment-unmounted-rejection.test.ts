import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    attachmentRejectionProbe?: {
      api: EditorController;
      pending: Array<{ reject: (error: Error) => void; resolve: (url: string) => void }>;
      errors: string[];
    };
  }
}

test("an upload rejected while unmounted reports and resumes its queue on remount", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'reject-probe'; document.body.append(host);
    const pending = [], errors = [];
    const api = createEditor({ element: host, outline: false, content: '<p></p>',
      uploadAttachment: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      onError: error => errors.push(error.message) });
    window.attachmentRejectionProbe = { api, pending, errors };
  `,
  });
  const host = page.locator("#reject-probe");
  await page.waitForFunction(() => Boolean(window.attachmentRejectionProbe));
  await host.locator('input[type="file"][multiple]').setInputFiles([
    { name: "failed.txt", mimeType: "text/plain", buffer: Buffer.from("failed") },
    { name: "next.txt", mimeType: "text/plain", buffer: Buffer.from("next") },
  ]);
  await page.waitForFunction(() => window.attachmentRejectionProbe?.pending.length === 1);
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("attachmentRejectionProbe");
    fixture.api.editor.unmount();
    fixture.pending[0].reject(new Error("上传失败"));
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__semloRequireFixture("attachmentRejectionProbe").errors)).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("attachmentRejectionProbe").pending.length)).toBe(1);
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("attachmentRejectionProbe").api;
    editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
  });
  await page.waitForFunction(() => window.attachmentRejectionProbe?.pending.length === 2);
  expect(await page.evaluate(() => window.__semloRequireFixture("attachmentRejectionProbe").errors)).toEqual([
    "上传失败",
  ]);
  await page.evaluate(() =>
    window.__semloRequireFixture("attachmentRejectionProbe").pending[1].resolve("/files/next.txt"),
  );
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText("next.txt");
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("attachmentRejectionProbe").api.destroy());
});
