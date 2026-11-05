import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

let origin: string;
let closeServer: () => Promise<void>;
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
test.beforeEach(async ({ page }) => installFixtureGuards(page));

async function newDialog(page: Page) {
  await page.locator("#encrypted-fixture .semlo-editor-prose p").click();
  await page.keyboard.type("/jm");
  await page.getByRole("option", { name: /加密文本/ }).click();
  return page.getByRole("dialog", { name: "新建加密文本" });
}

test("replacing the provider before submission never invokes it and keeps the draft", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const state = { calls: 0 };
    const provider = {
      encrypt: async () => {
        state.calls++;
        return "ciphertext";
      },
      decrypt: async () => "plaintext",
    };
    Object.assign(window, { auditProvider: provider, auditState: state });
    (window as any).encryptedEditor.setIntegrations({ encryptedTextProvider: provider });
  });
  const dialog = await newDialog(page);
  await dialog.getByLabel("密码").fill("sample-password");
  await dialog.getByLabel("加密文本内容").fill("sample-draft");
  await page.evaluate(() => {
    const controller = (window as any).encryptedEditor;
    controller.setIntegrations({ encryptedTextProvider: null });
    controller.setIntegrations({ encryptedTextProvider: (window as any).auditProvider });
  });
  await expect(dialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(dialog.getByLabel("密码")).toHaveValue("sample-password");
  await expect(dialog.getByLabel("加密文本内容")).toHaveValue("sample-draft");
  await expect(dialog.getByRole("button", { name: "加密并保存" })).toBeDisabled();
  await dialog
    .getByRole("button", { name: "加密并保存" })
    .evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(await page.evaluate(() => (window as any).auditState.calls)).toBe(0);
  expect(await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()))).not.toContain(
    "sample-draft",
  );
  await dialog.getByRole("button", { name: "取消" }).click();
  await page.evaluate(() => (window as any).encryptedEditor.setContent("<p></p>"));
  const nextDialog = await newDialog(page);
  await nextDialog.getByLabel("密码").fill("sample-password");
  await nextDialog.getByLabel("加密文本内容").fill("sample-draft");
  await nextDialog.getByRole("button", { name: "加密并保存" }).click();
  await expect(nextDialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).auditState.calls)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()))).toContain(
    "ciphertext",
  );
});

test("replacement aborts an in-flight encryption even if the provider settles late", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const provider = {
      encrypt: ({ signal }: { signal: AbortSignal }) => {
        Reflect.set(window, "auditSignal", signal);
        return new Promise<string>((resolve) => Reflect.set(window, "auditResolve", resolve));
      },
      decrypt: async () => "plaintext",
    };
    (window as any).encryptedEditor.setIntegrations({ encryptedTextProvider: provider });
  });
  const dialog = await newDialog(page);
  await dialog.getByLabel("密码").fill("sample-password");
  await dialog.getByLabel("加密文本内容").fill("sample-draft");
  await dialog.getByRole("button", { name: "加密并保存" }).click();
  await page.waitForFunction(() => Boolean((window as any).auditSignal));
  await page.evaluate(() => (window as any).encryptedEditor.setIntegrations({}));
  expect(await page.evaluate(() => (window as any).auditSignal.aborted)).toBe(true);
  await expect(dialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(dialog.getByLabel("加密文本内容")).toBeEnabled();
  await expect(dialog.getByLabel("加密文本内容")).toHaveValue("sample-draft");
  await page.evaluate(() => (window as any).auditResolve("late-ciphertext"));
  await expect(dialog.getByRole("button", { name: "加密并保存" })).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify((window as any).encryptedEditor.getSnapshot()))).not.toContain(
    "late-ciphertext",
  );
});

