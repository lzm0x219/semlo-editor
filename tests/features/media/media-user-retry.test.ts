import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    retryProbe: {
      controller: EditorController;
      calls: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }>;
      reported: string[];
    };
  }
}

for (const kind of ["attachment", "audio", "video"] as const) {
  test(`${kind}: failed upload can be retried with the same file`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js';
        const host = document.createElement('div'); host.id = 'retry-probe'; document.body.append(host);
        const calls = [], reported = [];
        const controller = createEditor({ element: host, outline: false, content: '<p></p>',
          uploadAttachment: () => new Promise((resolve, reject) => calls.push({resolve,reject})),
          onError: error => reported.push(error.message) });
        window.retryProbe = { controller, calls, reported };
      `,
    });
    await page.waitForFunction(() => Boolean(window.retryProbe));
    const host = page.locator("#retry-probe");
    const input =
      kind === "attachment"
        ? host.locator('input[type="file"][multiple]')
        : host.locator(`input[data-semlo-editor-media-input="${kind}"]`);
    const name = kind === "attachment" ? "retry.txt" : kind === "audio" ? "retry.wav" : "retry.mp4";
    const mimeType = kind === "attachment" ? "text/plain" : kind === "audio" ? "audio/wav" : "video/mp4";
    const file = { name, mimeType, buffer: Buffer.from("local fixture") };
    await input.setInputFiles(file);
    await page.waitForFunction(() => window.retryProbe.calls.length === 1);
    await page.evaluate(() => window.retryProbe.calls[0].reject(new Error("上传失败：请重试")));
    await expect(host.locator('[role="alert"]')).toHaveText("上传失败：请重试");
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
    await input.setInputFiles(file);
    await page.waitForFunction(() => window.retryProbe.calls.length === 2);
    await page.evaluate((fileName) => window.retryProbe.calls[1].resolve(`/files/${fileName}`), name);
    if (kind === "attachment") await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText(name);
    else await expect(host.locator(kind)).toHaveAttribute("src", `/files/${name}`);
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
    expect(await page.evaluate(() => window.retryProbe.reported)).toEqual(["上传失败：请重试"]);
    await expect(host.locator('[role="alert"]')).toBeVisible();
    const dismiss = host.getByRole("button", { name: "关闭错误提示" });
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(host.locator('[role="alert"]')).toBeHidden();
    await input.setInputFiles(file);
    await page.waitForFunction(() => window.retryProbe.calls.length === 3);
    await page.evaluate(() => window.retryProbe.calls[2].reject(new Error("再次失败")));
    await expect(host.locator('[role="alert"]')).toHaveText("再次失败");
    await page.evaluate(() => window.retryProbe.controller.destroy());
  });
}

test("a different pending upload finishing leaves the latest reported failure visible", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'retry-probe'; document.body.append(host);
    const calls = [], reported = [];
    const controller = createEditor({ element: host, outline: false, content: '<p></p>',
      uploadAttachment: file => new Promise((resolve, reject) => calls.push({name:file.name,resolve,reject})),
      onError: error => reported.push(error.message) });
    window.retryProbe = { controller, calls, reported };
  `,
  });
  await page.waitForFunction(() => Boolean(window.retryProbe));
  const host = page.locator("#retry-probe");
  const input = host.locator('input[type="file"][multiple]');
  await input.setInputFiles({ name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("a") });
  await input.setInputFiles({ name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("b") });
  await page.waitForFunction(() => window.retryProbe.calls.length === 2);
  await page.evaluate(() => window.retryProbe.calls[0].reject(new Error("first failure")));
  await expect(host.locator('[role="alert"]')).toHaveText("first failure");
  await page.evaluate(() => window.retryProbe.calls[1].resolve("/files/second.txt"));
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText("second.txt");
  await expect(host.locator('[role="alert"]')).toBeVisible();
  await expect(host.locator('[role="alert"]')).toHaveText("first failure");
  await input.setInputFiles({ name: "third.txt", mimeType: "text/plain", buffer: Buffer.from("c") });
  await page.waitForFunction(() => window.retryProbe.calls.length === 3);
  await page.evaluate(() => window.retryProbe.calls[2].reject(new Error("third failure")));
  await expect(host.locator('[role="alert"]')).toHaveText("third failure");
  await host.getByRole("button", { name: "关闭错误提示" }).click();
  await expect(host.locator('[role="alert"]')).toBeHidden();
  expect(await page.evaluate(() => window.retryProbe.reported)).toEqual(["first failure", "third failure"]);
  await page.evaluate(() => window.retryProbe.controller.destroy());
});

test("destroying with an error and a pending upload ignores its late failure", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'retry-probe'; document.body.append(host);
    const calls = [], reported = [];
    const controller = createEditor({ element: host, outline: false, content: '<p></p>',
      uploadAttachment: () => new Promise((resolve, reject) => calls.push({resolve,reject})),
      onError: error => reported.push(error.message) });
    window.retryProbe = { controller, calls, reported };
  `,
  });
  await page.waitForFunction(() => Boolean(window.retryProbe));
  const host = page.locator("#retry-probe");
  const input = host.locator('input[type="file"][multiple]');
  await input.setInputFiles({ name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("a") });
  await input.setInputFiles({ name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("b") });
  await page.waitForFunction(() => window.retryProbe.calls.length === 2);
  await page.evaluate(() => window.retryProbe.calls[0].reject(new Error("first failure")));
  await expect(host.locator('[role="alert"]')).toHaveText("first failure");
  await page.evaluate(() => {
    window.retryProbe.controller.destroy();
    window.retryProbe.calls[1].reject(new Error("late failure"));
  });
  await expect(host.locator('[role="alert"]')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => window.retryProbe.reported)).toEqual(["first failure"]);
});

test("closing an error while the editor view is unmounted is safe and survives remount", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'retry-probe'; document.body.append(host);
    const calls = [], reported = [];
    const controller = createEditor({ element: host, outline: false, content: '<p></p>',
      uploadAttachment: () => new Promise((resolve, reject) => calls.push({resolve,reject})),
      onError: error => reported.push(error.message) });
    window.retryProbe = { controller, calls, reported };
  `,
  });
  await page.waitForFunction(() => Boolean(window.retryProbe));
  const host = page.locator("#retry-probe");
  const input = host.locator('input[type="file"][multiple]');
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await input.setInputFiles({ name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("a") });
  await page.waitForFunction(() => window.retryProbe.calls.length === 1);
  await page.evaluate(() => window.retryProbe.calls[0].reject(new Error("first failure")));
  await expect(host.locator('[role="alert"]')).toHaveText("first failure");
  await page.evaluate(() => window.retryProbe.controller.editor.unmount());
  await host.getByRole("button", { name: "关闭错误提示" }).click();
  await expect(host.locator('[role="alert"]')).toBeHidden();
  await page.evaluate(() => {
    const editor = window.retryProbe.controller.editor;
    editor.mount(editor.options.element as HTMLElement);
  });
  await expect(host.locator('[role="alert"]')).toBeHidden();
  expect(errors).toEqual([]);
  await page.evaluate(() => window.retryProbe.controller.destroy());
});
