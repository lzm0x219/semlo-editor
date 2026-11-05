import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

let origin: string;
let closeServer: () => Promise<void>;
test.beforeEach(async ({ page }) => installFixtureGuards(page));
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/cards/encrypted-text-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

test("fake provider inserts ciphertext while plaintext stays out of snapshots and history", async ({ page }) => {
  await page.goto(origin);
  const prose = page.locator("#encrypted-fixture .semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.type("/jm");
  await page.getByRole("option", { name: /加密文本/ }).click();
  const dialog = page.getByRole("dialog", { name: "新建加密文本" });
  await dialog.getByLabel("密码").fill("test-password");
  await dialog.getByLabel("加密文本内容").fill("敏感秘密 Alpha");
  const before = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  expect(before).not.toContain("敏感秘密 Alpha");
  await dialog.getByRole("button", { name: "加密并保存" }).click();
  await expect(dialog).toHaveCount(0);
  const state = await page.evaluate(() =>
    JSON.stringify({
      snapshot: (window as any).encryptedEditor.getSnapshot(),
      changes: (window as any).encryptedObservations,
    }),
  );
  expect(state).not.toContain("敏感秘密 Alpha");
  expect(state).not.toContain("test-password");
  await page.getByRole("button", { name: "解锁加密文本" }).click();
  const unlock = page.getByRole("dialog", { name: "解锁加密文本" });
  await unlock.getByLabel("密码").fill("test-password");
  await unlock.getByRole("button", { name: "解锁", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑加密文本" });
  await expect(edit.getByLabel("加密文本内容")).toHaveValue("敏感秘密 Alpha");
  await page.evaluate(() => {
    (window as any).failEncryption = true;
  });
  await edit.getByRole("button", { name: "加密并保存" }).click();
  await expect(edit.getByRole("status")).toContainText("加密失败");
  await expect(edit.getByLabel("加密文本内容")).toHaveValue("敏感秘密 Alpha");
  const after = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  expect(after).toBe(JSON.stringify(JSON.parse(state).snapshot));
  expect(after).not.toContain("敏感秘密 Alpha");
  await edit.getByRole("button", { name: "取消" }).click();
  await page.evaluate(() => (window as any).encryptedEditor.editor.commands.undo());
  await page.evaluate(() => (window as any).encryptedEditor.editor.commands.redo());
  const history = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  expect(history).not.toContain("敏感秘密 Alpha");
});

for (const action of ["destroy", "unmount", "replace"] as const) {
  test(`late encryption after ${action} cannot insert or leak the draft`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator("#encrypted-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/jm");
    await page.getByRole("option", { name: /加密文本/ }).click();
    const dialog = page.getByRole("dialog", { name: "新建加密文本" });
    await dialog.getByLabel("密码").fill("test-password");
    await dialog.getByLabel("加密文本内容").fill("late secret Omega");
    await page.evaluate(() => {
      (window as any).delayEncryption = true;
    });
    await dialog.getByRole("button", { name: "加密并保存" }).click();
    await page.waitForFunction(() => typeof (window as any).resolveEncryption === "function");
    await page.evaluate((kind) => {
      const controller = (window as any).encryptedEditor;
      if (kind === "destroy") controller.destroy();
      else if (kind === "unmount") controller.editor.unmount();
      else
        controller.setContent({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "replacement" }] }],
        });
      (window as any).resolveEncryption();
    }, action);
    if (action === "destroy" || action === "unmount") await expect(dialog).toHaveCount(0);
    else {
      await expect(dialog.getByRole("status")).toContainText("文档已变化");
      await expect(dialog.getByLabel("加密文本内容")).toHaveValue("late secret Omega");
      const result = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
      expect(result).toContain("replacement");
      expect(result).not.toContain("late secret Omega");
      expect(result).not.toContain("semloEditorEncryptedText");
    }
    expect(errors).toEqual([]);
  });
}

test("ciphertext survives JSON and HTML round trips without plaintext", async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(() => {
    const c = (window as any).encryptedEditor;
    const payload = btoa("fixture secret");
    c.setContent({ type: "doc", content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: payload } }] });
    const first = c.getSnapshot();
    c.setContent(first.html);
    const html = c.getSnapshot();
    c.setContent(first.json);
    const json = c.getSnapshot();
    return { first, html, json };
  });
  expect(result.html.json).toEqual(result.first.json);
  expect(result.json.json).toEqual(result.first.json);
  expect(JSON.stringify(result)).not.toContain("fixture secret");
});

