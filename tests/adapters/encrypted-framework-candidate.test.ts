import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
let origin: string;
let closeServer: () => Promise<void>;
test.beforeEach(async ({ page }) => installFixtureGuards(page));
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/cards/encrypted-framework-fixture.ts" },
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());
for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} propagates provider changes to its editor`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
    await page.goto(origin);
    try {
      await page.waitForFunction(() => typeof (window as any).mountEncryptedFramework === "function", null, {
        timeout: 3000,
      });
    } catch {
      throw new Error(`Framework fixture failed to load: ${pageErrors.join("; ")}`);
    }
    await page.evaluate(async (name) => {
      (window as any).frameworkEncrypted = await (window as any).mountEncryptedFramework(name);
    }, framework);
    const editor = page.locator("#framework-encrypted .semlo-editor-prose");
    await editor.locator("p").click();
    await page.keyboard.type("/jm");
    let command = page.getByRole("option", { name: /加密文本/ });
    await expect(command).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window as any).frameworkEncrypted.enable());
    await expect
      .poll(async () => page.evaluate(() => (window as any).frameworkEncrypted.controller.editor.isEditable))
      .toBe(true);
    await editor.locator("p").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/jm");
    command = page.getByRole("option", { name: /加密文本/ });
    await expect(command).toBeEnabled();
    await command.click();
    const dialog = page.getByRole("dialog", { name: "新建加密文本" });
    await dialog.getByLabel("密码").fill("example");
    await dialog.getByLabel("加密文本内容").fill("framework secret");
    await dialog.getByRole("button", { name: "加密并保存" }).click();
    await expect(dialog).toHaveCount(0);
    const snapshot = await page.evaluate(() =>
      JSON.stringify((window as any).frameworkEncrypted.controller.getSnapshot()),
    );
    expect(snapshot).not.toContain("framework secret");
    expect(snapshot).toContain("semloEditorEncryptedText");
  });
}
