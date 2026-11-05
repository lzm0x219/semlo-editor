import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imageFirstRemoval: {
      api: EditorController;
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
      uploadImage: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })),
      onError: e => reported.push(e.message) });
    api.editor.on('beforeTransaction', () => { if (block) { block--; throw new Error('remove failure') } });
    window.imageFirstRemoval = { api, pending, errors, reported, arm: count => { block = count } };
  `,
    });
    await page.waitForFunction(() => Boolean(window.imageFirstRemoval));
    const host = page.locator("#probe");
    await page.evaluate(() => {
      const paste = (names: string[]) => {
        const transfer = new DataTransfer();
        for (const name of names) transfer.items.add(new File(["image"], name, { type: "image/png" }));
        window.imageFirstRemoval.api.editor.view.dom.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
        );
      };
      paste(["failed.png", "stale.png"]);
      paste(["live.png"]);
    });
    await page.waitForFunction(() => window.imageFirstRemoval?.pending.length === 2);
    await page.evaluate((count) => {
      const p = window.imageFirstRemoval;
      p.arm(count);
      p.pending[0].reject(new Error("upload failure"));
    }, failures);
    await page.waitForFunction(() => window.imageFirstRemoval?.errors.length === 1);
    const status = await page.evaluate(() => ({
      errors: window.imageFirstRemoval.errors,
      reported: window.imageFirstRemoval.reported,
      texts: Array.from(document.querySelectorAll("#probe .semlo-editor-uploading")).map((x) => x.textContent),
    }));
    console.log("FIRST_REMOVAL_OBSERVED", JSON.stringify(status));
    await expect(host.locator(".semlo-editor-uploading", { hasText: "failed.png" })).toHaveCount(0);
    await expect(host.locator(".semlo-editor-uploading", { hasText: "stale.png" })).toHaveCount(0);
    await expect(host.locator(".semlo-editor-uploading", { hasText: "live.png" })).toHaveCount(1);
    expect(JSON.stringify(status.errors[0])).toContain("remove failure");
    if (failures === 2) expect(status.errors[0].name).toBe("AggregateError");
    expect(status.reported).toEqual([]);
    await page.evaluate(() => window.imageFirstRemoval.pending[1].resolve("/files/live.png"));
    await expect(host.locator('img[alt="live.png"]')).toHaveCount(1);
  });