test("replacing provider while encryption is pending preserves the draft", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#encrypted-fixture .semlo-editor-prose p").click();
  await page.keyboard.type("/jm");
  await page.getByRole("option", { name: /加密文本/ }).click();
  const dialog = page.getByRole("dialog", { name: "新建加密文本" });
  await dialog.getByLabel("密码").fill("test-password");
  await dialog.getByLabel("加密文本内容").fill("provider change draft");
  await page.evaluate(() => {
    (window as any).delayEncryption = true;
  });
  await dialog.getByRole("button", { name: "加密并保存" }).click();
  await page.waitForFunction(() => typeof (window as any).resolveEncryption === "function");
  await page.evaluate(() => {
    (window as any).encryptedEditor.setIntegrations({ encryptedTextProvider: null });
    (window as any).resolveEncryption();
  });
  await expect(dialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(dialog.getByLabel("加密文本内容")).toHaveValue("provider change draft");
  const snapshot = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  expect(snapshot).not.toContain("provider change draft");
  expect(snapshot).not.toContain("semloEditorEncryptedText");
});

test("read-only document can unlock for viewing without writing plaintext", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const c = (window as any).encryptedEditor;
    c.setContent({
      type: "doc",
      content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: btoa("read only secret") } }],
    });
    c.setEditable(false);
  });
  const before = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  await page.getByRole("button", { name: "解锁加密文本" }).click();
  const dialog = page.getByRole("dialog", { name: "解锁加密文本" });
  await dialog.getByLabel("密码").fill("test-password");
  await dialog.getByRole("button", { name: "解锁", exact: true }).click();
  const view = page.getByRole("dialog", { name: "查看加密文本" });
  await expect(view.getByLabel("加密文本内容")).toHaveValue("read only secret");
  await expect(view.getByLabel("加密文本内容")).toHaveAttribute("readonly", "");
  await expect(view.getByRole("button", { name: "加密并保存" })).toHaveCount(0);
  await view.getByRole("button", { name: "关闭" }).click();
  const after = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  expect(after).toBe(before);
  expect(after).not.toContain("read only secret");
});

for (const action of ["remove", "replace"] as const) {
  test(`late decryption cannot reveal old plaintext after target ${action}`, async ({ page }) => {
    await page.goto(origin);
    await page.evaluate(() => {
      const c = (window as any).encryptedEditor;
      c.setContent({
        type: "doc",
        content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: btoa("stale secret") } }],
      });
      (window as any).delayDecryption = true;
    });
    await page.getByRole("button", { name: "解锁加密文本" }).click();
    const dialog = page.getByRole("dialog", { name: "解锁加密文本" });
    await dialog.getByLabel("密码").fill("test-password");
    await dialog.getByRole("button", { name: "解锁", exact: true }).click();
    await page.waitForFunction(() => typeof (window as any).resolveDecryption === "function");
    await page.evaluate((kind) => {
      const c = (window as any).encryptedEditor;
      c.setContent({
        type: "doc",
        content:
          kind === "remove"
            ? [{ type: "paragraph" }]
            : [{ type: "semloEditorEncryptedText", attrs: { ciphertext: btoa("new value") } }],
      });
      (window as any).resolveDecryption();
    }, action);
    await expect(dialog.getByRole("status")).toContainText("文档已变化，无法解锁");
    const field = dialog.locator("textarea");
    await expect(field).toBeHidden();
    await expect(field).toHaveValue("");
    const result = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
    expect(result).not.toContain("stale secret");
  });
}

test("an unlocked draft remains available after the target is replaced, without overwriting it", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() =>
    (window as any).encryptedEditor.setContent({
      type: "doc",
      content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: btoa("old secret") } }],
    }),
  );
  await page.getByRole("button", { name: "解锁加密文本" }).click();
  const dialog = page.getByRole("dialog", { name: "解锁加密文本" });
  await dialog.getByLabel("密码").fill("test-password");
  await dialog.getByRole("button", { name: "解锁", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑加密文本" });
  await edit.getByLabel("加密文本内容").fill("unsaved secret");
  await page.evaluate(() =>
    (window as any).encryptedEditor.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "replacement" }] }],
    }),
  );
  await edit.getByRole("button", { name: "加密并保存" }).click();
  await expect(edit.getByRole("status")).toContainText("文档已变化");
  await expect(edit.getByLabel("加密文本内容")).toHaveValue("unsaved secret");
  const result = await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()));
  expect(result).toContain("replacement");
  expect(result).not.toContain("unsaved secret");
});
