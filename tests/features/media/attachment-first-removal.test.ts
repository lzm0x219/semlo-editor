import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    firstRemoval: {
      pending: Array<{ resolve: (url: string) => void; reject: (error: Error) => void }>;
      errors: Array<{ name: string; message: string }>;
      reported: string[];
      arm: (count: number) => void;
    };
  }
}

for (const failures of [1, 2])
  test(`first removal transaction failure clears only failed batch (failures=${failures})`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'probe'; document.body.append(host);
    const pending = [], errors = [], reported = []; let block = false;
    window.addEventListener('unhandledrejection', e => { errors.push({ name: e.reason.name, message: e.reason.message, details: (e.reason.errors || []).map(x => ({ name: x.name, message: x.message })) }); e.preventDefault() });
    const api = createEditor({ element: host, outline: false, content: '<p></p>',
      uploadAttachment: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })),
      onError: e => reported.push(e.message) });
    api.editor.on('beforeTransaction', () => { if (block) { block--; throw new Error('remove failure') } });
    window.firstRemoval = { api, pending, errors, reported, arm: count => { block = count } };
  `,
    });
    const host = page.locator("#probe");
    const input = host.locator('input[type="file"][multiple]');
    await input.setInputFiles([
      { name: "failed.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
      { name: "stale.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
    ]);
    await input.setInputFiles({ name: "live.txt", mimeType: "text/plain", buffer: Buffer.from("c") });
    await page.waitForFunction(() => window.firstRemoval?.pending.length === 2);
    await page.evaluate((count) => {
      const p = window.firstRemoval;
      p.arm(count);
      p.pending[0].reject(new Error("upload failure"));
    }, failures);
    await page.waitForFunction(() => window.firstRemoval?.errors.length === 1);
    const status = await page.evaluate(() => ({
      errors: window.firstRemoval.errors,
      reported: window.firstRemoval.reported,
      texts: Array.from(document.querySelectorAll("#probe .semlo-editor-uploading")).map((x) => x.textContent),
    }));
    console.log("FIRST_REMOVAL_OBSERVED", JSON.stringify(status));
    await expect(host.locator(".semlo-editor-uploading", { hasText: "failed.txt" })).toHaveCount(0);
    await expect(host.locator(".semlo-editor-uploading", { hasText: "stale.txt" })).toHaveCount(0);
    await expect(host.locator(".semlo-editor-uploading", { hasText: "live.txt" })).toHaveCount(1);
    expect(JSON.stringify(status.errors[0])).toContain("remove failure");
    if (failures === 2) expect(status.errors[0].name).toBe("AggregateError");
    expect(status.reported).toEqual([]);
    await page.evaluate(() => window.firstRemoval.pending[1].resolve("/files/live.txt"));
    await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "live.txt" })).toHaveCount(1);
  });