test("replacement aborts the old request even when another integration observer throws", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const controller = (window as any).encryptedEditor;
    const provider = {
      encrypt: ({ signal }: { signal: AbortSignal }) => {
        Reflect.set(window, "auditFailedUpdateSignal", signal);
        return new Promise<string>(() => {});
      },
      decrypt: async () => "plaintext",
    };
    controller.setIntegrations({ encryptedTextProvider: provider });
    const extension = controller.editor.extensionManager.extensions.find(
      (item: any) => item.name === "semloEditorVote",
    );
    extension.options.host.subscribe(() => {
      throw new Error("observer failed");
    });
  });
  const dialog = await newDialog(page);
  await dialog.getByLabel("密码").fill("sample-password");
  await dialog.getByLabel("加密文本内容").fill("sample-draft");
  await dialog.getByRole("button", { name: "加密并保存" }).click();
  const message = await page.evaluate(() => {
    try {
      (window as any).encryptedEditor.setIntegrations({ interactiveCardHost: {} });
      return "no error";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toBe("observer failed");
  expect(await page.evaluate(() => (window as any).auditFailedUpdateSignal.aborted)).toBe(true);
  await expect(dialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(dialog.getByLabel("加密文本内容")).toHaveValue("sample-draft");
});

test("an abort listener can synchronously replace integrations without the outer update winning", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const controller = (window as any).encryptedEditor;
    const calls: string[] = [];
    const oldRunner = async () => {
      calls.push("old");
    };
    const newRunner = async () => {
      calls.push("new");
    };
    const provider = {
      encrypt: ({ signal }: { signal: AbortSignal }) => {
        signal.addEventListener("abort", () =>
          controller.setIntegrations({ encryptedTextProvider: provider, runCode: newRunner }),
        );
        return new Promise<string>(() => {});
      },
      decrypt: async () => "plaintext",
    };
    controller.setIntegrations({ encryptedTextProvider: provider, runCode: oldRunner });
    Reflect.set(window, "auditRunnerCalls", calls);
  });
  const dialog = await newDialog(page);
  await dialog.getByLabel("密码").fill("sample-password");
  await dialog.getByLabel("加密文本内容").fill("sample-draft");
  await dialog.getByRole("button", { name: "加密并保存" }).click();
  await page.evaluate(() => (window as any).encryptedEditor.setIntegrations({}));
  await expect(dialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(dialog.getByRole("button", { name: "加密并保存" })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消" }).click();
  await page.evaluate(() => (window as any).encryptedEditor.setContent("<p></p>"));
  await page.locator("#encrypted-fixture .semlo-editor-prose p").click();
  await page.keyboard.type("/jm");
  await expect(page.getByRole("option", { name: /加密文本/ })).toBeEnabled();
  await page.evaluate(() =>
    (window as any).encryptedEditor.setContent({
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "1 + 1" }] }],
    }),
  );
  const code = page.locator("#encrypted-fixture .semlo-editor-code-card");
  await code.hover();
  await code.getByRole("button", { name: "运行代码" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "auditRunnerCalls"))).toEqual(["new"]);
});

test("reentrant restoration of a provider cannot revive its other already-open dialogs", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const controller = (window as any).encryptedEditor;
    const state = { calls: 0 };
    const provider = {
      encrypt: async () => "ciphertext",
      decrypt: ({ signal }: { signal: AbortSignal }) => {
        state.calls++;
        signal.addEventListener("abort", () => controller.setIntegrations({ encryptedTextProvider: provider }));
        return new Promise<string>(() => {});
      },
    };
    controller.setIntegrations({ encryptedTextProvider: provider });
    controller.setContent({
      type: "doc",
      content: [
        { type: "semloEditorEncryptedText", attrs: { ciphertext: "first" } },
        { type: "semloEditorEncryptedText", attrs: { ciphertext: "second" } },
      ],
    });
    Reflect.set(window, "auditReentrantDecryptState", state);
  });
  const triggers = page.getByRole("button", { name: "解锁加密文本" });
  await triggers.first().click();
  const first = page.getByRole("dialog", { name: "解锁加密文本" }).first();
  await first.getByRole("button", { name: "解锁", exact: true }).click();
  await triggers.last().click();
  const second = page.getByRole("dialog", { name: "解锁加密文本" }).last();
  await second.getByLabel("密码").fill("second-password");
  await page.evaluate(() => (window as any).encryptedEditor.setIntegrations({}));
  await expect(first.getByRole("status")).toContainText("加密服务已更换");
  await expect(second.getByRole("status")).toContainText("加密服务已更换");
  await expect(second.getByRole("button", { name: "解锁", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).auditReentrantDecryptState.calls)).toBe(1);
});

test("a reentrant submission cannot use an old provider even if it was restored during replacement", async ({
  page,
}) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const controller = (window as any).encryptedEditor;
    const state = { calls: 0, phase: 0 };
    const original = {
      encrypt: async () => {
        state.calls++;
        return "ciphertext";
      },
      decrypt: async () => "plaintext",
    };
    const replacement = { encrypt: async () => "new-ciphertext", decrypt: async () => "plaintext" };
    controller.setIntegrations({ encryptedTextProvider: original });
    controller.editor.view.dom.addEventListener("semlo-editor:code-runner", () => {
      if (state.phase === 0) {
        state.phase = 1;
        controller.setIntegrations({ encryptedTextProvider: original, runCode: async () => {} });
      } else if (state.phase === 1) {
        state.phase = 2;
        document
          .querySelector<HTMLButtonElement>(".semlo-editor-encrypted-dialog button")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    Object.assign(window, { auditReentryState: state, auditReplacement: replacement });
  });
  const dialog = await newDialog(page);
  await dialog.getByLabel("密码").fill("sample-password");
  await dialog.getByLabel("加密文本内容").fill("sample-draft");
  await page.evaluate(() =>
    (window as any).encryptedEditor.setIntegrations({
      encryptedTextProvider: (window as any).auditReplacement,
      runCode: async () => {},
    }),
  );
  expect(await page.evaluate(() => (window as any).auditReentryState)).toEqual({ calls: 0, phase: 2 });
  await expect(dialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(dialog.getByRole("button", { name: "加密并保存" })).toBeDisabled();
});

test("replacement before decryption prevents the old provider from receiving the password", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const state = { calls: 0 };
    const provider = {
      encrypt: async () => "ciphertext",
      decrypt: async () => {
        state.calls++;
        return "plaintext";
      },
    };
    const controller = (window as any).encryptedEditor;
    controller.setIntegrations({ encryptedTextProvider: provider });
    controller.setContent({
      type: "doc",
      content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: "ciphertext" } }],
    });
    Reflect.set(window, "auditDecryptState", state);
  });
  await page.getByRole("button", { name: "解锁加密文本" }).click();
  const dialog = page.getByRole("dialog", { name: "解锁加密文本" });
  await dialog.getByLabel("密码").fill("sample-password");
  await page.evaluate(() => (window as any).encryptedEditor.setIntegrations({}));
  await expect(dialog.getByRole("button", { name: "解锁", exact: true })).toBeDisabled();
  await dialog
    .getByRole("button", { name: "解锁", exact: true })
    .evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(await page.evaluate(() => (window as any).auditDecryptState.calls)).toBe(0);
});

