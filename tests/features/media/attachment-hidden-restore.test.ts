import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    attachmentRestoreProbe?: {
      api: EditorController;
      pending: Array<{ name: string; reject: (error: Error) => void; resolve: (url: string) => void }>;
      unhandled: string[];
    };
  }
}

test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const withRemount of [false, true]) {
  test(`failed cleanup remains invalid through pending sibling restore (remount=${withRemount})`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'restore-probe'; document.body.append(host);
      const pending = [], unhandled = []; let blockCleanup = false;
      window.addEventListener('unhandledrejection', event => { unhandled.push(event.reason.name); event.preventDefault() });
      const api = createEditor({ element: host, outline: false, content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const x = 1' }] }] },
        uploadAttachment: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })),
        onError: () => { blockCleanup = true; throw new Error('宿主报错') } });
      api.editor.on('beforeTransaction', () => { if (blockCleanup) { blockCleanup = false; throw new Error('清理报错') } });
      window.attachmentRestoreProbe = { api, pending, unhandled };
    `,
    });
    const host = page.locator("#restore-probe");
    await page.waitForFunction(() => Boolean(window.attachmentRestoreProbe));
    await expect(host.locator(".semlo-editor-code-card")).toContainText("const x = 1");
    await host.locator('input[type="file"][multiple]').setInputFiles([
      { name: "failed.txt", mimeType: "text/plain", buffer: Buffer.from("failed") },
      { name: "stale.txt", mimeType: "text/plain", buffer: Buffer.from("stale") },
    ]);
    await host
      .locator('input[type="file"][multiple]')
      .setInputFiles({ name: "live.txt", mimeType: "text/plain", buffer: Buffer.from("live") });
    await page.waitForFunction(() => window.attachmentRestoreProbe?.pending.length === 2);
    await page.evaluate(() =>
      window.__semloRequireFixture("attachmentRestoreProbe").pending[0].reject(new Error("失败")),
    );
    await page.waitForFunction(() => window.attachmentRestoreProbe?.unhandled.length === 1, undefined, {
      timeout: 3000,
    });
    await expect(host.locator(".semlo-editor-uploading", { hasText: "stale.txt" })).toHaveCount(0);
    const stored = () =>
      page.evaluate(() => {
        const editor = window.__semloRequireFixture("attachmentRestoreProbe").api.editor;
        const plugin = editor.state.plugins.find((item) =>
          (item as unknown as { key: string }).key.startsWith("semlo-editor-attachment-upload"),
        );
        if (!plugin) throw new Error("Missing attachment plugin");
        const state = plugin.getState(editor.state) as {
          decorations: { find: () => Array<{ spec: { name: string } }> };
        };
        return state.decorations.find().map((item) => item.spec.name);
      });
    expect(await stored()).toContain("stale.txt");
    if (withRemount) {
      const remountTrace = await page.evaluate(() => {
        const editor = window.__semloRequireFixture("attachmentRestoreProbe").api.editor;
        const events: Array<{ changed: boolean }> = [];
        const record = ({ transaction }: { transaction: { docChanged: boolean } }) =>
          events.push({ changed: transaction.docChanged });
        editor.on("transaction", record);
        editor.unmount();
        editor.mount(window.__semloRequireValue(editor.options.element, "mount"));
        editor.off("transaction", record);
        return events;
      });
      await expect(host.locator(".semlo-editor-uploading", { hasText: "stale.txt" })).toHaveCount(0);
      console.log("remount transaction trace", JSON.stringify(remountTrace));
      expect(await stored()).not.toContain("stale.txt");
    }
    await page.evaluate(() =>
      window.__semloRequireFixture("attachmentRestoreProbe").pending[1].resolve("/files/live.txt"),
    );
    await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "live.txt" })).toHaveCount(1);
    expect(await stored()).not.toContain("stale.txt");
    await expect(host.locator(".semlo-editor-uploading", { hasText: "stale.txt" })).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("attachmentRestoreProbe").api.destroy());
  });
}

test("separate failed batches remain invalid while a third batch finishes", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'restore-probe'; document.body.append(host);
    const pending = [], unhandled = []; let blockCleanup = false;
    window.addEventListener('unhandledrejection', event => { unhandled.push(event.reason.name); event.preventDefault() });
    const api = createEditor({ element: host, outline: false, content: '<p></p>',
      uploadAttachment: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })),
      onError: () => { blockCleanup = true; throw new Error('宿主报错') } });
    api.editor.on('beforeTransaction', () => { if (blockCleanup) { blockCleanup = false; throw new Error('清理报错') } });
    window.attachmentRestoreProbe = { api, pending, unhandled };
  `,
  });
  const host = page.locator("#restore-probe");
  await page.waitForFunction(() => Boolean(window.attachmentRestoreProbe));
  const input = host.locator('input[type="file"][multiple]');
  await input.setInputFiles([
    { name: "failed-a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    { name: "stale-a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
  ]);
  await input.setInputFiles([
    { name: "failed-b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
    { name: "stale-b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
  ]);
  await input.setInputFiles({ name: "live.txt", mimeType: "text/plain", buffer: Buffer.from("live") });
  await page.waitForFunction(() => window.attachmentRestoreProbe?.pending.length === 3);
  await page.evaluate(() =>
    window.__semloRequireFixture("attachmentRestoreProbe").pending[0].reject(new Error("失败 A")),
  );
  await page.waitForFunction(() => window.attachmentRestoreProbe?.unhandled.length === 1, undefined, { timeout: 3000 });
  await page.evaluate(() =>
    window.__semloRequireFixture("attachmentRestoreProbe").pending[1].reject(new Error("失败 B")),
  );
  await page.waitForFunction(() => window.attachmentRestoreProbe?.unhandled.length === 2, undefined, { timeout: 3000 });
  await expect(host.locator(".semlo-editor-uploading", { hasText: "stale-a.txt" })).toHaveCount(0);
  await expect(host.locator(".semlo-editor-uploading", { hasText: "stale-b.txt" })).toHaveCount(0);
  await expect(host.locator(".semlo-editor-uploading", { hasText: "live.txt" })).toHaveCount(1);
  await page.evaluate(() =>
    window.__semloRequireFixture("attachmentRestoreProbe").pending[2].resolve("/files/live.txt"),
  );
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "live.txt" })).toHaveCount(1);
  const names = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("attachmentRestoreProbe").api.editor;
    const plugin = editor.state.plugins.find((item) =>
      (item as unknown as { key: string }).key.startsWith("semlo-editor-attachment-upload"),
    );
    if (!plugin) throw new Error("Missing attachment plugin");
    const state = plugin.getState(editor.state) as { decorations: { find: () => Array<{ spec: { name: string } }> } };
    return state.decorations.find().map((item) => item.spec.name);
  });
  expect(names).not.toContain("stale-a.txt");
  expect(names).not.toContain("stale-b.txt");
  await page.evaluate(() => window.__semloRequireFixture("attachmentRestoreProbe").api.destroy());
});
