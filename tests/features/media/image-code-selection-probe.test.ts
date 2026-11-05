import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("code selection upload: pending, failure, undo and consecutive files", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'image-selection-probe'; document.body.append(host);
    window.errors = []; window.pending = [];
    const c = createEditor({ element: host, outline: false, content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'hello world' }] }] }, uploadImage: () => new Promise((resolve, reject) => window.pending.push({resolve,reject})), onError: e => window.errors.push(String(e)) });
    window.c = c;
  `,
  });
  await page.waitForFunction(() => Boolean((window as any).c));
  const insert = async () => {
    await page.evaluate(() => {
      (window as any).c.editor.commands.setTextSelection({ from: 1, to: 6 });
      (window as any).c.editor.commands.focus();
    });
    await page.locator("#image-selection-probe").getByRole("button", { name: "插入内容" }).click();
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="image"]')
      .click();
    const p = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "上传图片" }).click();
    const f = await p;
    await f.setFiles({ name: "one.png", mimeType: "image/png", buffer: Buffer.from("local") });
  };
  await insert();
  await page.waitForFunction(() => (window as any).pending.length === 1);
  const pending = await page.evaluate(() => (window as any).c.getSnapshot().json);
  await page.evaluate(() => (window as any).pending[0].reject(new Error("failed")));
  await page.waitForFunction(() => (window as any).errors.length > 0);
  const failed = await page.evaluate(() => (window as any).c.getSnapshot().json);
  await page.evaluate(() => (window as any).c.editor.commands.undo());
  const undone = await page.evaluate(() => (window as any).c.getSnapshot().json);
  const details = { pending: pending.content, failed: failed.content, undone: undone.content };
  console.log("SELECTION_SUMMARY", JSON.stringify(details));
  expect(pending.content[0].content?.[0].text).toBe("hello world");
  expect(failed.content[0].content?.[0].text).toBe("hello world");
  expect(undone.content[0].content?.[0].text).toBe("hello world");
  await insert();
  await page.waitForFunction(() => (window as any).pending.length === 2);
  await insert();
  await page.waitForFunction(() => (window as any).pending.length === 3);
  await page.evaluate(() => (window as any).pending[2].resolve("https://example.com/second.png"));
  await expect(page.locator('#image-selection-probe img[src="https://example.com/second.png"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).pending[1].resolve("https://example.com/first.png"));
  await expect(page.locator('#image-selection-probe img[src="https://example.com/first.png"]')).toHaveCount(1);
  await expect(page.locator('#image-selection-probe img[src="https://example.com/second.png"]')).toHaveCount(1);
  const final = await page.evaluate(() => (window as any).c.getSnapshot().json);
  expect(final.content[0].content[0].text).toBe("hello world");
  await page.evaluate(() => (window as any).c.editor.commands.undo());
  const successUndo = await page.evaluate(() => (window as any).c.getSnapshot().json);
  expect(successUndo.content[0].content[0].text).toBe("hello world");
});