test("provider replacement invalidates only its own editor's pending decrypt", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const requests: Array<{ signal: AbortSignal; resolve: (value: string) => void }> = [];
    const provider = {
      encrypt: async () => "ciphertext",
      decrypt: ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((resolve) => requests.push({ signal, resolve })),
    };
    const content = {
      type: "doc",
      content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: "ciphertext" } }],
    };
    const first = (window as any).encryptedEditor;
    first.setIntegrations({ encryptedTextProvider: provider });
    first.setContent(content);
    const secondHost = document.createElement("div");
    secondHost.id = "encrypted-second";
    document.body.append(secondHost);
    const second = (window as any).createEncryptedTestEditor({
      element: secondHost,
      content,
      encryptedTextProvider: provider,
      outline: false,
    });
    Object.assign(window, { auditRequests: requests, auditSecond: second });
  });
  await page.locator("#encrypted-fixture").getByRole("button", { name: "解锁加密文本" }).click();
  const firstDialog = page.getByRole("dialog", { name: "解锁加密文本" }).first();
  await firstDialog.getByLabel("密码").fill("first-password");
  await firstDialog.getByRole("button", { name: "解锁", exact: true }).click();
  await page.locator("#encrypted-second").getByRole("button", { name: "解锁加密文本" }).click();
  const secondDialog = page.getByRole("dialog", { name: "解锁加密文本" }).last();
  await secondDialog.getByLabel("密码").fill("second-password");
  await secondDialog.getByRole("button", { name: "解锁", exact: true }).click();
  await page.evaluate(() => (window as any).encryptedEditor.setIntegrations({}));
  expect(
    await page.evaluate(() => (window as any).auditRequests.map((request: any) => request.signal.aborted)),
  ).toEqual([true, false]);
  await page.evaluate(() => {
    (window as any).auditRequests[0].resolve("old-plaintext");
    (window as any).auditRequests[1].resolve("second-plaintext");
  });
  await expect(firstDialog.getByRole("status")).toContainText("加密服务已更换");
  await expect(firstDialog.getByLabel("加密文本内容")).toBeHidden();
  await expect(page.getByRole("dialog", { name: "编辑加密文本" }).getByLabel("加密文本内容")).toHaveValue(
    "second-plaintext",
  );
  await page.evaluate(() => (window as any).auditSecond.destroy());
});

test("provider changes close stale insertion menus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.locator("#encrypted-fixture .semlo-editor-prose p").click();
  await page.keyboard.type("/jm");
  await expect(page.getByRole("option", { name: /加密文本/ })).toBeVisible();
  await page.evaluate(() => (window as any).encryptedEditor.setIntegrations({}));
  await expect(page.getByRole("option", { name: /加密文本/ })).toHaveCount(0);
});

test("closing the unlock dialog restores focus or falls back when the trigger disappears", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() =>
    (window as any).encryptedEditor.setContent({
      type: "doc",
      content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: "ciphertext" } }],
    }),
  );
  const trigger = page.getByRole("button", { name: "解锁加密文本" });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.evaluate(() => (window as any).encryptedEditor.setContent("<p>新文档</p>"));
  await page.keyboard.press("Escape");
  await expect(page.locator("#encrypted-fixture .semlo-editor-prose")).toBeFocused();
});

test("focus restoration tolerates synchronous destruction by the host", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(() =>
    (window as any).encryptedEditor.setContent({
      type: "doc",
      content: [{ type: "semloEditorEncryptedText", attrs: { ciphertext: "ciphertext" } }],
    }),
  );
  await page.getByRole("button", { name: "解锁加密文本" }).click();
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(".semlo-editor-encrypted-text button")!;
    button.addEventListener("focus", () => (window as any).encryptedEditor.destroy(), { once: true });
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "解锁加密文本" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const [platform, shortcut] of [
  ["MacIntel", "⌘F"],
  ["Win32", "Ctrl+F"],
  ["Linux x86_64", "Ctrl+F"],
] as const) {
  test(`find tooltip matches ${platform}`, async ({ page }) => {
    await page.addInitScript((value) => Object.defineProperty(navigator, "platform", { get: () => value }), platform);
    await page.goto(origin);
    await expect(page.getByRole("button", { name: "查找替换" })).toHaveAttribute("title", `查找替换 ${shortcut}`);
  });
}
